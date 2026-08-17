import {
  Column,
  DataType,
  Model,
  Table,
  BelongsToMany,
} from 'sequelize-typescript';
import { PermissionAction, PermissionModule } from '../../common/enums';
import { Role } from './role.model';
import { RolePermission } from './role-permission.model';

@Table({ tableName: 'permissions', timestamps: true, underscored: true })
export class Permission extends Model<Permission> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  module: PermissionModule;

  @Column({ type: DataType.STRING, allowNull: false })
  action: PermissionAction;

  @BelongsToMany(() => Role, () => RolePermission)
  roles: Role[];
}
