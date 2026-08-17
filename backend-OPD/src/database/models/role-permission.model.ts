import {
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { Role } from './role.model';
import { Permission } from './permission.model';

@Table({ tableName: 'role_permissions', timestamps: false, underscored: true })
export class RolePermission extends Model<RolePermission> {
  @ForeignKey(() => Role)
  @Column({ type: DataType.UUID, primaryKey: true })
  role_id: string;

  @ForeignKey(() => Permission)
  @Column({ type: DataType.UUID, primaryKey: true })
  permission_id: string;
}
