import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  HasMany,
  Model,
  Table,
} from 'sequelize-typescript';
import { Appointment } from './appointment.model';
import { ConsultationSession } from './consultation-session.model';
import { EPrescriptionMedicine } from './e-prescription-medicine.model';
import { PrescriptionStatus } from '../../common/enums';

/**
 * The doctor's e-prescription for one visit. Exactly one per appointment: it
 * starts as a draft (AI-generated or blank), is edited, and is then issued —
 * issuing is what makes it visible to the patient.
 */
@Table({
  tableName: 'e_prescriptions',
  timestamps: true,
  underscored: true,
})
export class EPrescription extends Model<EPrescription> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @ForeignKey(() => Appointment)
  @Column({ type: DataType.UUID, allowNull: false })
  appointment_id: string;

  /** Null when the doctor wrote this by hand rather than dictating it. */
  @ForeignKey(() => ConsultationSession)
  @Column({ type: DataType.UUID, allowNull: true })
  consultation_session_id: string | null;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    defaultValue: PrescriptionStatus.DRAFT,
  })
  status: PrescriptionStatus;

  @Column({ type: DataType.TEXT, allowNull: true })
  diagnosis: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  advice: string | null;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  follow_up_date: string | null;

  /** S3 key of the generated PDF, written when the prescription is issued. */
  @Column({ type: DataType.STRING, allowNull: true })
  pdf_key: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  issued_at: Date | null;

  @BelongsTo(() => Appointment)
  appointment: Appointment;

  @BelongsTo(() => ConsultationSession)
  consultationSession: ConsultationSession;

  @HasMany(() => EPrescriptionMedicine)
  medicines: EPrescriptionMedicine[];
}
