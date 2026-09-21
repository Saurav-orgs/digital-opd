import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import type { Socket } from 'socket.io';
import { Appointment } from '../database/models/appointment.model';
import { ConsultationSession } from '../database/models/consultation-session.model';
import { AiClientService } from '../ai/ai-client.service';
import { MedicinesService } from '../medicines/medicines.service';
import { ConsultationsService } from './consultations.service';
import { ConsultationSessionStatus } from '../common/enums';
import { AuthUser } from '../common/decorators/current-user.decorator';

/**
 * A recording that has not stopped yet, with `segment` payloads lined up per
 * sequence number, so the transcript is assembled in the order the doctor spoke
 * whatever order the pieces arrive in.
 */
interface StreamSession {
  sessionId: string;
  appointment: Appointment;
  user: AuthUser;
  client: Socket;
  catalog: string[];
  /** Segments that arrived early, keyed by their position. */
  pending: Map<number, Buffer>;
  /** The position the transcript is waiting on next. */
  nextSeq: number;
  transcript: string;
  durationSeconds: number;
  modelVersion: string | null;
  /** One piece in flight at a time per session — see `pump`. */
  processing: boolean;
  /** Set by `stop`: how many pieces to expect in total, once known. */
  totalSegments: number | null;
  /** Wall-clock of the last thing the client sent. */
  lastActivity: number;
  controller: AbortController;
}

/** A session with nothing from the client for this long is abandoned. */
const IDLE_MS = 60_000;
const SWEEP_MS = 15_000;

/**
 * Live transcription: a consultation that arrives in pieces while the doctor
 * is still talking.
 *
 * Each piece is a few seconds of speech, cut by the browser on a pause. It is
 * transcribed as soon as it lands, with the transcript so far as context, and
 * the text goes straight back over the socket — so when the doctor presses
 * Stop, only the last piece is left to do, and the draft follows seconds later
 * instead of a minute later.
 *
 * Everything past the transcript — drafting, merging into the editor, cancel —
 * is `ConsultationsService`'s, exactly as for an uploaded recording. This
 * class only owns the assembly.
 *
 * State is in-process, like `ConsultationsService.inFlight`: a session lives
 * on the instance whose socket it arrived on. A second backend instance would
 * need a socket.io adapter and this map moved out of memory.
 */
@Injectable()
export class ConsultationStreamService implements OnModuleDestroy {
  private readonly logger = new Logger(ConsultationStreamService.name);
  private readonly sessions = new Map<string, StreamSession>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    @InjectModel(ConsultationSession)
    private readonly sessionModel: typeof ConsultationSession,
    private readonly consultations: ConsultationsService,
    private readonly ai: AiClientService,
    private readonly medicines: MedicinesService,
  ) {
    this.sweeper = setInterval(() => void this.sweepIdle(), SWEEP_MS);
    this.sweeper.unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweeper);
  }

  /** Open a session. Returns the id the client quotes on every later event. */
  async start(
    appointmentId: string,
    user: AuthUser,
    client: Socket,
  ): Promise<{ sessionId: string }> {
    const controller = new AbortController();
    const { session, appointment } = await this.consultations.startStreaming(
      appointmentId,
      user,
      controller,
    );
    // Same vocabulary the upload path biases Whisper with.
    const catalog = await this.medicines.vocabulary(appointment.doctor_id, 60);

    this.sessions.set(session.id, {
      sessionId: session.id,
      appointment,
      user,
      client,
      catalog,
      pending: new Map(),
      nextSeq: 0,
      transcript: '',
      durationSeconds: 0,
      modelVersion: null,
      processing: false,
      totalSegments: null,
      lastActivity: Date.now(),
      controller,
    });
    this.logger.log(`Live consultation ${session.id} started for appointment ${appointmentId}.`);
    return { sessionId: session.id };
  }

  /** A piece of the recording. Transcribed in order, however it arrived. */
  segment(sessionId: string, seq: number, wav: Buffer): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.lastActivity = Date.now();
    if (seq < s.nextSeq || s.pending.has(seq)) return; // duplicate — already heard
    s.pending.set(seq, wav);
    void this.pump(s);
  }

  /**
   * The doctor pressed Stop. Once the last piece is transcribed the draft
   * starts; `totalSegments` says which piece is the last one.
   */
  stop(sessionId: string, totalSegments: number): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.lastActivity = Date.now();
    s.totalSegments = totalSegments;
    this.setStatus(s, ConsultationSessionStatus.TRANSCRIBING);
    void this.pump(s);
  }

  /** The doctor gave up. Same outcome as `DELETE consultation`. */
  async abort(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.drop(s);
    await this.consultations.cancel(s.appointment.id, s.user);
  }

  /** The socket went away. The session is kept briefly for the idle sweep. */
  disconnected(client: Socket): void {
    for (const s of this.sessions.values()) {
      if (s.client === client) {
        this.logger.log(`Socket closed on live consultation ${s.sessionId}; waiting for the idle sweep.`);
      }
    }
  }

  // ── pipeline ───────────────────────────────────────────────

  /**
   * Transcribe whatever is next in line, one piece at a time.
   *
   * One at a time because each piece is prompted with the text before it,
   * and because two of them at the sidecar would only queue behind one
   * model anyway. Re-entered on every arrival; a call that finds the pump
   * already running returns and the running one picks the new piece up.
   */
  private async pump(s: StreamSession): Promise<void> {
    if (s.processing) return;
    s.processing = true;
    try {
      while (s.pending.has(s.nextSeq)) {
        if (!this.sessions.has(s.sessionId)) return;
        const seq = s.nextSeq;
        const wav = s.pending.get(seq)!;
        s.pending.delete(seq);

        let text = '';
        try {
          const result = await this.ai.transcribeChunk(
            wav,
            seq,
            s.transcript,
            s.catalog,
            s.controller.signal,
          );
          text = result.text.trim();
          s.durationSeconds += result.duration_seconds;
          s.modelVersion = result.model_version;
        } catch (err) {
          if (await this.consultations.wasCancelled(s.sessionId)) {
            this.drop(s);
            return;
          }
          // One bad piece must not sink the consultation: the doctor sees
          // the gap in the live text and can say it again. The failure is
          // logged with the piece number so it can be found later.
          this.logger.warn(`Segment ${seq} of ${s.sessionId} failed: ${(err as Error).message}`);
          s.client.emit('error', {
            message: 'A few seconds of speech could not be transcribed.',
            fatal: false,
          });
        }
        s.nextSeq = seq + 1;

        if (text) {
          s.transcript = s.transcript ? `${s.transcript} ${text}` : text;
        }

        // Written on every piece so a refresh mid-consultation still shows
        // what has been heard, and so `retryDraft` has it if drafting fails.
        if (await this.consultations.wasCancelled(s.sessionId)) {
          this.drop(s);
          return;
        }
        await this.sessionModel.update(
          {
            transcript: s.transcript,
            duration_seconds: Math.round(s.durationSeconds),
            model_version: s.modelVersion,
          } as any,
          { where: { id: s.sessionId } },
        );
        s.client.emit('transcript', { seq, text, transcript: s.transcript });
      }
    } finally {
      s.processing = false;
    }

    if (s.totalSegments !== null && s.nextSeq >= s.totalSegments) {
      await this.finish(s);
    }
  }

  /** The last piece is in: hand the transcript to the drafting stage. */
  private async finish(s: StreamSession): Promise<void> {
    if (!this.sessions.delete(s.sessionId)) return; // finished already
    try {
      if (await this.consultations.wasCancelled(s.sessionId)) return;

      if (!s.transcript.trim()) {
        await this.consultations.fail(
          s.sessionId,
          'Nothing could be heard in the recording. Please check the microphone and try again.',
        );
        await this.emitFinal(s);
        return;
      }

      await this.setStatus(s, ConsultationSessionStatus.DRAFTING);
      await this.consultations.draftFromTranscript(
        s.sessionId,
        s.appointment,
        s.transcript,
        s.modelVersion,
        s.controller,
      );
      await this.emitFinal(s);
    } finally {
      this.consultations.releaseInFlight(s.sessionId);
    }
  }

  /** Tell the client how it ended, from the row — the one source both agree on. */
  private async emitFinal(s: StreamSession): Promise<void> {
    const row = await this.sessionModel.findByPk(s.sessionId);
    if (!row) return; // cancelled meanwhile; the client already knows
    s.client.emit('status', { status: row.status, error: row.error ?? null });
  }

  private async setStatus(s: StreamSession, status: ConsultationSessionStatus): Promise<void> {
    await this.sessionModel.update({ status } as any, { where: { id: s.sessionId } });
    s.client.emit('status', { status, error: null });
  }

  private drop(s: StreamSession): void {
    this.sessions.delete(s.sessionId);
    s.controller.abort();
    this.consultations.releaseInFlight(s.sessionId);
  }

  /**
   * A session the client stopped feeding — tab closed, laptop slept — must not
   * sit in `recording` forever. It fails with a reason the doctor can act on;
   * the transcript so far stays on the row for `retryDraft`.
   */
  private async sweepIdle(): Promise<void> {
    const cutoff = Date.now() - IDLE_MS;
    for (const s of [...this.sessions.values()]) {
      if (s.lastActivity > cutoff || s.processing) continue;
      this.logger.warn(`Live consultation ${s.sessionId} idle for ${IDLE_MS / 1000}s; abandoning.`);
      this.drop(s);
      if (await this.consultations.wasCancelled(s.sessionId)) continue;
      await this.consultations.fail(
        s.sessionId,
        'The recording stopped arriving — the connection may have dropped. ' +
          'Please record again.',
      );
      s.client.emit('status', { status: ConsultationSessionStatus.FAILED, error: 'Connection lost.' });
    }
  }
}
