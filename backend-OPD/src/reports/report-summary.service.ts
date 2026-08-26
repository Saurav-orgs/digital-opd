import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { PatientReport } from '../database/models/patient-report.model';
import {
  Appointment,
  ProgressSummary,
} from '../database/models/appointment.model';
import { AiTrainingSample } from '../database/models/ai-training-sample.model';
import { AiClientService, AiVisitInput } from '../ai/ai-client.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { StorageService } from '../uploads/storage.service';
import {
  AiJobStatus,
  AppointmentStatus,
  TrainingSampleKind,
} from '../common/enums';

/**
 * Generates the AI summary for an uploaded report.
 *
 * Summarising a report takes tens of seconds on this hardware, so it never runs
 * inside the upload request — the upload returns immediately and the summary
 * appears when it is ready. There is no queue library in this project, so the
 * work runs in-process and a boot-time sweeper re-picks anything a restart left
 * unfinished. That is adequate for a single-clinic deployment; a multi-instance
 * one would want a real queue here.
 */
@Injectable()
export class ReportSummaryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReportSummaryService.name);
  private readonly enabled: boolean;

  /**
   * Summarisation runs through a single-lane queue. The local sidecar is one
   * worker doing blocking OCR + LLM, so firing several jobs at once (a patient
   * uploading 3–4 reports in a row) overwhelms it and some fail. Chaining every
   * job onto one promise serialises them without a queue library.
   */
  private queue: Promise<void> = Promise.resolve();

  private enqueue(job: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(job, job);
    return this.queue;
  }

  constructor(
    @InjectModel(PatientReport) private readonly reportModel: typeof PatientReport,
    @InjectModel(Appointment) private readonly appointmentModel: typeof Appointment,
    @InjectModel(AiTrainingSample)
    private readonly trainingModel: typeof AiTrainingSample,
    private readonly ai: AiClientService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {
    this.enabled = this.config.get<{ enabled: boolean }>('ai')!.enabled;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled) return;
    // Deliberately not awaited: a slow sweep must not hold up boot.
    void this.sweepUnfinished();
  }

  /**
   * Summarise a freshly uploaded report. Call without awaiting — the caller's
   * response should not wait on the model.
   */
  async summarizeInBackground(
    reportId: string,
    file: Express.Multer.File,
  ): Promise<void> {
    if (!this.enabled) return;
    await this.enqueue(async () => {
      try {
        await this.runOne(reportId, file);
      } catch (err) {
        // runOne already recorded the failure on the row; last-resort guard.
        this.logger.error(
          `Unhandled error summarising report ${reportId}: ${(err as Error).message}`,
        );
      }
    });
  }

  /** Re-run summarisation for one report, re-fetching the file from S3. */
  async retry(reportId: string): Promise<PatientReport> {
    const report = await this.reportModel.findByPk(reportId);
    if (!report) throw new Error('Report not found.');

    const file = await this.downloadAsUpload(report);
    await this.enqueue(() => this.runOne(reportId, file));
    return (await this.reportModel.findByPk(reportId))!;
  }

  /**
   * (Re)build the combined summary across every report a patient uploaded for
   * one visit. Called after each per-report summary completes, and on demand
   * from the doctor's "summarise all" retry.
   *
   *   0 ready reports → clear it (nothing to show).
   *   1 ready report  → mirror that summary (no need to ask the model).
   *   2+ ready        → ask the model for one clinical picture across them.
   */
  async consolidateForAppointment(appointmentId: string): Promise<void> {
    if (!this.enabled) return;

    const ready = await this.reportModel.findAll({
      where: {
        appointment_id: appointmentId,
        ai_summary_status: AiJobStatus.READY,
      },
      order: [['created_at', 'ASC']],
    });

    if (ready.length === 0) {
      await this.appointmentModel.update(
        {
          reports_summary: null,
          reports_summary_status: null,
          reports_summary_error: null,
          reports_summary_count: 0,
          reports_summarized_at: null,
        } as any,
        { where: { id: appointmentId } },
      );
      await this.clearProgress(appointmentId);
      return;
    }

    if (ready.length === 1) {
      await this.appointmentModel.update(
        {
          reports_summary: ready[0].ai_summary,
          reports_summary_status: AiJobStatus.READY,
          reports_summary_error: null,
          reports_summary_count: 1,
          reports_summarized_at: new Date(),
        } as any,
        { where: { id: appointmentId } },
      );
      await this.buildProgressForAppointment(appointmentId);
      return;
    }

    await this.appointmentModel.update(
      { reports_summary_status: AiJobStatus.PROCESSING, reports_summary_error: null },
      { where: { id: appointmentId } },
    );

    try {
      const { summary } = await this.ai.consolidateSummaries(
        ready
          .filter((r) => r.ai_summary)
          .map((r) => ({
            title: r.title,
            summary: r.ai_summary!.summary,
            key_findings: r.ai_summary!.key_findings ?? [],
            abnormal_values: r.ai_summary!.abnormal_values ?? [],
          })),
      );
      await this.appointmentModel.update(
        {
          reports_summary: summary,
          reports_summary_status: AiJobStatus.READY,
          reports_summary_error: null,
          reports_summary_count: ready.length,
          reports_summarized_at: new Date(),
        } as any,
        { where: { id: appointmentId } },
      );
      this.logger.log(
        `Consolidated ${ready.length} report summaries for appointment ${appointmentId}.`,
      );
      // This visit's picture just changed, so its trajectory is now stale.
      await this.buildProgressForAppointment(appointmentId);
    } catch (err) {
      const message = (err as Error).message || 'Consolidation failed.';
      await this.appointmentModel.update(
        {
          reports_summary_status: AiJobStatus.FAILED,
          reports_summary_error: message,
          reports_summary_count: ready.length,
        } as any,
        { where: { id: appointmentId } },
      );
      this.logger.warn(
        `Could not consolidate reports for appointment ${appointmentId}: ${message}`,
      );
    }
  }

  /**
   * Build this visit's trajectory: how the patient has moved since their last
   * visit, and where they stand now.
   *
   * Only the single most recent earlier visit is read — but nothing older is
   * lost. That visit contributes its own `progress_summary` when it has one,
   * and only falls back to its plain `reports_summary` if it was a first visit.
   * Because visit 2's trajectory already folded in visit 1, visit 3 inherits
   * visit 1's picture through it. The history travels forward in condensed
   * form, so this stays one indexed row read no matter how long the patient has
   * been coming.
   *
   * Scoped to the same patient **and** the same doctor: each doctor is a closed
   * environment, and a family member's reports must never leak in.
   */
  async buildProgressForAppointment(appointmentId: string): Promise<void> {
    if (!this.enabled) return;

    const appointment = await this.appointmentModel.findByPk(appointmentId);
    if (!appointment) return;

    // Without a patient there is nothing to build a history from (legacy rows).
    if (!appointment.patient_profile_id) {
      await this.clearProgress(appointmentId);
      return;
    }

    const current = await this.visitInput(appointment);
    if (!current) {
      await this.clearProgress(appointmentId);
      return;
    }

    const previous = await this.previousVisit(appointment);
    if (!previous) {
      // A first visit has no trajectory — the UI shows the visit summary alone.
      await this.clearProgress(appointmentId);
      return;
    }

    const previousInput = this.visitInputFromStored(previous);
    if (!previousInput) {
      await this.clearProgress(appointmentId);
      return;
    }

    await this.appointmentModel.update(
      {
        progress_summary_status: AiJobStatus.PROCESSING,
        progress_summary_error: null,
      } as any,
      { where: { id: appointmentId } },
    );

    try {
      const { summary } = await this.ai.summarizeProgress({
        patient: {
          age: appointment.patient_age,
          gender: appointment.patient_gender ?? undefined,
        },
        previous: previousInput,
        current,
      });
      await this.appointmentModel.update(
        {
          progress_summary: summary,
          progress_summary_status: AiJobStatus.READY,
          progress_summary_error: null,
          progress_summary_visit_count:
            (previous.progress_summary_visit_count || 1) + 1,
          progress_summarized_at: new Date(),
        } as any,
        { where: { id: appointmentId } },
      );
      this.logger.log(
        `Built progress summary for appointment ${appointmentId} against ${previous.appointment_date}.`,
      );
    } catch (err) {
      const message = (err as Error).message || 'Progress summary failed.';
      await this.appointmentModel.update(
        {
          progress_summary_status: AiJobStatus.FAILED,
          progress_summary_error: message,
        } as any,
        { where: { id: appointmentId } },
      );
      this.logger.warn(
        `Could not build progress for appointment ${appointmentId}: ${message}`,
      );
    }
  }

  /**
   * Save the doctor's version of the across-visits summary, and keep the pair
   * (what the model said, what the doctor signed off) as training data.
   *
   * The correction loop is the point. Reading a summary teaches the model
   * nothing; a doctor rewording "creatinine has worsened" into "first reading,
   * no trend yet" is exactly the supervision this task needs, and it is only
   * available at the moment the doctor is already looking at the text. Saves
   * with no change are recorded too — they confirm the model was right.
   */
  async saveProgressCorrection(
    appointmentId: string,
    corrected: ProgressSummary,
  ): Promise<Appointment> {
    const appointment = await this.appointmentModel.findByPk(appointmentId);
    if (!appointment) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'Appointment not found.',
      });
    }

    const original = appointment.progress_summary;
    const edited = JSON.stringify(original) !== JSON.stringify(corrected);

    await this.appointmentModel.update(
      {
        progress_summary: corrected,
        progress_summary_status: AiJobStatus.READY,
        progress_summary_error: null,
        progress_summarized_at: new Date(),
      } as any,
      { where: { id: appointmentId } },
    );

    const previous = await this.previousVisit(appointment);
    const current = await this.visitInput(appointment);
    await this.trainingModel.create({
      kind: TrainingSampleKind.PROGRESS_SUMMARY,
      appointment_id: appointment.id,
      doctor_id: appointment.doctor_id,
      input_payload: {
        patient: {
          age: appointment.patient_age,
          gender: appointment.patient_gender,
        },
        previous: previous ? this.visitInputFromStored(previous) : null,
        current,
      },
      ai_output: original as unknown as Record<string, unknown> | null,
      doctor_output: corrected as unknown as Record<string, unknown>,
      edited,
      model_version: null,
    } as any);

    return (await this.appointmentModel.findByPk(appointmentId))!;
  }

  /** Doctor-triggered rebuild of the across-visits summary. */
  async retryProgress(appointmentId: string): Promise<Appointment> {
    await this.enqueue(() => this.buildProgressForAppointment(appointmentId));
    return (await this.appointmentModel.findByPk(appointmentId))!;
  }

  /**
   * The one visit to compare against: same patient, same doctor, strictly
   * earlier, not cancelled, and carrying a summary worth reading.
   */
  private async previousVisit(
    appointment: Appointment,
  ): Promise<Appointment | null> {
    return this.appointmentModel.findOne({
      where: {
        patient_profile_id: appointment.patient_profile_id,
        doctor_id: appointment.doctor_id,
        id: { [Op.ne]: appointment.id },
        status: { [Op.ne]: AppointmentStatus.CANCELLED },
        reports_summary_status: AiJobStatus.READY,
        [Op.or]: [
          { appointment_date: { [Op.lt]: appointment.appointment_date } },
          {
            appointment_date: appointment.appointment_date,
            start_time: { [Op.lt]: appointment.start_time },
          },
        ],
      },
      order: [
        ['appointment_date', 'DESC'],
        ['start_time', 'DESC'],
      ],
    });
  }

  /** This visit's own reports, as the comparison input. */
  private async visitInput(
    appointment: Appointment,
  ): Promise<AiVisitInput | null> {
    const ready = await this.reportModel.findAll({
      where: {
        appointment_id: appointment.id,
        ai_summary_status: AiJobStatus.READY,
      },
      order: [['created_at', 'ASC']],
    });
    const reports = ready
      .filter((r) => r.ai_summary)
      .map((r) => ({
        title: r.title,
        summary: r.ai_summary!.summary,
        key_findings: r.ai_summary!.key_findings ?? [],
        abnormal_values: r.ai_summary!.abnormal_values ?? [],
      }));
    if (reports.length === 0) return null;
    return { visit_date: appointment.appointment_date, reports };
  }

  /**
   * The earlier visit as a single condensed "report". Its trajectory is
   * preferred over its raw report summary: that is what carries everything
   * before it forward.
   */
  private visitInputFromStored(previous: Appointment): AiVisitInput | null {
    if (previous.progress_summary) {
      const p = previous.progress_summary;
      return {
        visit_date: previous.appointment_date,
        reports: [
          {
            title: `Visit of ${previous.appointment_date} (including earlier visits)`,
            summary: [p.summary, p.current_status].filter(Boolean).join(' '),
            key_findings: [
              ...p.improvements,
              ...p.deteriorations,
              ...p.unchanged,
            ],
            // Carry the last known value of each tracked measurement, so the
            // next comparison still has something concrete to match on.
            abnormal_values: (p.trends ?? []).map((t) => ({
              label: t.label,
              value: t.current_value,
              direction: 'abnormal' as const,
            })),
          },
        ],
      };
    }
    if (previous.reports_summary) {
      const r = previous.reports_summary;
      return {
        visit_date: previous.appointment_date,
        reports: [
          {
            title: `Visit of ${previous.appointment_date}`,
            summary: r.summary,
            key_findings: r.key_findings ?? [],
            abnormal_values: r.abnormal_values ?? [],
          },
        ],
      };
    }
    return null;
  }

  private async clearProgress(appointmentId: string): Promise<void> {
    await this.appointmentModel.update(
      {
        progress_summary: null,
        progress_summary_status: null,
        progress_summary_error: null,
        progress_summary_visit_count: 0,
        progress_summarized_at: null,
      } as any,
      { where: { id: appointmentId } },
    );
  }

  /** Doctor-triggered rebuild of one visit's combined report summary. */
  async retryConsolidation(appointmentId: string): Promise<Appointment> {
    await this.consolidateForAppointment(appointmentId);
    return (await this.appointmentModel.findByPk(appointmentId))!;
  }

  // ── internals ──────────────────────────────────────────────

  private async runOne(
    reportId: string,
    file: Express.Multer.File,
  ): Promise<void> {
    await this.reportModel.update(
      { ai_summary_status: AiJobStatus.PROCESSING, ai_summary_error: null },
      { where: { id: reportId } },
    );

    try {
      const { summary, model_version } = await this.ai.summarizeReport(file);
      await this.reportModel.update(
        {
          ai_summary: summary,
          ai_summary_status: AiJobStatus.READY,
          ai_summary_error: null,
          ai_model_version: model_version,
          ai_summarized_at: new Date(),
        } as any,
        { where: { id: reportId } },
      );
      this.logger.log(`Summarised report ${reportId}.`);
      // A report belongs to one visit; refresh that visit's combined summary.
      const done = await this.reportModel.findByPk(reportId);
      if (done?.appointment_id) {
        await this.consolidateForAppointment(done.appointment_id);
      }
    } catch (err) {
      const message = (err as Error).message || 'Summarisation failed.';
      await this.reportModel.update(
        {
          ai_summary_status: AiJobStatus.FAILED,
          ai_summary_error: message,
        } as any,
        { where: { id: reportId } },
      );
      this.logger.warn(`Could not summarise report ${reportId}: ${message}`);
    }
  }

  /**
   * Pick up reports left unfinished — either never started, or interrupted
   * mid-run by a restart (which would otherwise strand them in `processing`).
   */
  private async sweepUnfinished(): Promise<void> {
    const stranded = await this.reportModel.findAll({
      where: {
        ai_summary_status: {
          [Op.in]: [AiJobStatus.PENDING, AiJobStatus.PROCESSING],
        },
      },
      order: [['created_at', 'ASC']],
      limit: 25, // bound the work so a large backlog doesn't saturate the host
    });
    if (stranded.length === 0) return;

    if (!(await this.ai.isHealthy())) {
      this.logger.warn(
        `${stranded.length} report(s) await summarising, but the AI service ` +
          'is not ready. They will be retried on the next start.',
      );
      return;
    }

    this.logger.log(`Summarising ${stranded.length} pending report(s).`);
    for (const report of stranded) {
      try {
        const file = await this.downloadAsUpload(report);
        await this.enqueue(() => this.runOne(report.id, file));
      } catch (err) {
        this.logger.warn(
          `Skipping report ${report.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  /** Re-hydrate a stored report into the in-memory shape the AI client takes. */
  private async downloadAsUpload(
    report: PatientReport,
  ): Promise<Express.Multer.File> {
    const buffer = await this.storage.download(report.file_key);
    const name = report.file_key.split('/').pop() || 'report';
    return {
      buffer,
      originalname: name,
      mimetype: this.mimeFromKey(name),
      size: buffer.length,
    } as Express.Multer.File;
  }

  private mimeFromKey(name: string): string {
    const ext = name.toLowerCase().split('.').pop();
    switch (ext) {
      case 'pdf':
        return 'application/pdf';
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      default:
        return 'image/jpeg';
    }
  }
}
