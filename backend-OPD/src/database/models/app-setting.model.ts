import { Column, DataType, Model, Table } from 'sequelize-typescript';

/**
 * A platform setting the super admin can change at runtime.
 *
 * Key/value on purpose: these are operational knobs (the patient portal's
 * address, and whatever follows it), not domain data, and adding one should
 * not cost a migration.
 */
@Table({
  tableName: 'app_settings',
  timestamps: true,
  underscored: true,
})
export class AppSetting extends Model<AppSetting> {
  @Column({ type: DataType.STRING(80), primaryKey: true, allowNull: false })
  key: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  value: string | null;
}
