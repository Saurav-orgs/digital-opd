import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Role } from '../database/models/role.model';
import { Permission } from '../database/models/permission.model';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AuthUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class RolesService {
  constructor(
    @InjectModel(Role) private readonly roleModel: typeof Role,
    @InjectModel(Permission) private readonly permissionModel: typeof Permission,
    private readonly sequelize: Sequelize,
  ) {}

  listPermissions(): Promise<Permission[]> {
    return this.permissionModel.findAll({
      order: [
        ['module', 'ASC'],
        ['action', 'ASC'],
      ],
    });
  }

  /** Returns global (system) roles + the caller's tenant roles. */
  findAll(user: AuthUser): Promise<Role[]> {
    const where: any = user.doctorId
      ? { [Op.or]: [{ doctor_id: user.doctorId }, { doctor_id: null }] }
      : { doctor_id: null }; // super admin sees only global roles
    return this.roleModel.findAll({
      where,
      include: [Permission],
      order: [['name', 'ASC']],
    });
  }

  async findOne(id: string): Promise<Role> {
    const role = await this.roleModel.findByPk(id, { include: [Permission] });
    if (!role)
      throw new AppException(ErrorCode.NOT_FOUND, { message: 'Role not found.' });
    return role;
  }

  async create(dto: CreateRoleDto, user: AuthUser): Promise<Role> {
    await this.assertNameFree(dto.name, user.doctorId);
    await this.assertPermissionsExist(dto.permissionIds);
    return this.sequelize.transaction(async (t) => {
      const role = await this.roleModel.create(
        {
          name: dto.name,
          description: dto.description ?? null,
          is_system: false,
          doctor_id: user.doctorId ?? null,
        } as any,
        { transaction: t },
      );
      await (role as any).$set('permissions', dto.permissionIds, { transaction: t });
      return (await this.roleModel.findByPk(role.id, {
        include: [Permission],
        transaction: t,
      })) as Role;
    });
  }

  async update(id: string, dto: UpdateRoleDto): Promise<Role> {
    const role = await this.findOne(id);
    if (role.is_system) {
      throw new AppException(ErrorCode.FORBIDDEN, {
        message: 'System roles cannot be modified.',
      });
    }
    if (dto.name && dto.name !== role.name) await this.assertNameFree(dto.name, role.doctor_id);
    if (dto.permissionIds) await this.assertPermissionsExist(dto.permissionIds);

    return this.sequelize.transaction(async (t) => {
      await role.update(
        {
          name: dto.name ?? role.name,
          description: dto.description ?? role.description,
        } as any,
        { transaction: t },
      );
      if (dto.permissionIds) {
        await (role as any).$set('permissions', dto.permissionIds, { transaction: t });
      }
      return (await this.roleModel.findByPk(id, {
        include: [Permission],
        transaction: t,
      })) as Role;
    });
  }

  async remove(id: string): Promise<void> {
    const role = await this.findOne(id);
    if (role.is_system) {
      throw new AppException(ErrorCode.FORBIDDEN, {
        message: 'System roles cannot be deleted.',
      });
    }
    const inUse = await role.$count('users');
    if (inUse > 0) {
      throw new AppException(ErrorCode.CONFLICT, {
        message: 'This role is assigned to users and cannot be deleted.',
      });
    }
    await role.destroy();
  }

  private async assertNameFree(name: string, doctorId: string | null): Promise<void> {
    // A role name must be unique within the same scope: per-tenant for tenant
    // roles, globally for system roles.
    const where: any = { name };
    if (doctorId) where.doctor_id = doctorId;
    else where.doctor_id = null;
    const existing = await this.roleModel.findOne({ where });
    if (existing) {
      throw new AppException(ErrorCode.CONFLICT, {
        message: 'A role with this name already exists.',
      });
    }
  }

  private async assertPermissionsExist(ids: string[]): Promise<void> {
    if (!ids?.length) return;
    const count = await this.permissionModel.count({ where: { id: ids } });
    if (count !== ids.length) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: 'One or more selected permissions are invalid.',
      });
    }
  }
}
