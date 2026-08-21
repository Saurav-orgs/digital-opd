import { BelongsTo, Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript';
import { Doctor } from './doctor.model';
import { NotificationType } from '../../common/enums';

/** In-app notification for a patient, keyed by mobile. */
@Table({
  tableName: 'notifications',
  timestamps: true,
  underscored: true,
})
export class Notification extends Model<Notification> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  patient_mobile: string;

  @Column({ type: DataType.STRING, allowNull: false })
  type: NotificationType;

  @Column({ type: DataType.STRING, allowNull: false })
  title: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  body: string | null;

  /** Freeform payload, e.g. `{ reportId }` or `{ suggestedDate }`. */
  @Column({ type: DataType.JSONB, allowNull: true })
  data: Record<string, unknown> | null;

  @Column({ type: DataType.DATE, allowNull: true })
  read_at: Date | null;

  @ForeignKey(() => Doctor)
  @Column({ type: DataType.UUID, allowNull: true })
  doctor_id: string | null;

  @BelongsTo(() => Doctor)
  doctor: Doctor;
}
