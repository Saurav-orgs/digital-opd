import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { User } from '../database/models/user.model';
import { Role } from '../database/models/role.model';
import { Permission } from '../database/models/permission.model';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { UserType } from '../common/enums';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { MailService } from '../mail/mail.service';
import { teamMemberCredentialsEmail } from '../mail/templates';

/**
 * Letters and digits a person can read back from an email without a
 * mistake: no 0/O, 1/l/I. Twelve of these is ~62 bits, well past a
 * dictionary attack and short enough to type on a phone.
 */
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const TEMP_PASSWORD_LENGTH = 12;

function makeTempPassword(): string {
  let out = '';
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) {
    out += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }
  return out;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(Role) private readonly roleModel: typeof Role,
    @InjectModel(Permission) private readonly permissionModel: typeof Permission,
    private readonly sequelize: Sequelize,
    private readonly mail: MailService,
    private readonly config: ConfigService,
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
   *
   * A team member (no `overrides.type`) is emailed their sign-in details. The
   * doctor no longer chooses their password: with none in the request the
   * server makes a temporary one, and the email is the only place it exists
   * in the clear. The mail goes inside the transaction so a member is never
   * left with an account and no way to learn its password — if the email
   * cannot be sent, nothing is created and the doctor sees why.
   */
  async create(
    dto: CreateUserDto,
    caller: AuthUser,
    overrides: { type?: UserType } = {},
  ): Promise<User> {
    await this.assertEmailFree(dto.email);
    if (!dto.role_id && !dto.permissionIds) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, {
        message: 'Choose what this team member may do.',
      });
    }
    await this.assertAssignableRole(dto.role_id, caller);
    if (dto.permissionIds) await this.assertPermissionsExist(dto.permissionIds);
    const password = dto.password ?? makeTempPassword();
    const password_hash = await bcrypt.hash(password, 10);
    const emailCredentials = !overrides.type;

    const user = await this.sequelize.transaction(async (t) => {
      const roleId =
        dto.role_id ??
        (
          await this.personalRole(
            null,
            dto.name,
            dto.permissionIds!,
            dto.role_name,
            caller,
            t,
          )
        ).id;
      const created = await this.userModel.create(
        {
          name: dto.name,
          email: dto.email.toLowerCase(),
          password_hash,
          type: overrides.type ?? UserType.ADMIN,
          role_id: roleId,
          doctor_id: caller.doctorId ?? null,
          is_active: dto.is_active ?? true,
        } as any,
        { transaction: t },
      );
      if (emailCredentials) {
        await this.mail.send({
          to: created.email,
          ...teamMemberCredentialsEmail({
            name: dto.name,
            doctorName: caller.name,
            email: created.email,
            password,
            loginUrl: `${this.config.get<string>('adminWebBase')}/login`,
          }),
        });
      }
      return created;
    });
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
    if (dto.permissionIds) await this.assertPermissionsExist(dto.permissionIds);
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
    await this.sequelize.transaction(async (t) => {
      if (dto.permissionIds && !dto.role_id) {
        const role = await this.personalRole(
          user,
          patch.name!,
          dto.permissionIds,
          dto.role_name,
          caller,
          t,
        );
        patch.role_id = role.id;
      }
      await user.update(patch as any, { transaction: t });
    });
    return this.findOne(id);
  }

  /**
   * The role that carries a team member's directly-granted permissions.
   *
   * Permissions hang off roles and nothing else, so "tick what Sunita may
   * do" still needs a role row — it is just one the doctor never sees or
   * names. If the member already has one of their own (in this tenant, not
   * a system role, held by nobody else) its grants are replaced in place;
   * otherwise a fresh one is made, named after them, so the Roles screen
   * still makes sense to anyone who opens it.
   */
  private async personalRole(
    user: User | null,
    memberName: string,
    permissionIds: string[],
    roleName: string | undefined,
    caller: AuthUser,
    t: Transaction,
  ): Promise<Role> {
    const tenant = caller.doctorId ?? null;
    // The title the doctor gave them, or a plain default. It is the role's
    // name, which is what the header shows beside theirs after sign-in.
    const base = roleName?.trim() || `${memberName.trim()}'s access`;

    if (user?.role) {
      const held = user.role;
      const ownedHere = held.doctor_id === tenant && !held.is_system;
      const others = ownedHere
        ? await this.userModel.count({
            where: { role_id: held.id, id: { [Op.ne]: user.id } },
            transaction: t,
          })
        : 1;
      if (ownedHere && others === 0) {
        await (held as any).$set('permissions', permissionIds, { transaction: t });
        if (roleName !== undefined && base !== held.name) {
          await held.update(
            { name: await this.freeRoleName(base, tenant, t, held.id) } as any,
            { transaction: t },
          );
        }
        return held;
      }
    }

    const name = await this.freeRoleName(base, tenant, t);
    const role = await this.roleModel.create(
      {
        name,
        description: 'Permissions set from My Team.',
        is_system: false,
        doctor_id: tenant,
      } as any,
      { transaction: t },
    );
    await (role as any).$set('permissions', permissionIds, { transaction: t });
    return role;
  }

  /**
   * `base`, or `base 2`, `base 3`… — whichever is not already a role name in
   * this tenant. Two receptionists may both be called "Receptionist"; the
   * roles behind them cannot share the name, and neither should fail over it.
   */
  private async freeRoleName(
    base: string,
    tenant: string | null,
    t: Transaction,
    exceptRoleId?: string,
  ): Promise<string> {
    let name = base;
    for (let n = 2; ; n++) {
      const where: any = { name, doctor_id: tenant };
      if (exceptRoleId) where.id = { [Op.ne]: exceptRoleId };
      const clash = await this.roleModel.findOne({ where, transaction: t });
      if (!clash) return name;
      name = `${base} ${n}`;
    }
  }

  private async assertPermissionsExist(ids: string[]): Promise<void> {
    const unique = [...new Set(ids)];
    const found = await this.permissionModel.count({ where: { id: { [Op.in]: unique } } });
    if (found !== unique.length) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, {
        message: 'One or more permissions do not exist.',
      });
    }
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
      roleName: user.role?.name ?? null,
      doctorId: user.doctor_id,
      subscriptionRequired: !!user.subscription_required,
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
