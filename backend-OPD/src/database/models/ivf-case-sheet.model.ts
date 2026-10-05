import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { Appointment } from './appointment.model';
import { Doctor } from './doctor.model';
import { PrescriptionStatus } from '../../common/enums';
import { IvfCaseSheetData } from '../../ivf-case-sheets/ivf-case-sheet.schema';

/**
 * An IVF & Fertility doctor's case-sheet for one visit. Exactly one per
 * appointment: a draft the doctor fills, then issues — issuing renders the PDF
 * onto their letterhead and makes it visible to the patient, the same shape as
 * `EPrescription`. The body lives whole in `data` (see the migration).
 */
@Table({
  tableName: 'ivf_case_sheets',
  timestamps: true,
  underscored: true,
  paranoid: true,
})
export class IvfCaseSheet extends Model<IvfCaseSheet> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @ForeignKey(() => Appointment)
  @Column({ type: DataType.UUID, allowNull: false })
  appointment_id: string;

  @ForeignKey(() => Doctor)
  @Column({ type: DataType.UUID, allowNull: false })
  doctor_id: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    defaultValue: PrescriptionStatus.DRAFT,
  })
  status: PrescriptionStatus;

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {} })
  data: IvfCaseSheetData;

  /** S3 key of the generated PDF, written when the sheet is issued. */
  @Column({ type: DataType.STRING, allowNull: true })
  pdf_key: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  issued_at: Date | null;

  @BelongsTo(() => Appointment)
  appointment: Appointment;

  @BelongsTo(() => Doctor)
  doctor: Doctor;
}
