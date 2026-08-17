import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { User } from './user.model';
import { Appointment } from './appointment.model';

/** A pathlab-uploaded report file (S3 object key), keyed by patient mobile. */
@Table({
  tableName: 'patient_reports',
  timestamps: true,
  underscored: true,
})
export class PatientReport extends Model<PatientReport> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  patient_mobile: string;

  @Column({ type: DataType.STRING, allowNull: false })
  title: string;

  /** S3 object key for the uploaded report (image or PDF). */
  @Column({ type: DataType.STRING, allowNull: false })
  file_key: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: true })
  uploaded_by_user_id: string | null;

  @ForeignKey(() => Appointment)
  @Column({ type: DataType.UUID, allowNull: true })
  appointment_id: string | null;

  @BelongsTo(() => User)
  uploadedBy: User;

  @BelongsTo(() => Appointment)
  appointment: Appointment;
}
