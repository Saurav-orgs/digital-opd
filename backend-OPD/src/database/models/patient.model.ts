import { Column, DataType, Model, Table } from 'sequelize-typescript';

/** Phone-only patient login identity. `mobile` is the unique key everywhere. */
@Table({
  tableName: 'patients',
  timestamps: true,
  underscored: true,
})
export class Patient extends Model<Patient> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  mobile: string;

  @Column({ type: DataType.STRING, allowNull: false })
  name: string;
}
