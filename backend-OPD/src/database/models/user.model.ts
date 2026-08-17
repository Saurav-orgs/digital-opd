import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { UserType } from '../../common/enums';
import { Role } from './role.model';
import { Doctor } from './doctor.model';

@Table({
  tableName: 'users',
  timestamps: true,
  underscored: true,
  paranoid: true,
  defaultScope: { attributes: { exclude: ['password_hash'] } },
  scopes: {
    withSecret: { attributes: { include: ['password_hash'] } },
  },
})
export class User extends Model<User> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  name: string;

  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  email: string;

  @Column({ type: DataType.STRING, allowNull: false })
  password_hash: string;

  @Column({ type: DataType.STRING, allowNull: false })
  type: UserType;

  @ForeignKey(() => Role)
  @Column({ type: DataType.UUID, allowNull: true })
  role_id: string | null;

  @ForeignKey(() => Doctor)
  @Column({ type: DataType.UUID, allowNull: true })
  doctor_id: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  is_active: boolean;

  @BelongsTo(() => Role)
  role: Role;

  @BelongsTo(() => Doctor)
  doctor: Doctor;
}
