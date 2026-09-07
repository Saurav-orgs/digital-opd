import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { ActivityAction, ActivityActor } from '../../common/enums';

/**
 * One recorded activity. Immutable — written once, never updated, never
 * deleted by the application.
 *
 * Deliberately carries no associations. A log row has to outlive the things it
 * describes: an appointment can be deleted, a user can leave, and the record
 * that they existed and what was done is precisely what must survive. The ids
 * are kept as plain columns and `actor_label` / `summary` carry enough text to
 * read the row on its own.
 */
@Table({
  tableName: 'activity_logs',
  timestamps: true,
  updatedAt: false,
  underscored: true,
})
export class ActivityLog extends Model<ActivityLog> {
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
  id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  actor_type: ActivityActor;

  /** users.id or patient_profiles.id; null for system activity. */
  @Column({ type: DataType.UUID, allowNull: true })
  actor_id: string | null;

  /** Name or mobile as it was at the time, so the row still reads later. */
  @Column({ type: DataType.STRING, allowNull: false })
  actor_label: string;

  /** Owning clinic; null for platform-level acts by the super admin. */
  @Column({ type: DataType.UUID, allowNull: true })
  doctor_id: string | null;

  @Column({ type: DataType.STRING, allowNull: false })
  action: ActivityAction;

  /** What was acted on, e.g. 'appointment', 'prescription'. */
  @Column({ type: DataType.STRING, allowNull: true })
  entity_type: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  entity_id: string | null;

  /** One human-readable sentence — the column a person actually reads. */
  @Column({ type: DataType.TEXT, allowNull: false })
  summary: string;

  /** Structured extras: previous status, slot times, counts. */
  @Column({ type: DataType.JSONB, allowNull: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: DataType.STRING, allowNull: true })
  ip: string | null;
}
