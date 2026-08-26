import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import * as bcrypt from 'bcrypt';
import { Sequelize } from 'sequelize-typescript';
import { Doctor } from '../database/models/doctor.model';
import { Permission } from '../database/models/permission.model';
import { Role } from '../database/models/role.model';
import { RolePermission } from '../database/models/role-permission.model';
import { User } from '../database/models/user.model';
import { CreateDoctorDto, UpdateDoctorDto } from './dto/doctor.dto';
import { RegisterDoctorDto } from './dto/register-doctor.dto';
import { StorageService } from '../uploads/storage.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  DoctorVerificationStatus,
  PermissionAction,
  PermissionModule,
  UserType,
} from '../common/enums';

// Modules the tenant Doctor role receives (all clinical modules).
// doctors:create and doctors:delete stay super-admin-only.
const TENANT_DOCTOR_PERMS: { module: PermissionModule; action: PermissionAction }[] = [
  ...Object.values(PermissionModule).flatMap((module) =>
    Object.values(PermissionAction).map((action) => ({ module, action })),
  ),
].filter(
  ({ module, action }) =>
    !(
      module === PermissionModule.DOCTORS &&
      (action === PermissionAction.CREATE || action === PermissionAction.DELETE)
    ),
);

// Tenant Pathlab role — upload and view reports only.
const TENANT_PATHLAB_PERMS = [
  { module: PermissionModule.REPORTS, action: PermissionAction.CREATE },
  { module: PermissionModule.REPORTS, action: PermissionAction.READ },
  { module: PermissionModule.PATHLABS, action: PermissionAction.CREATE },
  { module: PermissionModule.PATHLABS, action: PermissionAction.READ },
];

@Injectable()
export class DoctorsService {
  constructor(
    @InjectModel(Doctor) private readonly doctorModel: typeof Doctor,
    @InjectModel(Role) private readonly roleModel: typeof Role,
    @InjectModel(RolePermission)
    private readonly rolePermissionModel: typeof RolePermission,
    @InjectModel(Permission) private readonly permissionModel: typeof Permission,
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly sequelize: Sequelize,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  /**
   * The clinics on the platform.
   *
   * Registrations still awaiting review are excluded: they belong in the
   * pending queue, where the licence is on screen next to the decision. Listing
   * them here would put an "Enable" button beside a doctor nobody has verified,
   * which is exactly the check this flow exists to enforce. Rejected ones are
   * hidden for the same reason.
   */
  async findAll() {
    const doctors = await this.doctorModel.findAll({
      where: { verification_status: DoctorVerificationStatus.APPROVED },
      order: [['created_at', 'DESC']],
    });
    return doctors.map((d) => this.toView(d));
  }

  async findOne(id: string) {
    return this.toView(await this.getOrFail(id));
  }

  async update(id: string, dto: UpdateDoctorDto) {
    const doctor = await this.getOrFail(id);
    await doctor.update(dto as any);
    return this.toView(doctor);
  }

  async setEnabled(id: string, enabled: boolean) {
    const doctor = await this.getOrFail(id);
    await doctor.update({ is_enabled: enabled } as any);
    return this.toView(doctor);
  }

  async remove(id: string): Promise<{ message: string }> {
    const doctor = await this.getOrFail(id);
    await doctor.destroy(); // soft-delete (paranoid: true on the model)
    return { message: 'Doctor removed.' };
  }

  async uploadPhoto(id: string, file: Express.Multer.File) {
    const doctor = await this.getOrFail(id);
    const { key } = await this.storage.uploadImage(file, `doctors/${id}/photo`);
    if (doctor.profile_photo_url)
      await this.storage.delete(doctor.profile_photo_url);
    await doctor.update({ profile_photo_url: key } as any);
    return this.toView(doctor);
  }

  /** Upload the clinic logo shown on the prescription letterhead. */
  async uploadLetterheadLogo(id: string, file: Express.Multer.File) {
    const doctor = await this.getOrFail(id);
    const { key } = await this.storage.uploadImage(file, `doctors/${id}/logo`);
    if (doctor.clinic_logo_key) await this.storage.delete(doctor.clinic_logo_key);
    await doctor.update({ clinic_logo_key: key } as any);
    return this.toView(doctor);
  }

  /** Upload a custom doctor profile QR code image. */
  async uploadQr(id: string, file: Express.Multer.File) {
    const doctor = await this.getOrFail(id);
    const { key } = await this.storage.uploadImage(file, `doctors/${id}/qr`);
    if (doctor.qr_code_key) await this.storage.delete(doctor.qr_code_key);
    await doctor.update({ qr_code_key: key } as any);
    return this.toView(doctor);
  }

  /** Remove the custom doctor profile QR code image. */
  async removeQr(id: string) {
    const doctor = await this.getOrFail(id);
    if (doctor.qr_code_key) await this.storage.delete(doctor.qr_code_key);
    await doctor.update({ qr_code_key: null } as any);
    return this.toView(doctor);
  }

  /**
   * A doctor signing themselves up.
   *
   * The tenant is built exactly as `createTenant` builds it — profile, roles,
   * login — but everything arrives switched off: the doctor is `pending`,
   * `is_enabled` is false so the booking link is dead, and the login is
   * inactive so `ACCOUNT_DISABLED` greets any sign-in attempt. Nothing here is
   * trusted; the licence file is the only evidence, and a human has to look at
   * it before any of this becomes real.
   */
  async registerSelf(
    dto: RegisterDoctorDto,
    license: Express.Multer.File,
  ): Promise<{ id: string; status: DoctorVerificationStatus }> {
    const existing = await this.userModel.findOne({
      where: { email: dto.email.toLowerCase() },
      paranoid: false,
    });
    if (existing) {
      throw new AppException(ErrorCode.CONFLICT, {
        message: 'An account with this email already exists.',
      });
    }

    // Upload before the transaction: an S3 failure should not leave a
    // half-written tenant behind, and an orphaned object is the cheaper leak.
    this.storage.validateDocument(license);
    const { key } = await this.storage.uploadDocument(license, 'doctor-licenses');

    return this.sequelize.transaction(async (t) => {
      const slug = await this.uniqueSlug(dto.name);
      const doctor = await this.doctorModel.create(
        {
          name: dto.name,
          specialization: dto.specialization ?? null,
          qualifications: dto.qualifications ?? null,
          contact_mobile: dto.contact_mobile,
          license_number: dto.license_number,
          license_file_key: key,
          public_slug: slug,
          // Both off until a human approves: no bookings, no login.
          is_enabled: false,
          verification_status: DoctorVerificationStatus.PENDING,
        } as any,
        { transaction: t },
      );

      const doctorRole = await this.createTenantRole(
        'Doctor',
        'Full clinical access for this tenant.',
        TENANT_DOCTOR_PERMS,
        doctor.id,
        t,
      );
      await this.createTenantRole(
        'Pathlab',
        'Report upload access for this tenant.',
        TENANT_PATHLAB_PERMS,
        doctor.id,
        t,
      );

      await this.userModel.create(
        {
          name: dto.name,
          email: dto.email.toLowerCase(),
          password_hash: await bcrypt.hash(dto.password, 10),
          type: UserType.DOCTOR,
          role_id: doctorRole.id,
          doctor_id: doctor.id,
          is_active: false,
        } as any,
        { transaction: t },
      );

      return { id: doctor.id, status: DoctorVerificationStatus.PENDING };
    });
  }

  /** Registrations waiting on the super admin, with a link to the licence. */
  async listPending(): Promise<any[]> {
    const rows = await this.doctorModel.findAll({
      where: { verification_status: DoctorVerificationStatus.PENDING },
      order: [['created_at', 'ASC']],
    });
    return Promise.all(
      rows.map(async (d) => ({
        ...this.toView(d),
        license_number: d.license_number,
        contact_mobile: d.contact_mobile,
        license_url: d.license_file_key
          ? await this.storage.presignedGetUrl(d.license_file_key)
          : null,
      })),
    );
  }

  /** Approve a registration: the tenant and its login both come alive. */
  async approveRegistration(id: string) {
    const doctor = await this.getOrFail(id);
    if (doctor.verification_status === DoctorVerificationStatus.APPROVED) {
      return this.toView(doctor);
    }

    await doctor.update({
      verification_status: DoctorVerificationStatus.APPROVED,
      rejection_reason: null,
      reviewed_at: new Date(),
      is_enabled: true,
    } as any);
    await this.userModel.update(
      { is_active: true } as any,
      { where: { doctor_id: doctor.id, type: UserType.DOCTOR } },
    );

    return this.toView(doctor);
  }

  /**
   * Turn a registration down. The row is kept rather than deleted so the same
   * person cannot silently re-register on the same email, and so the reason can
   * be shown if they ask why.
   */
  async rejectRegistration(id: string, reason?: string) {
    const doctor = await this.getOrFail(id);
    await doctor.update({
      verification_status: DoctorVerificationStatus.REJECTED,
      rejection_reason: reason?.trim() || null,
      reviewed_at: new Date(),
      is_enabled: false,
    } as any);
    await this.userModel.update(
      { is_active: false } as any,
      { where: { doctor_id: doctor.id, type: UserType.DOCTOR } },
    );
    return this.toView(doctor);
  }

  /**
   * Reset a doctor's own login password.
   *
   * The gap this closes: a doctor's password is set once at creation and never
   * again, so a doctor who forgets theirs is locked out with no way back —
   * there is no email delivery in this deployment to send a reset link. The
   * super admin sets a new one and reads it out to them, exactly as they do
   * with the temporary password at creation.
   *
   * Only the doctor's *own* account is touched. Staff the doctor added have
   * their passwords reset from the Users screen instead.
   */
  async resetLoginPassword(
    doctorId: string,
    password: string,
  ): Promise<{ email: string; password: string }> {
    const doctor = await this.getOrFail(doctorId);

    const login = await this.userModel.findOne({
      where: { doctor_id: doctor.id, type: UserType.DOCTOR },
      order: [['created_at', 'ASC']],
    });
    if (!login) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'This doctor has no login account to reset.',
      });
    }

    // Same cost factor as `createTenant` writes at creation.
    await login.update({
      password_hash: await bcrypt.hash(password, 10),
    } as any);
    return { email: login.email, password };
  }

  /**
   * Creates a new doctor tenant in a single transaction:
   *   1. Doctor profile + public QR slug.
   *   2. Two tenant roles: Doctor (all clinical) and Pathlab (reports only).
   *   3. The doctor's own login User (type=doctor).
   *
   * Returns everything the super-admin needs to hand to the new doctor,
   * including the one-time credentials (never stored again) and the QR URL.
   */
  async createTenant(
    dto: CreateDoctorDto,
    patientWebBase: string,
  ): Promise<{
    doctor: any;
    doctorRole: any;
    pathlabRole: any;
    login: { email: string; tempPassword: string };
    qrUrl: string;
  }> {
    // Check email uniqueness before the transaction so we get a clean error.
    const existing = await this.userModel.findOne({
      where: { email: dto.email.toLowerCase() },
      paranoid: false,
    });
    if (existing) {
      throw new AppException(ErrorCode.CONFLICT, {
        message: 'An account with this email already exists.',
      });
    }

    return this.sequelize.transaction(async (t) => {
      // 1 — Doctor profile
      const slug = await this.uniqueSlug(dto.name);
      const doctor = await this.doctorModel.create(
        {
          name: dto.name,
          specialization: dto.specialization ?? null,
          qualifications: dto.qualifications ?? null,
          bio: dto.bio ?? null,
          consultation_fee: dto.consultation_fee ?? null,
          public_slug: slug,
          is_enabled: true,
        } as any,
        { transaction: t },
      );

      // 2 — Tenant roles
      const doctorRole = await this.createTenantRole(
        'Doctor',
        'Full clinical access for this tenant.',
        TENANT_DOCTOR_PERMS,
        doctor.id,
        t,
      );
      const pathlabRole = await this.createTenantRole(
        'Pathlab',
        'Report upload access for this tenant.',
        TENANT_PATHLAB_PERMS,
        doctor.id,
        t,
      );

      // 3 — Doctor login
      const password_hash = await bcrypt.hash(dto.password, 10);
      await this.userModel.create(
        {
          name: dto.name,
          email: dto.email.toLowerCase(),
          password_hash,
          type: UserType.DOCTOR,
          role_id: doctorRole.id,
          doctor_id: doctor.id,
          is_active: true,
        } as any,
        { transaction: t },
      );

      return {
        doctor: this.toView(doctor),
        doctorRole: { id: doctorRole.id, name: doctorRole.name },
        pathlabRole: { id: pathlabRole.id, name: pathlabRole.name },
        login: { email: dto.email.toLowerCase(), tempPassword: dto.password },
        qrUrl: `${patientWebBase}/d/${slug}`,
      };
    });
  }

  /** Creates a named role with given permissions, scoped to a tenant. */
  private async createTenantRole(
    name: string,
    description: string,
    perms: { module: PermissionModule; action: PermissionAction }[],
    doctorId: string,
    transaction: any,
  ) {
    const role = await this.roleModel.create(
      { name, description, is_system: false, doctor_id: doctorId } as any,
      { transaction },
    );

    const permissions = await this.permissionModel.findAll({
      where: { module: perms.map((p) => p.module), action: perms.map((p) => p.action) },
      attributes: ['id', 'module', 'action'],
    });
    // Filter to only the exact (module, action) pairs we want.
    const wantedSet = new Set(perms.map((p) => `${p.module}:${p.action}`));
    const matched = permissions.filter((p) => wantedSet.has(`${p.module}:${p.action}`));

    if (matched.length) {
      await this.rolePermissionModel.bulkCreate(
        matched.map((p) => ({ role_id: role.id, permission_id: p.id })) as any,
        { transaction },
      );
    }
    return role;
  }

  /** Rotates the doctor's public_slug (invalidates old QR). */
  async regenerateSlug(id: string, patientWebBase: string) {
    const doctor = await this.getOrFail(id);
    const slug = await this.uniqueSlug(doctor.name);
    await doctor.update({ public_slug: slug } as any);
    return {
      ...this.toView(doctor),
      qrUrl: `${patientWebBase}/d/${slug}`,
    };
  }

  /** Slug for the doctor's public booking link, unique across soft-deletes. */
  private async uniqueSlug(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 40) || 'doctor';
    let slug = base;
    let n = 1;
    while (await this.doctorModel.findOne({ where: { public_slug: slug }, paranoid: false })) {
      slug = `${base}-${n++}`;
    }
    return slug;
  }

  /** Raw model fetch (internal use). */
  private async getOrFail(id: string): Promise<Doctor> {
    const doctor = await this.doctorModel.findByPk(id);
    if (!doctor)
      throw new AppException(ErrorCode.NOT_FOUND, { message: 'Doctor not found.' });
    return doctor;
  }

  /** Admin/self projection — resolves image keys to loadable URLs. */
  private toView(d: Doctor) {
    const json = d.toJSON() as any;
    const base = d.profile_base_url || this.config.get<string>('patientWebBase') || '';
    const cleanBase = base ? base.replace(/\/+$/, '') : '';
    return {
      ...json,
      profile_photo_url: this.storage.publicUrl(d.profile_photo_url),
      clinic_logo_url: this.storage.publicUrl(d.clinic_logo_key),
      qr_code_url: this.storage.publicUrl(d.qr_code_key),
      booking_url: cleanBase ? `${cleanBase}/d/${d.public_slug}` : `/d/${d.public_slug}`,
    };
  }

  // ── Public (patient app) ───────────────────────────────────

  async listEnabled(): Promise<any[]> {
    const doctors = await this.doctorModel.findAll({
      where: { is_enabled: true },
      order: [['name', 'ASC']],
    });
    return doctors.map((d) => this.toPublic(d));
  }

  async findEnabledBySlug(slug: string): Promise<any> {
    const doctor = await this.doctorModel.findOne({
      where: { public_slug: slug, is_enabled: true },
    });
    if (!doctor) throw new AppException(ErrorCode.DOCTOR_DISABLED);
    return this.toPublic(doctor);
  }

  async findEnabledById(id: string): Promise<Doctor> {
    const doctor = await this.doctorModel.findOne({
      where: { id, is_enabled: true },
    });
    if (!doctor) throw new AppException(ErrorCode.DOCTOR_DISABLED);
    return doctor;
  }

  /** Public-safe projection with resolved image URLs (no internal fields). */
  toPublic(d: Doctor) {
    const base = d.profile_base_url || this.config.get<string>('patientWebBase') || '';
    const cleanBase = base ? base.replace(/\/+$/, '') : '';
    return {
      id: d.id,
      name: d.name,
      specialization: d.specialization,
      qualifications: d.qualifications,
      bio: d.bio,
      consultation_fee: d.consultation_fee,
      public_slug: d.public_slug,
      profile_base_url: d.profile_base_url,
      booking_url: cleanBase ? `${cleanBase}/d/${d.public_slug}` : `/d/${d.public_slug}`,
      profile_photo_url: this.storage.publicUrl(d.profile_photo_url),
      qr_code_url: this.storage.publicUrl(d.qr_code_key),
    };
  }
}
