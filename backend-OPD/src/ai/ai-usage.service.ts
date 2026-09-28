import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { AiUsageEvent } from '../database/models/ai-usage-event.model';
import { Appointment } from '../database/models/appointment.model';

/** One billable call, exactly as the sidecar reports it. */
export interface AiUsage {
  route: string;
  provider: string;
  model?: string;
  audio_seconds?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  thinking_tokens?: number | null;
  cost_inr?: number;
  cost_usd?: number;
  would_cost_usd?: number;
  free_tier?: boolean;
  elapsed_seconds?: number;
}

/** Which thing the spend belongs to. All optional — see `record`. */
export interface AiUsageContext {
  appointmentId?: string | null;
  sessionId?: string | null;
  reportId?: string | null;
}

/**
 * Writes down what the AI cost, per appointment.
 *
 * The sidecar prices every call it makes and returns the numbers with the
 * response; this service is the only place that stores them, so cost
 * accounting lives in one file rather than smeared across the six call sites
 * that happen to spend money.
 */
@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(
    @InjectModel(AiUsageEvent)
    private readonly usageModel: typeof AiUsageEvent,
    @InjectModel(Appointment)
    private readonly appointmentModel: typeof Appointment,
  ) {}

  /**
   * Store these calls and add them to the appointment's running total.
   *
   * Never throws. Accounting must not be able to fail a consultation: a
   * doctor losing a prescription because a cost row would not insert is a
   * far worse outcome than a missing row, and the sidecar's JSONL log still
   * has the call either way. Failures are logged and swallowed, the same
   * bargain `ai-OPD/app/cost_log.py` already makes for the same reason.
   */
  async record(usage: AiUsage[] | undefined, ctx: AiUsageContext): Promise<void> {
    if (!usage?.length) return;

    try {
      await this.usageModel.bulkCreate(
        usage.map((u) => ({
          appointment_id: ctx.appointmentId ?? null,
          session_id: ctx.sessionId ?? null,
          report_id: ctx.reportId ?? null,
          route: u.route,
          provider: u.provider,
          model: u.model ?? '',
          audio_seconds: u.audio_seconds ?? null,
          input_tokens: u.input_tokens ?? null,
          output_tokens: u.output_tokens ?? null,
          thinking_tokens: u.thinking_tokens ?? null,
          cost_inr: u.cost_inr ?? 0,
          cost_usd: u.cost_usd ?? 0,
          would_cost_usd: u.would_cost_usd ?? 0,
          free_tier: u.free_tier ?? false,
          elapsed_seconds: u.elapsed_seconds ?? 0,
        })) as any,
      );

      if (!ctx.appointmentId) return;

      const inr = sum(usage, 'cost_inr');
      // The would-cost, not what was billed: on the Gemini free tier the
      // latter is zero, and an appointment that reads as free to run is a
      // number nobody can plan with.
      const usd = sum(usage, 'would_cost_usd');
      if (!inr && !usd) return;

      // An atomic increment, not read-modify-write. The live transcription
      // pump runs several chunks at once now, so two of these land inside
      // each other routinely; reading the total and writing it back would
      // lose one of them and quietly under-report the bill.
      await this.appointmentModel.increment(
        { ai_cost_inr: inr, ai_cost_usd: usd } as any,
        { where: { id: ctx.appointmentId } },
      );
    } catch (err) {
      this.logger.warn(
        `AI usage not recorded for appointment ${ctx.appointmentId ?? '-'}: ${
          (err as Error).message
        }`,
      );
    }
  }
}

function sum(usage: AiUsage[], field: 'cost_inr' | 'would_cost_usd'): number {
  return usage.reduce((total, u) => total + (Number(u[field]) || 0), 0);
}
