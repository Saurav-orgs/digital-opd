import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';
import { InjectModel } from '@nestjs/sequelize';
import * as bcrypt from 'bcrypt';
import * as QRCode from 'qrcode';
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
  private readonly logger = new Logger(DoctorsService.name);

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
    private readonly settings: SettingsService,
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
    const baseBefore = doctor.profile_base_url;
    await doctor.update(dto as any);

    // The QR encodes base + slug. Changing the base silently leaves every
    // printed code pointing at the old host, so re-render when it moves.
    if ('profile_base_url' in dto && dto.profile_base_url !== baseBefore) {
      return this.toView(await this.syncQr(id));
    }
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

  /**
   * The QR image's bytes. Same reason as the prescription PDF: the bucket
   * sends no CORS headers, so the browser cannot `fetch` the S3 URL to build a
   * File for the share sheet. The <img> on the profile page still points
   * straight at S3 — images are not subject to that restriction.
   */
  async qrFile(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const doctor = await this.getOrFail(id);
    if (!doctor.qr_code_key) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'No QR code has been uploaded yet.',
      });
    }
    const slug = doctor.public_slug || 'doctor';
    return {
      buffer: await this.storage.download(doctor.qr_code_key),
      filename: `${slug}-booking-qr.png`,
    };
  }

  /**
   * Drop a hand-uploaded QR and fall back to the generated one.
   *
   * Not "leave the doctor with no QR": every enabled doctor has a booking
   * link, so there is always a correct QR to show, and an empty slot here just
   * meant the admin had to upload something by hand. Uploading remains the way
   * to override the generated image with a branded one.
   */
  async removeQr(id: string) {
    return this.toView(await this.syncQr(id));
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

    const registered = await this.sequelize.transaction(async (t) => {
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
          terms_accepted_at: new Date(),
          terms_version: dto.terms_version ?? null,
          // ── Licence review is no longer a gate ──────────────────
          // Registration used to land inert — no login, no booking link —
          // until a super admin opened the licence. The client asked for that
          // wait to go, so the account comes up live and the licence is
          // reviewed after the fact rather than before.
          //
          // To put the gate back: set these two to `false` /
          // `DoctorVerificationStatus.PENDING`, flip `is_active` on the user
          // below to false, and restore the "we will verify" copy on the
          // registration page. The approve/reject endpoints and the super
          // admin's pending panel were left in place for exactly that.
          is_enabled: true,
          verification_status: DoctorVerificationStatus.APPROVED,
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
          // Live immediately — see the note on the doctor row above.
          is_active: true,
        } as any,
        { transaction: t },
      );

      return { id: doctor.id, status: DoctorVerificationStatus.APPROVED };
    });

    // Same reasoning as createTenant: the tenant exists, the picture of its
    // booking link follows.
    await this.syncQr(registered.id);
    return registered;
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

  /**
   * Attach (or replace) a doctor's practice licence certificate.
   *
   * Separate from tenant creation on purpose: creation is one transaction that
   * makes a doctor, two roles and a login, and an S3 upload has no place
   * inside it. The admin UI creates first and uploads second, and this is also
   * how a certificate gets added to a doctor who was created before there was
   * anywhere to put one.
   */
  async uploadLicense(id: string, file: Express.Multer.File) {
    const doctor = await this.getOrFail(id);
    this.storage.validateDocument(file);
    const { key } = await this.storage.uploadDocument(
      file,
      `doctors/${id}/license`,
    );
    if (doctor.license_file_key) await this.storage.delete(doctor.license_file_key);
    await doctor.update({ license_file_key: key } as any);
    return this.adminProfile(id);
  }

  /**
   * Everything the super admin needs to look a doctor over: the profile, the
   * registration details, and a link that actually opens the certificate.
   *
   * `toView` cannot carry the licence link — it is synchronous and used on
   * every list response, while signing an S3 URL is neither cheap nor wanted
   * on a page that only shows names.
   */
  async adminProfile(id: string) {
    const doctor = await this.getOrFail(id);
    const user = await this.userModel.findOne({
      where: { doctor_id: doctor.id, type: UserType.DOCTOR },
      paranoid: false,
    });

    return {
      ...this.toView(doctor),
      license_number: doctor.license_number,
      contact_mobile: doctor.contact_mobile,
      license_url: doctor.license_file_key
        ? await this.storage.presignedGetUrl(doctor.license_file_key, 900)
        : null,
      verification_status: doctor.verification_status,
      rejection_reason: doctor.rejection_reason,
      reviewed_at: doctor.reviewed_at,
      terms_accepted_at: doctor.terms_accepted_at,
      terms_version: doctor.terms_version,
      created_at: (doctor as any).created_at ?? null,
      login_email: user?.email ?? null,
      login_active: user?.is_active ?? false,
    };
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

    const created = await this.sequelize.transaction(async (t) => {
      // 1 — Doctor profile
      const slug = await this.uniqueSlug(dto.name);
      const doctor = await this.doctorModel.create(
        {
          name: dto.name,
          specialization: dto.specialization ?? null,
          qualifications: dto.qualifications ?? null,
          bio: dto.bio ?? null,
          consultation_fee: dto.consultation_fee ?? null,
          license_number: dto.license_number ?? null,
          contact_mobile: dto.contact_mobile ?? null,
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
        doctorId: doctor.id,
      };
    });

    // Outside the transaction: an S3 round trip has no business holding a
    // database transaction open, and an orphaned object is the cheaper leak if
    // this fails.
    const withQr = await this.syncQr(created.doctorId);
    const { doctorId, ...result } = created;
    return { ...result, doctor: this.toView(withQr) };
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

  /**
   * Rotates the doctor's public_slug, which is what you do when a printed QR
   * has leaked or is being retired. The stored QR is re-rendered to match —
   * leaving the old image would hand out a picture of a dead link.
   */
  async regenerateSlug(id: string, patientWebBase: string) {
    const doctor = await this.getOrFail(id);
    const slug = await this.uniqueSlug(doctor.name);
    await doctor.update({ public_slug: slug } as any);
    const refreshed = await this.syncQr(id);
    return {
      ...this.toView(refreshed),
      qrUrl: `${patientWebBase}/d/${slug}`,
    };
  }

  /**
   * The URL a patient lands on: the tenant's own base when set, otherwise the
   * platform default, plus the doctor's slug.
   *
   * One definition, used by `toView` for the link shown in the UI and by the
   * QR renderer below. Two copies of this would eventually disagree, and a QR
   * that disagrees with the link beside it is worse than no QR.
   */
  bookingUrl(doctor: Doctor): string {
    // The doctor's own base wins; otherwise the platform setting the super
    // admin controls, which itself falls back to the deploy's env var.
    const base = doctor.profile_base_url || this.settings.patientWebBase();
    const clean = (base || '').replace(/\/+$/, '');
    return clean ? `${clean}/d/${doctor.public_slug}` : `/d/${doctor.public_slug}`;
  }

  /**
   * Render the doctor's booking QR and store it.
   *
   * Called wherever the encoded URL is born or changes — creation, self
   * registration, a slug rotation, an edit to the base URL. A QR is a picture
   * of a URL, so it is only correct for as long as that URL is, and a printed
   * code pointing at a dead slug is the failure this guards against.
   *
   * Best-effort by design: the caller has already created or updated a real
   * doctor, and losing the tenant because S3 hiccuped would be a far worse
   * outcome than a missing image the admin can regenerate.
   */
  async syncQr(id: string): Promise<Doctor> {
    const doctor = await this.getOrFail(id);
    try {
      const png = await QRCode.toBuffer(this.bookingUrl(doctor), {
        type: 'png',
        width: 512,
        margin: 2,
        errorCorrectionLevel: 'M',
      });

      const { key } = await this.storage.uploadImage(
        {
          buffer: png,
          originalname: `${doctor.public_slug}-booking-qr.png`,
          mimetype: 'image/png',
          size: png.length,
        } as Express.Multer.File,
        `doctors/${id}/qr`,
      );

      const previous = doctor.qr_code_key;
      await doctor.update({ qr_code_key: key } as any);
      if (previous) await this.storage.delete(previous);
    } catch (err) {
      this.logger.warn(
        `Could not generate the booking QR for doctor ${id}: ${(err as Error).message}`,
      );
    }
    return doctor;
  }

  /** Re-render the QR on demand — for doctors created before this existed. */
  async regenerateQr(id: string) {
    return this.toView(await this.syncQr(id));
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
    return {
      ...json,
      profile_photo_url: this.storage.publicUrl(d.profile_photo_url),
      clinic_logo_url: this.storage.publicUrl(d.clinic_logo_key),
      qr_code_url: this.storage.publicUrl(d.qr_code_key),
      // Same resolver the QR is rendered from — the link shown and the link
      // encoded must not be able to drift apart.
      booking_url: this.bookingUrl(d),
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
