import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { PatientReport } from '../database/models/patient-report.model';
import { Appointment } from '../database/models/appointment.model';
import { AiClientService } from '../ai/ai-client.service';
import { StorageService } from '../uploads/storage.service';
import { AiJobStatus } from '../common/enums';

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
