import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { PrescriptionTemplate } from './prescription-template.model';

/**
 * One medicine line on a template.
 *
 * The columns mirror `EPrescriptionMedicine`, so applying a template is a
 * column-for-column copy. The exception is `timing`, which exists there but is
 * hardcoded to null by `replaceMedicines` — food timing lives in
 * `instructions` now, and mirroring a dead column would only invite the two to
 * disagree.
 */
@Table({
  tableName: 'prescription_template_medicines',
  timestamps: true,
  underscored: true,
})
export class PrescriptionTemplateMedicine extends Model<PrescriptionTemplateMedicine> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @ForeignKey(() => PrescriptionTemplate)
  @Column({ type: DataType.UUID, allowNull: false })
  template_id: string;

  @Column({ type: DataType.SMALLINT, allowNull: false, defaultValue: 0 })
  position: number;

  @Column({ type: DataType.STRING, allowNull: false })
  medicine_name: string;

  @Column({ type: DataType.STRING, allowNull: true })
  strength: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  form: string | null;

  /**
   * "1-0-1", but equally "As needed" or "After each loose stool" — free text,
   * because a template is what the doctor would have written by hand.
   */
  @Column({ type: DataType.STRING, allowNull: false })
  dosage: string;

  /** What the prescription reads. Null when the text carries no number. */
  @Column({ type: DataType.SMALLINT, allowNull: true })
  duration_days: number | null;

  /**
   * What the doctor typed. Kept because a smallint cannot hold "Continue",
   * which a built-in fertility template needs for folic acid.
   */
  @Column({ type: DataType.STRING(40), allowNull: true })
  duration_text: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  instructions: string | null;

  @BelongsTo(() => PrescriptionTemplate)
  template: PrescriptionTemplate;
}
