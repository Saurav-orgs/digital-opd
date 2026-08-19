import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { Appointment } from './appointment.model';
import { ConsultationSessionStatus } from '../../common/enums';

/**
 * One recorded consultation. The audio is transcribed and then discarded — only
 * the transcript is kept, so the doctor can check what a draft was based on
 * without the clinic storing recordings of patients.
 */
@Table({
  tableName: 'consultation_sessions',
  timestamps: true,
  underscored: true,
})
export class ConsultationSession extends Model<ConsultationSession> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @ForeignKey(() => Appointment)
  @Column({ type: DataType.UUID, allowNull: false })
  appointment_id: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    defaultValue: ConsultationSessionStatus.TRANSCRIBING,
  })
  status: ConsultationSessionStatus;

  @Column({ type: DataType.TEXT, allowNull: true })
  transcript: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  language: string | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  duration_seconds: number | null;

  @Column({ type: DataType.STRING, allowNull: true })
  model_version: string | null;

  /** Readable reason shown to the doctor when transcription or drafting fails. */
  @Column({ type: DataType.TEXT, allowNull: true })
  error: string | null;

  @BelongsTo(() => Appointment)
  appointment: Appointment;
}
