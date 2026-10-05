import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { Doctor } from './doctor.model';
import { PrescriptionTemplate } from './prescription-template.model';

/**
 * How often one clinic has used one template.
 *
 * Not a column on the template: the built-ins are single rows shared by every
 * tenant, so a counter there would total everybody's use of them and let one
 * clinic's habits order another clinic's menu. Same leak the override row
 * exists to prevent, one table further down.
 */
@Table({
  tableName: 'prescription_template_usage',
  timestamps: true,
  underscored: true,
})
export class PrescriptionTemplateUsage extends Model<PrescriptionTemplateUsage> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @ForeignKey(() => Doctor)
  @Column({ type: DataType.UUID, allowNull: false })
  doctor_id: string;

  @ForeignKey(() => PrescriptionTemplate)
  @Column({ type: DataType.UUID, allowNull: false })
  template_id: string;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  usage_count: number;

  @Column({ type: DataType.DATE, allowNull: true })
  last_used_at: Date | null;

  @BelongsTo(() => Doctor)
  doctor: Doctor;

  @BelongsTo(() => PrescriptionTemplate)
  template: PrescriptionTemplate;
}
