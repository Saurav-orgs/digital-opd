import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { EPrescription } from './e-prescription.model';
import { MedicineSource } from '../../common/enums';

/** One medicine line on a prescription. */
@Table({
  tableName: 'e_prescription_medicines',
  timestamps: true,
  underscored: true,
})
export class EPrescriptionMedicine extends Model<EPrescriptionMedicine> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @ForeignKey(() => EPrescription)
  @Column({ type: DataType.UUID, allowNull: false })
  e_prescription_id: string;

  /** Display order, so the doctor's arrangement survives a reload. */
  @Column({ type: DataType.SMALLINT, allowNull: false, defaultValue: 0 })
  position: number;

  @Column({ type: DataType.STRING, allowNull: false })
  medicine_name: string;

  @Column({ type: DataType.STRING, allowNull: true })
  strength: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  form: string | null;

  /** Morning-afternoon-night, e.g. "1-0-1". Required — a medicine with no
   *  dosage is not a prescription. */
  @Column({ type: DataType.STRING, allowNull: false })
  dosage: string;

  @Column({ type: DataType.STRING, allowNull: true })
  timing: string | null;

  @Column({ type: DataType.SMALLINT, allowNull: true })
  duration_days: number | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  instructions: string | null;

  /** Whether the AI suggested this row or the doctor typed it. */
  @Column({
    type: DataType.STRING,
    allowNull: false,
    defaultValue: MedicineSource.DOCTOR,
  })
  source: MedicineSource;

  /** True when the doctor changed an AI-suggested row — the signal that matters
   *  most for fine-tuning, since it marks exactly what the model got wrong. */
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  was_edited: boolean;

  @BelongsTo(() => EPrescription)
  prescription: EPrescription;
}
