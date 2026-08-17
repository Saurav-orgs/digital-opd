import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Doctor } from '../database/models/doctor.model';
import { CreateDoctorDto, UpdateDoctorDto } from './dto/doctor.dto';
import { StorageService } from '../uploads/storage.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

@Injectable()
export class DoctorsService {
  constructor(
    @InjectModel(Doctor) private readonly doctorModel: typeof Doctor,
    private readonly storage: StorageService,
  ) {}

  async create(dto: CreateDoctorDto) {
    const public_slug = await this.uniqueSlug(dto.name);
    const doctor = await this.doctorModel.create({
      ...dto,
      public_slug,
      is_enabled: false,
    } as any);
    return this.toView(doctor);
  }

  async findAll() {
    const doctors = await this.doctorModel.findAll({
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

  async remove(id: string): Promise<void> {
    const doctor = await this.getOrFail(id);
    await doctor.destroy(); // soft delete
  }

  async setEnabled(id: string, enabled: boolean) {
    const doctor = await this.getOrFail(id);
    await doctor.update({ is_enabled: enabled } as any);
    return this.toView(doctor);
  }

  async uploadQr(id: string, file: Express.Multer.File) {
    const doctor = await this.getOrFail(id);
    const { key } = await this.storage.uploadImage(file, `doctors/${id}/qr`);
    // Replace previous QR object if any.
    if (doctor.payment_qr_url) await this.storage.delete(doctor.payment_qr_url);
    await doctor.update({ payment_qr_url: key } as any);
    return this.toView(doctor);
  }

  async uploadPhoto(id: string, file: Express.Multer.File) {
    const doctor = await this.getOrFail(id);
    const { key } = await this.storage.uploadImage(file, `doctors/${id}/photo`);
    if (doctor.profile_photo_url)
      await this.storage.delete(doctor.profile_photo_url);
    await doctor.update({ profile_photo_url: key } as any);
    return this.toView(doctor);
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
      payment_qr_url: this.storage.publicUrl(d.payment_qr_url),
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
    return {
      id: d.id,
      name: d.name,
      specialization: d.specialization,
      qualifications: d.qualifications,
      bio: d.bio,
      consultation_fee: d.consultation_fee,
      public_slug: d.public_slug,
      profile_photo_url: this.storage.publicUrl(d.profile_photo_url),
      payment_qr_url: this.storage.publicUrl(d.payment_qr_url),
    };
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 40) || 'doctor';
    let slug = base;
    let n = 1;
    // Collide-check against existing (including soft-deleted) slugs.
    while (
      await this.doctorModel.findOne({ where: { public_slug: slug }, paranoid: false })
    ) {
      slug = `${base}-${n++}`;
    }
    return slug;
  }
}
