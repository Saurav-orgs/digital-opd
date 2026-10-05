import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  HasMany,
  Model,
  Table,
} from 'sequelize-typescript';
import { Doctor } from './doctor.model';
import { PrescriptionTemplateMedicine } from './prescription-template-medicine.model';

/**
 * A saved prescription the doctor applies to a visit and then adjusts.
 *
 * `doctor_id === null` is a built-in: shipped with the product and read by
 * every tenant. A doctor editing one does not mutate the shared row — the
 * write lands as their own row carrying `builtin_source_id`, which the list
 * uses to show the override in place of what it shadows.
 *
 * For the same reason there is no `usage_count` here — see
 * `PrescriptionTemplateUsage`.
 */
@Table({
  tableName: 'prescription_templates',
  timestamps: true,
  underscored: true,
  paranoid: true,
})
export class PrescriptionTemplate extends Model<PrescriptionTemplate> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  /** NULL = built-in, shared by every tenant. */
  @ForeignKey(() => Doctor)
  @Column({ type: DataType.UUID, allowNull: true })
  doctor_id: string | null;

  /** Set when this row is one doctor's edit of a built-in. */
  @ForeignKey(() => PrescriptionTemplate)
  @Column({ type: DataType.UUID, allowNull: true })
  builtin_source_id: string | null;

  @Column({ type: DataType.STRING(80), allowNull: false })
  category: string;

  @Column({ type: DataType.STRING(160), allowNull: false })
  name: string;

  /** May be the entire template — an advice-only template is valid. */
  @Column({ type: DataType.TEXT, allowNull: true })
  advice: string | null;

  @Column({ type: DataType.SMALLINT, allowNull: true })
  follow_up_days: number | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  is_builtin: boolean;

  @BelongsTo(() => Doctor)
  doctor: Doctor;

  @HasMany(() => PrescriptionTemplateMedicine)
  medicines: PrescriptionTemplateMedicine[];
}
