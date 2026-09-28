import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { ConfigService } from '@nestjs/config';
import type { Socket } from 'socket.io';
import { Appointment } from '../database/models/appointment.model';
import { ConsultationSession } from '../database/models/consultation-session.model';
import { AiClientService } from '../ai/ai-client.service';
import { AiUsageService } from '../ai/ai-usage.service';
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
  /** Segments that arrived and have not been dispatched yet, by position. */
  pending: Map<number, Buffer>;
  /** Finished text by position. The transcript is these, joined in key order. */
  done: Map<number, string>;
  /** The lowest position not yet dispatched. */
  nextSeq: number;
  /** How many are in flight right now — see `pump`. */
  inFlight: number;
  transcript: string;
  durationSeconds: number;
  modelVersion: string | null;
  /** True while the pump is running or anything is still in flight. */
  processing: boolean;
  /** Pending debounced write of the transcript to the row. */
  writeTimer: NodeJS.Timeout | null;
  /** Set by `stop`: how many pieces to expect in total, once known. */
  totalSegments: number | null;
  /** Wall-clock of the last thing the client sent. */
  lastActivity: number;
  controller: AbortController;
}

/** A session with nothing from the client for this long is abandoned. */
const IDLE_MS = 60_000;
const SWEEP_MS = 15_000;
/** How long the transcript write waits for more pieces before going to the DB. */
const WRITE_DEBOUNCE_MS = 1_000;

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
  private readonly parallelChunks: number;

  constructor(
    @InjectModel(ConsultationSession)
    private readonly sessionModel: typeof ConsultationSession,
    private readonly consultations: ConsultationsService,
    private readonly ai: AiClientService,
    private readonly aiUsage: AiUsageService,
    private readonly medicines: MedicinesService,
    config: ConfigService,
  ) {
    this.parallelChunks = config.get<number>('ai.parallelChunks') ?? 1;
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
      done: new Map(),
      inFlight: 0,
      writeTimer: null,
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
    this.pump(s);
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
    void this.setStatus(s, ConsultationSessionStatus.TRANSCRIBING);
    this.pump(s);
    // Stop can arrive after the last piece has already been transcribed, in
    // which case the pump has nothing to do and nothing would ever call
    // finish(). Only possible now that pieces complete out of order.
    if (s.inFlight === 0 && s.pending.size === 0 && s.nextSeq >= totalSegments) {
      void this.finish(s);
    }
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
   * Transcribe whatever has arrived, up to `parallelChunks` at a time.
   *
   * This used to be strictly one at a time, for two reasons that were both
   * true of a self-hosted Whisper: each piece was prompted with the text
   * before it, so the order mattered; and two at the sidecar would only have
   * queued behind one model anyway.
   *
   * A hosted STT provider has neither property. The calls are independent and
   * network-bound, so serialising them means N pieces cost N round trips of
   * pure waiting. Now they overlap, and the transcript is assembled from
   * `done` in sequence order — so completion order stops mattering, but the
   * doctor's words still come out in the order they said them.
   *
   * `CONSULTATION_PARALLEL_CHUNKS=1` restores the old behaviour exactly.
   */
  private pump(s: StreamSession): void {
    while (s.inFlight < this.parallelChunks && s.pending.has(s.nextSeq)) {
      const seq = s.nextSeq;
      const wav = s.pending.get(seq)!;
      s.pending.delete(seq);
      s.nextSeq = seq + 1;
      s.inFlight += 1;
      s.processing = true;
      void this.runSegment(s, seq, wav);
    }
  }

  /** One piece, start to finish. Never throws — see the catch. */
  private async runSegment(s: StreamSession, seq: number, wav: Buffer): Promise<void> {
    try {
      const result = await this.ai.transcribeChunk(
        wav,
        seq,
        s.transcript,
        s.catalog,
        s.controller.signal,
        s.sessionId,
      );
      s.done.set(seq, result.text.trim());
      s.durationSeconds += result.duration_seconds;
      s.modelVersion = result.model_version;
      // Not awaited: what this chunk cost must not sit between the doctor and
      // the next one. AiUsageService swallows its own failures.
      void this.aiUsage.record(result.usage, {
        appointmentId: s.appointment.id,
        sessionId: s.sessionId,
      });
    } catch (err) {
      if (await this.consultations.wasCancelled(s.sessionId)) {
        this.drop(s);
        return;
      }
      // One bad piece must not sink the consultation: the doctor sees the gap
      // in the live text and can say it again. Recorded as an empty piece so
      // the ones after it still land in the right place.
      s.done.set(seq, '');
      this.logger.warn(`Segment ${seq} of ${s.sessionId} failed: ${(err as Error).message}`);
      s.client.emit('error', {
        message: 'A few seconds of speech could not be transcribed.',
        fatal: false,
      });
    } finally {
      s.inFlight -= 1;
    }

    if (!this.sessions.has(s.sessionId)) return;

    s.transcript = [...s.done.keys()]
      .sort((a, b) => a - b)
      .map((k) => s.done.get(k)!)
      .filter(Boolean)
      .join(' ');

    // The socket first, Postgres after. The doctor is watching the text
    // appear; there is no reason for that to wait on a round trip to the
    // database, which is what an awaited UPDATE between every piece was doing.
    s.client.emit('transcript', { seq, text: s.done.get(seq) ?? '', transcript: s.transcript });
    this.scheduleWrite(s);

    this.pump(s);

    if (s.inFlight === 0 && s.pending.size === 0) {
      s.processing = false;
      if (s.totalSegments !== null && s.nextSeq >= s.totalSegments) {
        await this.finish(s);
      }
    }
  }

  /**
   * Persist the transcript, but not on the critical path.
   *
   * It is written so a refresh mid-consultation still shows what has been
   * heard, and so `retryDraft` has it if drafting fails — neither of which
   * needs to be true within milliseconds of each piece. Debounced, and always
   * flushed before the draft starts.
   */
  private scheduleWrite(s: StreamSession): void {
    if (s.writeTimer) return;
    s.writeTimer = setTimeout(() => {
      s.writeTimer = null;
      void this.flushWrite(s);
    }, WRITE_DEBOUNCE_MS);
    s.writeTimer.unref?.();
  }

  private async flushWrite(s: StreamSession): Promise<void> {
    if (s.writeTimer) {
      clearTimeout(s.writeTimer);
      s.writeTimer = null;
    }
    try {
      await this.sessionModel.update(
        {
          transcript: s.transcript,
          duration_seconds: Math.round(s.durationSeconds),
          model_version: s.modelVersion,
        } as any,
        { where: { id: s.sessionId } },
      );
    } catch (err) {
      // The transcript is in memory and will be written again on the next
      // piece and once more before drafting, so one lost write is survivable.
      this.logger.warn(`Transcript write for ${s.sessionId} failed: ${(err as Error).message}`);
    }
  }

  /** The last piece is in: hand the transcript to the drafting stage. */
  private async finish(s: StreamSession): Promise<void> {
    if (!this.sessions.delete(s.sessionId)) return; // finished already
    try {
      // The debounced write may still be pending, and `retryDraft` reads the
      // row — so the transcript lands before anything else looks at it.
      await this.flushWrite(s);
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
    if (s.writeTimer) {
      clearTimeout(s.writeTimer);
      s.writeTimer = null;
    }
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
