import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  HasMany,
  Model,
  Table,
} from 'sequelize-typescript';
import {
  AiJobStatus,
  AppointmentStatus,
  BookingSource,
  ConsultationStatus,
} from '../../common/enums';
import { ReportAiSummary } from './patient-report.model';
import { Doctor } from './doctor.model';
import { AppointmentPrescription } from './prescription.model';

@Table({
  tableName: 'appointments',
  timestamps: true,
  underscored: true,
})
export class Appointment extends Model<Appointment> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @ForeignKey(() => Doctor)
  @Column({ type: DataType.UUID, allowNull: false })
  doctor_id: string;

  @Column({ type: DataType.DATEONLY, allowNull: false })
  appointment_date: string;

  @Column({ type: DataType.TIME, allowNull: false })
  start_time: string;

  @Column({ type: DataType.TIME, allowNull: false })
  end_time: string;

  @Column({ type: DataType.STRING, allowNull: false })
  patient_name: string;

  @Column({ type: DataType.STRING, allowNull: false })
  patient_mobile: string;

  /** male | female | other — captured at booking. */
  @Column({ type: DataType.STRING, allowNull: true })
  patient_gender: string | null;

  @Column({ type: DataType.SMALLINT, allowNull: true })
  patient_age: number | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  patient_address: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  description: string | null;

  /** Doctor's free-text note, referred to on the patient's next OPD visit. */
  @Column({ type: DataType.TEXT, allowNull: true })
  doctor_notes: string | null;

  /** Doctor's reminder for the patient's next visit, set from this visit. */
  @Column({ type: DataType.TEXT, allowNull: true })
  next_visit_note: string | null;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  next_visit_date: string | null;

  /** Only `confirmed` occupies a slot (partial unique index). */
  @Column({
    type: DataType.STRING,
    allowNull: false,
    defaultValue: AppointmentStatus.CONFIRMED,
  })
  status: AppointmentStatus;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    defaultValue: ConsultationStatus.PENDING,
  })
  consultation_status: ConsultationStatus;

  @Column({ type: DataType.STRING, allowNull: false })
  source: BookingSource;

  // ── Consolidated AI summary of the patient's uploaded reports ──

  @Column({ type: DataType.JSONB, allowNull: true })
  reports_summary: ReportAiSummary | null;

  /** null = nothing to summarise; else pending|processing|ready|failed. */
  @Column({ type: DataType.STRING, allowNull: true })
  reports_summary_status: AiJobStatus | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  reports_summary_error: string | null;

  /** How many report summaries this consolidation covered. */
  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  reports_summary_count: number;

  @Column({ type: DataType.DATE, allowNull: true })
  reports_summarized_at: Date | null;

  @BelongsTo(() => Doctor)
  doctor: Doctor;

  @HasMany(() => AppointmentPrescription)
  prescriptions: AppointmentPrescription[];
}
