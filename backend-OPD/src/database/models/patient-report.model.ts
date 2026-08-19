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
import { AiJobStatus } from '../../common/enums';

/** Structured summary produced by the local AI service. */
export interface ReportAiSummary {
  report_type: string;
  summary: string;
  key_findings: string[];
  abnormal_values: {
    label: string;
    value: string;
    reference?: string;
    direction: 'high' | 'low' | 'abnormal';
  }[];
}

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

  // ── AI summary (generated asynchronously after upload) ─────

  @Column({ type: DataType.JSONB, allowNull: true })
  ai_summary: ReportAiSummary | null;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    defaultValue: AiJobStatus.PENDING,
  })
  ai_summary_status: AiJobStatus;

  /** Why summarisation failed, shown to the doctor so it isn't a silent gap. */
  @Column({ type: DataType.TEXT, allowNull: true })
  ai_summary_error: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  ai_model_version: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  ai_summarized_at: Date | null;

  @BelongsTo(() => User)
  uploadedBy: User;

  @BelongsTo(() => Appointment)
  appointment: Appointment;
}
