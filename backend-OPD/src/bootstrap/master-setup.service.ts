import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Sequelize as SequelizeStatic } from 'sequelize';
import Umzug from 'umzug';
import * as bcrypt from 'bcrypt';
import * as path from 'path';
import { Permission } from '../database/models/permission.model';
import { Role } from '../database/models/role.model';
import { RolePermission } from '../database/models/role-permission.model';
import { User } from '../database/models/user.model';
import {
  PermissionAction,
  PermissionModule as PermModule,
  UserType,
} from '../common/enums';

const SUPERADMIN_ROLE_NAME = 'SuperAdmin';
const PATHLAB_ROLE_NAME = 'Pathlab';

/**
 * Master setup — runs once on every application start and idempotently
 * brings a database to a fully working state, even a brand-new one with no
 * schema at all:
 *
 *   1. Runs any pending schema migrations (via the same `umzug` engine and
 *      `SequelizeMeta` tracking table `sequelize-cli db:migrate` uses, so
 *      the two stay fully interchangeable — never run both against the same
 *      DB concurrently, but either one alone keeps the other's bookkeeping
 *      valid).
 *   2. Ensures the full permission catalog (every module × action) exists.
 *   3. Ensures a protected `SuperAdmin` role exists, holding every permission.
 *   4. Ensures the clinic's doctor profile exists (named after the SuperAdmin)
 *      — the SuperAdmin *is* the doctor, so there is never a separate "add
 *      doctor" step.
 *   5. Ensures a SuperAdmin user exists (credentials from env — see
 *      `superAdmin` in configuration.ts), linked to that doctor profile.
 *
 * This removes every manual first-run step ("run migrations", "run the
 * seeder"): on a truly empty database the app creates its own schema and a
 * working login on the very first boot. All steps are check-before-write, so
 * re-running on every restart is safe and does nothing once set up.
 */
@Injectable()
export class MasterSetupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MasterSetupService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly sequelize: Sequelize,
    @InjectModel(Permission) private readonly permissionModel: typeof Permission,
    @InjectModel(Role) private readonly roleModel: typeof Role,
    @InjectModel(RolePermission)
    private readonly rolePermissionModel: typeof RolePermission,
    @InjectModel(User) private readonly userModel: typeof User,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.runPendingMigrations();
      const permissionIds = await this.ensurePermissionCatalog();
      const role = await this.ensureSuperAdminRole(permissionIds);
      // Super admin is the platform owner only — no doctor profile attached.
      await this.ensureSuperAdminUser(role.id);
      await this.ensurePathlabRole();
    } catch (err) {
      // Never crash the app over setup — surface it loudly and move on so
      // health checks still pass and the issue is visible in logs.
      this.logger.error(
        'Master setup failed — the app will keep running, but the schema ' +
          'and/or SuperAdmin access may not be configured. Check DB ' +
          'connectivity, permissions, and env vars.',
        err as Error,
      );
    }
  }

  /**
   * Runs any migrations not yet recorded in `SequelizeMeta`, using the exact
   * same storage/params convention as `sequelize-cli db:migrate` — so a
   * database that already has migrations applied via the CLI is recognised
   * as up to date, and one with none (a brand-new DB) gets its schema built
   * from scratch here.
   */
  private async runPendingMigrations(): Promise<void> {
    const umzug = new Umzug({
      storage: 'sequelize',
      storageOptions: { sequelize: this.sequelize, tableName: 'SequelizeMeta' },
      migrations: {
        params: [this.sequelize.getQueryInterface(), SequelizeStatic],
        path: path.join(process.cwd(), 'database', 'migrations'),
        pattern: /\.js$/,
      },
      logging: false,
    });

    const pending = await umzug.pending();
    if (pending.length === 0) return;

    this.logger.log(
      `Master setup: running ${pending.length} pending migration(s): ` +
        pending.map((m: any) => m.file).join(', '),
    );
    await umzug.up();
    this.logger.log('Master setup: schema is now up to date.');
  }

  /** Ensures every (module, action) pair exists. Returns all permission ids. */
  private async ensurePermissionCatalog(): Promise<string[]> {
    const existing = await this.permissionModel.findAll({
      attributes: ['id', 'module', 'action'],
    });
    const key = (m: string, a: string) => `${m}:${a}`;
    const existingKeys = new Set(existing.map((p) => key(p.module, p.action)));

    const modules = Object.values(PermModule);
    const actions = Object.values(PermissionAction);
    const toCreate: { module: PermModule; action: PermissionAction }[] = [];
    for (const module of modules) {
      for (const action of actions) {
        if (!existingKeys.has(key(module, action))) {
          toCreate.push({ module, action });
        }
      }
    }
    if (toCreate.length) {
      await this.permissionModel.bulkCreate(toCreate as any);
      this.logger.log(`Master setup: added ${toCreate.length} permission(s).`);
    }

    return (
      await this.permissionModel.findAll({ attributes: ['id'] })
    ).map((p) => p.id);
  }

  /** Ensures the protected SuperAdmin role exists and holds every permission. */
  private async ensureSuperAdminRole(permissionIds: string[]): Promise<Role> {
    let role = await this.roleModel.findOne({
      where: { name: SUPERADMIN_ROLE_NAME },
    });
    if (!role) {
      role = await this.roleModel.create({
        name: SUPERADMIN_ROLE_NAME,
        description: 'Full access. Cannot be modified or deleted.',
        is_system: true,
      } as any);
      this.logger.log('Master setup: created the SuperAdmin role.');
    }

    const linked = await this.rolePermissionModel.findAll({
      where: { role_id: role.id },
      attributes: ['permission_id'],
    });
    const linkedIds = new Set(linked.map((r) => r.permission_id));
    const missing = permissionIds.filter((id) => !linkedIds.has(id));
    if (missing.length) {
      await this.rolePermissionModel.bulkCreate(
        missing.map((permission_id) => ({ role_id: role!.id, permission_id })) as any,
      );
      this.logger.log(
        `Master setup: granted ${missing.length} permission(s) to SuperAdmin.`,
      );
    }

    return role;
  }

  /**
   * Ensures a SuperAdmin login exists, using credentials from env config.
   * The super admin is the platform owner only — no doctor_id, no clinical data.
   * Doctors are created via POST /doctors (super-admin only API).
   */
  private async ensureSuperAdminUser(roleId: string): Promise<void> {
    const { email, password, name } = this.config.get<{
      email: string;
      password: string;
      name: string;
    }>('superAdmin')!;
    const normalizedEmail = email.toLowerCase();

    const existing = await this.userModel.findOne({
      where: { email: normalizedEmail },
      paranoid: false, // still find a soft-deleted account so we don't duplicate
    });
    if (existing) {
      // Unlink from any doctor that was set in the old single-tenant setup.
      if (existing.doctor_id !== null) {
        await existing.update({ doctor_id: null } as any);
        this.logger.log(
          'Master setup: unlinked SuperAdmin from doctor profile (platform-owner mode).',
        );
      }
      return;
    }

    const password_hash = await bcrypt.hash(password, 10);
    await this.userModel.create({
      name,
      email: normalizedEmail,
      password_hash,
      type: UserType.SUPER_ADMIN,
      role_id: roleId,
      doctor_id: null,
      is_active: true,
    } as any);

    this.logger.log(`Master setup: created the SuperAdmin login (${normalizedEmail}).`);
    if (password === 'change-me') {
      this.logger.warn(
        'Master setup: SUPERADMIN_PASSWORD is not set — using the insecure ' +
          'default. Set it in the environment and restart to rotate it.',
      );
    }
  }

  /**
   * Ensures a non-system "Pathlab" role exists, holding only `reports:create`
   * and `reports:read` — a pathlab login sees just the Reports module in the
   * admin web/app via the existing permission-driven nav.
   */
  private async ensurePathlabRole(): Promise<void> {
    let role = await this.roleModel.findOne({
      where: { name: PATHLAB_ROLE_NAME },
    });
    if (!role) {
      role = await this.roleModel.create({
        name: PATHLAB_ROLE_NAME,
        description: 'Pathlab staff — upload patient reports only.',
        is_system: false,
      } as any);
      this.logger.log('Master setup: created the Pathlab role.');
    }

    const wanted = await this.permissionModel.findAll({
      where: {
        module: PermModule.REPORTS,
        action: [PermissionAction.CREATE, PermissionAction.READ],
      },
      attributes: ['id'],
    });
    const wantedIds = new Set(wanted.map((p) => p.id));

    const linked = await this.rolePermissionModel.findAll({
      where: { role_id: role.id },
      attributes: ['permission_id'],
    });
    const linkedIds = new Set(linked.map((r) => r.permission_id));

    const toAdd = [...wantedIds].filter((id) => !linkedIds.has(id));
    if (toAdd.length) {
      await this.rolePermissionModel.bulkCreate(
        toAdd.map((permission_id) => ({ role_id: role!.id, permission_id })) as any,
      );
      this.logger.log(`Master setup: granted ${toAdd.length} permission(s) to Pathlab.`);
    }

    // Revoke anything beyond create/read (e.g. from an earlier over-grant).
    const toRemove = [...linkedIds].filter((id) => !wantedIds.has(id));
    if (toRemove.length) {
      await this.rolePermissionModel.destroy({
        where: { role_id: role.id, permission_id: toRemove },
      });
      this.logger.log(`Master setup: revoked ${toRemove.length} permission(s) from Pathlab.`);
    }
  }
}
