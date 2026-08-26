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
import { PatientProfile } from './patient-profile.model';

/** One label's movement between the previous visit and this one. */
export interface ProgressTrend {
  label: string;
  previous_value: string;
  current_value: string;
  direction: 'up' | 'down' | 'same';
  interpretation: 'better' | 'worse' | 'unclear';
}

/**
 * The across-visits picture: what changed since last time and where the
 * patient stands now. Produced by the AI service's `/summarize-progress`.
 */
export interface ProgressSummary {
  status: 'improving' | 'stable' | 'worsening' | 'unclear';
  summary: string;
  improvements: string[];
  deteriorations: string[];
  unchanged: string[];
  trends: ProgressTrend[];
  current_status: string;
  watch_points: string[];
}

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

  /**
   * Which person this visit is for. The name/mobile/age below stay as a
   * point-in-time snapshot of what was entered; this is the clinical identity
   * that history and summaries are scoped by.
   */
  @ForeignKey(() => PatientProfile)
  @Column({ type: DataType.UUID, allowNull: true })
  patient_profile_id: string | null;

  @BelongsTo(() => PatientProfile)
  patientProfile: PatientProfile;

  @Column({ type: DataType.STRING, allowNull: false })
  patient_name: string;

  @Column({ type: DataType.STRING, allowNull: false })
  patient_mobile: string;

  /** male | female | other — captured at booking. */
  @Column({ type: DataType.STRING, allowNull: true })
  patient_gender: string | null;

  @Column({ type: DataType.SMALLINT, allowNull: true })
  patient_age: number | null;

  /** Address line (house / street). City, state and PIN follow. */
  @Column({ type: DataType.TEXT, allowNull: true })
  patient_address: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  patient_city: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  patient_state: string | null;

  @Column({ type: DataType.STRING(6), allowNull: true })
  patient_pincode: string | null;

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

  // ── Combined summary carried across visits ─────────────────
  // Built from the previous visit's summary plus this visit's reports, so the
  // doctor reads one trajectory rather than comparing cards by eye. Null status
  // means there was no earlier visit to compare against — the UI then falls
  // back to `reports_summary`.

  @Column({ type: DataType.JSONB, allowNull: true })
  progress_summary: ProgressSummary | null;

  @Column({ type: DataType.STRING, allowNull: true })
  progress_summary_status: AiJobStatus | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  progress_summary_error: string | null;

  /** How many visits the trajectory covers, this one included. */
  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  progress_summary_visit_count: number;

  @Column({ type: DataType.DATE, allowNull: true })
  progress_summarized_at: Date | null;

  @BelongsTo(() => Doctor)
  doctor: Doctor;

  @HasMany(() => AppointmentPrescription)
  prescriptions: AppointmentPrescription[];
}
