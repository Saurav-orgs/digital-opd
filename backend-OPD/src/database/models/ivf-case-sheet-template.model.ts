import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { Doctor } from './doctor.model';
import { IvfCaseSheetData } from '../../ivf-case-sheets/ivf-case-sheet.schema';

/**
 * A saved IVF case-sheet the doctor applies to a new visit and then adjusts.
 *
 * Simpler than `PrescriptionTemplate`: no built-ins and no overrides, because
 * the form belongs to the one clinic and there is nothing product-wide to ship.
 * It is a name over a `data` body of the same shape as `IvfCaseSheet.data`.
 */
@Table({
  tableName: 'ivf_case_sheet_templates',
  timestamps: true,
  underscored: true,
  paranoid: true,
})
export class IvfCaseSheetTemplate extends Model<IvfCaseSheetTemplate> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @ForeignKey(() => Doctor)
  @Column({ type: DataType.UUID, allowNull: false })
  doctor_id: string;

  @Column({ type: DataType.STRING(160), allowNull: false })
  name: string;

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {} })
  data: IvfCaseSheetData;

  @BelongsTo(() => Doctor)
  doctor: Doctor;
}
