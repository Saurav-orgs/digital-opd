import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { Appointment } from '../database/models/appointment.model';
import { ConsultationSession } from '../database/models/consultation-session.model';
import { EPrescription } from '../database/models/e-prescription.model';
import { EPrescriptionMedicine } from '../database/models/e-prescription-medicine.model';
import { AiClientService, AiDraftPrescription } from '../ai/ai-client.service';
import { MedicinesService } from '../medicines/medicines.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  ConsultationSessionStatus,
  MedicineSource,
  PrescriptionStatus,
} from '../common/enums';
import { AuthUser } from '../common/decorators/current-user.decorator';

/**
 * Turns a recorded consultation into a draft prescription.
 *
 * The pipeline is transcribe → draft, and on this hardware it takes minutes, so
 * the upload request returns as soon as the session row exists and the work
 * continues in the background. The client polls `get()` for progress.
 *
 * Nothing here reaches the patient: the output is always a `draft` that the
 * doctor must review and issue.
 */
@Injectable()
export class ConsultationsService {
  private readonly logger = new Logger(ConsultationsService.name);
  private readonly aiEnabled: boolean;

  /**
   * Sessions currently being transcribed or drafted, so `cancel` can stop the
   * request rather than only forgetting about it.
   *
   * In-process by design: a cancel served by a different instance still works,
   * because the session row is deleted either way and the pipeline checks for
   * it before writing anything. The controller is the optimisation — it frees
   * the machine instead of leaving a model chewing on audio nobody wants.
   */
  private readonly inFlight = new Map<string, AbortController>();

  constructor(
    @InjectModel(Appointment) private readonly appointmentModel: typeof Appointment,
    @InjectModel(ConsultationSession)
    private readonly sessionModel: typeof ConsultationSession,
    @InjectModel(EPrescription)
    private readonly prescriptionModel: typeof EPrescription,
    @InjectModel(EPrescriptionMedicine)
    private readonly medicineModel: typeof EPrescriptionMedicine,
    private readonly ai: AiClientService,
    private readonly medicines: MedicinesService,
    private readonly config: ConfigService,
  ) {
    this.aiEnabled = this.config.get<{ enabled: boolean }>('ai')!.enabled;
  }

  /**
   * Accept the recording and start processing. Returns immediately with a
   * session the client can poll.
   */
  async startFromAudio(
    appointmentId: string,
    audio: Express.Multer.File,
    user: AuthUser,
  ): Promise<ConsultationSession> {
    const appointment = await this.getAppointment(appointmentId, user);

    if (!audio) throw new AppException(ErrorCode.FILE_REQUIRED);
    if (!this.aiEnabled) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message:
          'Voice prescriptions are turned off on this server. You can still ' +
          'write the prescription by hand.',
      });
    }

    // One session per appointment: re-recording replaces the previous attempt
    // rather than accumulating half-finished transcripts.
    await this.sessionModel.destroy({ where: { appointment_id: appointmentId } });

    const session = await this.sessionModel.create({
      appointment_id: appointmentId,
      status: ConsultationSessionStatus.TRANSCRIBING,
    } as any);

    // Deliberately not awaited — transcription takes minutes.
    void this.process(session.id, appointment, audio);

    return session;
  }

  /** Current session for an appointment, if the doctor has recorded one. */
  async get(
    appointmentId: string,
    user: AuthUser,
  ): Promise<ConsultationSession | null> {
    await this.getAppointment(appointmentId, user);
    return this.sessionModel.findOne({
      where: { appointment_id: appointmentId },
      order: [['created_at', 'DESC']],
    });
  }

  /**
   * Give up on a recording that is taking too long.
   *
   * On this hardware transcription is measured in minutes, and a wedged model
   * looks exactly like a slow one — so the doctor is the only one who can say
   * when it has gone on long enough. Cancelling has to leave them able to work:
   * the session goes, the recorder resets, and the prescription editor is free
   * for them to type into.
   *
   * The session row is deleted rather than marked, because that is already the
   * "no recording yet" state the recorder and `startFromAudio` both handle.
   */
  async cancel(appointmentId: string, user: AuthUser): Promise<{ cancelled: boolean }> {
    await this.getAppointment(appointmentId, user);

    const session = await this.sessionModel.findOne({
      where: { appointment_id: appointmentId },
      order: [['created_at', 'DESC']],
    });
    if (!session) return { cancelled: false };

    // Deleting first is what actually stops the pipeline: every stage checks
    // the row still exists before writing, so the work is discarded even when
    // the abort below lands too late or on another instance.
    await this.sessionModel.destroy({ where: { id: session.id } });

    const controller = this.inFlight.get(session.id);
    if (controller) {
      controller.abort();
      this.inFlight.delete(session.id);
    }

    this.logger.log(
      `Consultation session ${session.id} cancelled by the doctor ` +
        `(was ${session.status}).`,
    );
    return { cancelled: true };
  }

  /**
   * Draft again from the transcript already on the row.
   *
   * The failures this recovers from are transient — the sidecar restarting, a
   * deploy, a timeout — and by the time the doctor reads the error the
   * consultation has already been transcribed. The audio is discarded after
   * transcription, so without this the only way forward is to ask the patient
   * to say it all again; the transcript is right there on screen under "what
   * the system heard", which makes that especially hard to justify.
   *
   * Only re-runs drafting. Transcription is not repeated and cannot be.
   */
  async retryDraft(
    appointmentId: string,
    user: AuthUser,
  ): Promise<ConsultationSession> {
    const appointment = await this.getAppointment(appointmentId, user);

    if (!this.aiEnabled) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message:
          'Voice prescriptions are turned off on this server. You can still ' +
          'write the prescription by hand.',
      });
    }

    const session = await this.sessionModel.findOne({
      where: { appointment_id: appointmentId },
      order: [['created_at', 'DESC']],
    });
    if (!session) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'There is no recording to retry. Please record the consultation again.',
      });
    }

    // Only a failed attempt may be retried. Starting a second run over one
    // still in flight would put two drafts in a race for the same prescription
    // row, and the loser's medicines would overwrite the winner's.
    if (session.status !== ConsultationSessionStatus.FAILED) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message:
          session.status === ConsultationSessionStatus.DRAFT_READY
            ? 'This recording has already produced a draft prescription.'
            : 'This recording is still being processed. Please wait for it to finish.',
      });
    }

    // Nothing was heard, so there is nothing to draft from. Saying so is more
    // use than a retry button that can only fail the same way again.
    if (!session.transcript?.trim()) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message:
          'Nothing could be heard in that recording, so there is nothing to ' +
          'retry. Please record the consultation again.',
      });
    }

    await this.sessionModel.update(
      { status: ConsultationSessionStatus.DRAFTING, error: null } as any,
      { where: { id: session.id } },
    );

    // Registered in `inFlight` like any other run, so Cancel still works while
    // a retry is going and a cancelled retry is discarded the same way.
    const controller = new AbortController();
    this.inFlight.set(session.id, controller);

    // Not awaited, exactly as startFromAudio does it: the client polls.
    void this.draftFromTranscript(
      session.id,
      appointment,
      session.transcript,
      session.model_version ?? null,
      controller,
    ).finally(() => this.inFlight.delete(session.id));

    this.logger.log(
      `Retrying the prescription draft for appointment ${appointmentId} ` +
        `from the stored transcript (session ${session.id}).`,
    );

    return (await this.sessionModel.findByPk(session.id))!;
  }

  // ── pipeline ───────────────────────────────────────────────

  private async process(
    sessionId: string,
    appointment: Appointment,
    audio: Express.Multer.File,
  ): Promise<void> {
    let transcript = '';
    let modelVersion: string | null = null;

    const controller = new AbortController();
    this.inFlight.set(sessionId, controller);

    try {
      // 1. Speech → text, biased toward the tenant's medicine vocabulary.
      try {
        const vocabulary = await this.medicines.vocabulary(appointment.doctor_id, 60);
        const result = await this.ai.transcribe(audio, vocabulary, controller.signal);
        transcript = result.text;
        modelVersion = result.model_version;

        if (await this.wasCancelled(sessionId)) return;

        await this.sessionModel.update(
          {
            transcript,
            language: result.language,
            duration_seconds: Math.round(result.duration_seconds),
            model_version: modelVersion,
            status: ConsultationSessionStatus.DRAFTING,
          } as any,
          { where: { id: sessionId } },
        );
      } catch (err) {
        if (await this.wasCancelled(sessionId)) return;
        await this.fail(sessionId, (err as Error).message);
        return;
      }

      if (!transcript.trim()) {
        await this.fail(
          sessionId,
          'Nothing could be heard in the recording. Please check the microphone and try again.',
        );
        return;
      }

      // 2. Transcript → structured draft prescription.
      await this.draftFromTranscript(
        sessionId,
        appointment,
        transcript,
        modelVersion,
        controller,
      );
    } finally {
      this.inFlight.delete(sessionId);
    }
  }

  /**
   * Stage 2 on its own: a transcript that is already stored → a draft.
   *
   * Split out of `process` so `retryDraft` can re-run exactly this half and
   * nothing else. Transcription is the expensive part — minutes of CPU, and
   * the audio is gone afterwards — so drafting must be retryable without it.
   */
  private async draftFromTranscript(
    sessionId: string,
    appointment: Appointment,
    transcript: string,
    modelVersion: string | null,
    controller: AbortController,
  ): Promise<void> {
    try {
      const vocabulary = await this.medicines.vocabulary(appointment.doctor_id, 120);
      const { prescription, model_version } = await this.ai.extractPrescription(
        {
          transcript,
          patient: {
            name: appointment.patient_name,
            age: appointment.patient_age,
            gender: appointment.patient_gender ?? '',
            complaint: appointment.description ?? '',
          },
          medicine_catalog: vocabulary,
        },
        controller.signal,
      );

      // The last and most important check: past this line the draft would
      // land in the editor, and a doctor who cancelled has very likely
      // started typing their own prescription into it.
      if (await this.wasCancelled(sessionId)) return;

      await this.saveDraft(appointment.id, sessionId, prescription);
      await this.sessionModel.update(
        {
          status: ConsultationSessionStatus.DRAFT_READY,
          model_version: model_version || modelVersion,
          error: null,
        } as any,
        { where: { id: sessionId } },
      );
      this.logger.log(`Draft prescription ready for appointment ${appointment.id}.`);
    } catch (err) {
      if (await this.wasCancelled(sessionId)) return;
      // The transcript survives even when drafting fails, so the doctor can
      // still read what was said, retry, or write the prescription by hand.
      await this.fail(sessionId, (err as Error).message);
    }
  }

  /**
   * Whether the doctor pulled the plug while this stage was running.
   *
   * Asks the database rather than the abort signal, because the row is the
   * thing both sides agree on: cancelling deletes it, and a cancel handled by
   * another instance never touches this process's controller at all.
   */
  private async wasCancelled(sessionId: string): Promise<boolean> {
    const still = await this.sessionModel.count({ where: { id: sessionId } });
    if (still > 0) return false;
    this.logger.log(`Consultation session ${sessionId} was cancelled; discarding.`);
    return true;
  }

  /** Replace the appointment's draft with the AI's suggestion. */
  private async saveDraft(
    appointmentId: string,
    sessionId: string,
    draft: AiDraftPrescription,
  ): Promise<void> {
    const existing = await this.prescriptionModel.findOne({
      where: { appointment_id: appointmentId },
    });

    // Never overwrite something already issued to a patient.
    if (existing?.status === PrescriptionStatus.ISSUED) {
      this.logger.warn(
        `Appointment ${appointmentId} already has an issued prescription; ` +
          'keeping it and discarding the new draft.',
      );
      return;
    }

    const prescription =
      existing ??
      (await this.prescriptionModel.create({
        appointment_id: appointmentId,
        consultation_session_id: sessionId,
        status: PrescriptionStatus.DRAFT,
      } as any));

    await prescription.update({
      consultation_session_id: sessionId,
      diagnosis: draft.diagnosis || null,
      advice: draft.advice?.length ? draft.advice.join('\n') : null,
      follow_up_date: this.followUpDate(draft.follow_up_days),
    } as any);

    await this.medicineModel.destroy({
      where: { e_prescription_id: prescription.id },
    });

    const rows = (draft.medicines ?? [])
      .filter((m) => m.name?.trim())
      .map((m, index) => ({
        e_prescription_id: prescription.id,
        position: index,
        medicine_name: m.name.trim(),
        strength: m.strength || null,
        form: m.form || null,
        // The model is told to leave dosage empty rather than guess; the doctor
        // fills it in, and issuing is blocked until they do.
        dosage: m.dosage || '',
        // Dropped from the AI contract — food timing is part of instructions
        // now. The column stays until a migration can remove it.
        timing: null,
        duration_days: m.duration_days ?? null,
        instructions: m.instructions || null,
        source: MedicineSource.AI,
        was_edited: false,
      }));

    if (rows.length) await this.medicineModel.bulkCreate(rows as any);
  }

  private followUpDate(days?: number | null): string | null {
    if (!days || days <= 0) return null;
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  private async fail(sessionId: string, message: string): Promise<void> {
    await this.sessionModel.update(
      { status: ConsultationSessionStatus.FAILED, error: message } as any,
      { where: { id: sessionId } },
    );
    this.logger.warn(`Consultation session ${sessionId} failed: ${message}`);
  }

  /** Loads the appointment and enforces the doctor's data scope. */
  private async getAppointment(id: string, user: AuthUser): Promise<Appointment> {
    const appointment = await this.appointmentModel.findByPk(id);
    if (!appointment) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'Appointment not found.',
      });
    }
    if (!user.doctorId || appointment.doctor_id !== user.doctorId) {
      throw new AppException(ErrorCode.FORBIDDEN, {
        message: 'You can only access your own appointments.',
      });
    }
    return appointment;
  }
}
