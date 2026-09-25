import { Column, DataType, Model, Table } from 'sequelize-typescript';

/** The sidecar route that spent the money. */
export type AiUsageRoute =
  | 'stt'
  | 'prescription'
  | 'report-summary'
  | 'report-summary-image'
  | 'consolidate'
  | 'progress';

/**
 * One billable AI call, against the appointment that caused it.
 *
 * The sidecar computes these numbers and returns them with each response; this
 * service writes them down, because it is the only side that knows what an
 * appointment is. See the migration for why both currencies are stored and why
 * `appointment_id` is nullable.
 */
@Table({ tableName: 'ai_usage_events', timestamps: true, underscored: true })
export class AiUsageEvent extends Model<AiUsageEvent> {
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
  id: string;

  @Column({ type: DataType.UUID, allowNull: true })
  appointment_id: string | null;

  @Column({ type: DataType.UUID, allowNull: true })
  session_id: string | null;

  @Column({ type: DataType.UUID, allowNull: true })
  report_id: string | null;

  @Column({ type: DataType.STRING(32), allowNull: false })
  route: AiUsageRoute | string;

  @Column({ type: DataType.STRING(16), allowNull: false })
  provider: string;

  @Column({ type: DataType.STRING(64), allowNull: false, defaultValue: '' })
  model: string;

  /** Speech only — what was billed is the audio length, per second. */
  @Column({ type: DataType.DECIMAL(10, 2), allowNull: true })
  audio_seconds: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  input_tokens: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  output_tokens: number | null;

  /** Bills at the output rate, so never free even though it is invisible. */
  @Column({ type: DataType.INTEGER, allowNull: true })
  thinking_tokens: number | null;

  @Column({ type: DataType.DECIMAL(12, 6), allowNull: false, defaultValue: 0 })
  cost_inr: number;

  /** Actually billed. Zero on the Gemini free tier. */
  @Column({ type: DataType.DECIMAL(14, 8), allowNull: false, defaultValue: 0 })
  cost_usd: number;

  /** What a paid key would charge — the figure to plan with. */
  @Column({ type: DataType.DECIMAL(14, 8), allowNull: false, defaultValue: 0 })
  would_cost_usd: number;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  free_tier: boolean;

  @Column({ type: DataType.DECIMAL(8, 3), allowNull: false, defaultValue: 0 })
  elapsed_seconds: number;
}
