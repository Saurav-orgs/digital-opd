import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
  BelongsToMany,
  HasMany,
} from 'sequelize-typescript';
import { Permission } from './permission.model';
import { RolePermission } from './role-permission.model';
import { User } from './user.model';
import { Doctor } from './doctor.model';

@Table({ tableName: 'roles', timestamps: true, underscored: true })
export class Role extends Model<Role> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  // Uniqueness is enforced at DB level via partial indexes; no Sequelize unique here.
  @Column({ type: DataType.STRING, allowNull: false })
  name: string;

  /** null = global/system role; set = belongs to this doctor's tenant. */
  @ForeignKey(() => Doctor)
  @Column({ type: DataType.UUID, allowNull: true })
  doctor_id: string | null;

  @BelongsTo(() => Doctor)
  doctor: Doctor;

  @Column({ type: DataType.STRING, allowNull: true })
  description: string | null;

  /** Protects built-in roles (e.g. SuperAdmin) from edit/delete. */
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  is_system: boolean;

  @BelongsToMany(() => Permission, () => RolePermission)
  permissions: Permission[];

  @HasMany(() => User)
  users: User[];
}
