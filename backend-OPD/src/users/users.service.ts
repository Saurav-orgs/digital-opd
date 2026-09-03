import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import * as bcrypt from 'bcrypt';
import { User } from '../database/models/user.model';
import { Role } from '../database/models/role.model';
import { Permission } from '../database/models/permission.model';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { UserType } from '../common/enums';
import { AuthUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(Role) private readonly roleModel: typeof Role,
  ) {}

  private readonly roleWithPerms = {
    model: Role,
    include: [{ model: Permission }],
  };

  /**
   * Creates a staff account linked to the caller's tenant.
   * `overrides` is for internal callers that manage their own kind of login
   * (see PathlabsService). The caller's `doctorId` becomes the new account's
   * `doctor_id` — this keeps staff siloed to their doctor's tenant.
   */
  async create(
    dto: CreateUserDto,
    caller: AuthUser,
    overrides: { type?: UserType } = {},
  ): Promise<User> {
    await this.assertEmailFree(dto.email);
    await this.assertAssignableRole(dto.role_id, caller);
    const password_hash = await bcrypt.hash(dto.password, 10);
    const user = await this.userModel.create({
      name: dto.name,
      email: dto.email.toLowerCase(),
      password_hash,
      type: overrides.type ?? UserType.ADMIN,
      role_id: dto.role_id,
      doctor_id: caller.doctorId ?? null,
      is_active: dto.is_active ?? true,
    } as any);
    return this.findOne(user.id);
  }

  /**
   * Users in the caller's tenant only (scoped by doctor_id).
   *
   * Super-admin accounts are left out for a clinic. The clinic's own doctor
   * login is one of them, and this screen is for managing staff — the doctor
   * edits themselves under My profile, and cannot be edited or deleted from
   * here anyway, so the row was only ever a distraction.
   */
  async findAll(caller: AuthUser): Promise<User[]> {
    const where: any = caller.doctorId
      ? { doctor_id: caller.doctorId, type: { [Op.ne]: UserType.SUPER_ADMIN } }
      : {};
    return this.userModel.findAll({
      where,
      include: [this.roleWithPerms, 'doctor'],
      order: [['created_at', 'DESC']],
    });
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userModel.findByPk(id, {
      include: [this.roleWithPerms, 'doctor'],
    });
    if (!user) throw new AppException(ErrorCode.NOT_FOUND, {
      message: 'User not found.',
    });
    return user;
  }

  async update(id: string, dto: UpdateUserDto, caller: AuthUser): Promise<User> {
    const user = await this.findOne(id);
    if (dto.email && dto.email.toLowerCase() !== user.email) {
      await this.assertEmailFree(dto.email);
    }
    if (dto.role_id && dto.role_id !== user.role_id) {
      await this.assertAssignableRole(dto.role_id, caller);
    }
    // `type` and `doctor_id` are server-owned — an edit never moves an account
    // between kinds or doctors.
    const patch: Partial<User> = {
      name: dto.name ?? user.name,
      email: dto.email ? dto.email.toLowerCase() : user.email,
      role_id: dto.role_id ?? user.role_id,
      is_active: dto.is_active ?? user.is_active,
    };
    if (dto.password) {
      patch.password_hash = await bcrypt.hash(dto.password, 10);
    }
    await user.update(patch as any);
    return this.findOne(id);
  }

  /**
   * The caller may only hand out a role they can actually see.
   *
   * `role_id` arrives from the client, and nothing here used to check it — so
   * a clinic admin with `users:create` could name the platform's own SuperAdmin
   * role and mint an account carrying every permission in the system. The role
   * must belong to the caller's tenant or be a shared non-system one; the
   * platform role is the super admin's alone to grant.
   */
  private async assertAssignableRole(
    roleId: string | undefined,
    caller: AuthUser,
  ): Promise<void> {
    if (!roleId) return;

    const role = await this.roleModel.findByPk(roleId);
    if (!role) {
      throw new AppException(ErrorCode.NOT_FOUND, { message: 'Role not found.' });
    }
    if (caller.type === UserType.SUPER_ADMIN) return;

    const ownedByCaller = role.doctor_id === caller.doctorId;
    const sharedAndGrantable = role.doctor_id === null && !role.is_system;
    if (!ownedByCaller && !sharedAndGrantable) {
      throw new AppException(ErrorCode.FORBIDDEN, {
        message: 'That role cannot be assigned.',
      });
    }
  }

  /**
   * Set a user's password directly. The single place a hash is written outside
   * create/update, used by the self-service change and the super admin's reset
   * of a doctor's login.
   */
  async setPassword(id: string, password: string): Promise<void> {
    const user = await this.findOne(id);
    await user.update({
      password_hash: await bcrypt.hash(password, 10),
    } as any);
  }

  async remove(id: string): Promise<void> {
    const user = await this.findOne(id);
    if (user.type === UserType.SUPER_ADMIN) {
      throw new AppException(ErrorCode.FORBIDDEN, {
        message: 'The SuperAdmin account cannot be deleted.',
      });
    }
    await user.destroy(); // soft delete (paranoid)
  }

  /** Loads a user with permissions for authentication (includes password hash). */
  async findForAuth(email: string): Promise<User | null> {
    return this.userModel.scope('withSecret').findOne({
      where: { email: email.toLowerCase() },
      // `doctor` comes along so login can tell a self-registered doctor still
      // awaiting review apart from an account an admin switched off.
      include: [this.roleWithPerms, 'doctor'],
    });
  }

  /** Builds the request-scoped principal (fresh permissions) from a user id. */
  async buildAuthUser(id: string): Promise<AuthUser | null> {
    const user = await this.userModel.findByPk(id, {
      include: [this.roleWithPerms],
    });
    if (!user || !user.is_active) return null;
    return UsersService.toAuthUser(user);
  }

  static toAuthUser(user: User): AuthUser {
    const permissions = (user.role?.permissions ?? []).map(
      (p) => `${p.module}:${p.action}`,
    );
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      type: user.type,
      roleId: user.role_id,
      doctorId: user.doctor_id,
      permissions,
    };
  }

  private async assertEmailFree(email: string): Promise<void> {
    const existing = await this.userModel.findOne({
      where: { email: email.toLowerCase() },
      paranoid: false,
    });
    if (existing) {
      throw new AppException(ErrorCode.CONFLICT, {
        message: 'An account with this email already exists.',
      });
    }
  }
}
