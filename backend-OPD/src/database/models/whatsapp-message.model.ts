import { Column, DataType, Model, Table } from 'sequelize-typescript';

/** Our own states before Meta reports anything, then Meta's delivery states. */
export type WhatsAppMessageStatus =
  | 'queued'
  | 'accepted'
  | 'error'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed';

/** One status update from Meta's webhook, kept verbatim. */
export interface WhatsAppStatusEntry {
  status: string;
  at: string;
  errors?: unknown;
  raw?: unknown;
}

/**
 * One WhatsApp message this server sent and everything Meta said about it.
 * See the migration for the lifecycle.
 */
@Table({ tableName: 'whatsapp_messages', timestamps: true, underscored: true })
export class WhatsAppMessage extends Model<WhatsAppMessage> {
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
  id: string;

  @Column({ type: DataType.STRING(32), allowNull: false })
  kind: string;

  @Column({ type: DataType.STRING(20), allowNull: false })
  to: string;

  @Column({ type: DataType.STRING, allowNull: true })
  template: string | null;

  @Column({ type: DataType.STRING(16), allowNull: true })
  language: string | null;

  @Column({ type: DataType.STRING, allowNull: true, unique: true })
  wa_message_id: string | null;

  @Column({ type: DataType.STRING(16), allowNull: false, defaultValue: 'queued' })
  status: WhatsAppMessageStatus;

  @Column({ type: DataType.DATE, allowNull: true })
  status_at: Date | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  error_code: number | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  error_message: string | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  request: Record<string, unknown> | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  response: Record<string, unknown> | null;

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: [] })
  status_log: WhatsAppStatusEntry[];

  @Column({ type: DataType.STRING, allowNull: true })
  reference: string | null;
}
