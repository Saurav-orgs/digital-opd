import {
  Column,
  DataType,
  HasMany,
  Model,
  Table,
} from 'sequelize-typescript';
import { OpdSchedule } from './opd-schedule.model';
import { ScheduleException } from './schedule-exception.model';
import { Appointment } from './appointment.model';
import { DoctorVerificationStatus } from '../../common/enums';

@Table({
  tableName: 'doctors',
  timestamps: true,
  underscored: true,
  paranoid: true,
})
export class Doctor extends Model<Doctor> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  name: string;

  @Column({ type: DataType.STRING, allowNull: true })
  specialization: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  qualifications: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  profile_photo_url: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  bio: string | null;

  @Column({ type: DataType.DECIMAL(10, 2), allowNull: true })
  consultation_fee: number | null;

  // ── Registration & verification ────────────────────────────
  // A self-registered doctor sits at `pending` — login refused, booking link
  // dead — until the super admin has reviewed the licence below.

  @Column({
    type: DataType.STRING,
    allowNull: false,
    defaultValue: DoctorVerificationStatus.APPROVED,
  })
  verification_status: DoctorVerificationStatus;

  @Column({ type: DataType.STRING, allowNull: true })
  license_number: string | null;

  /** S3 key of the practice licence / registration certificate. */
  @Column({ type: DataType.STRING, allowNull: true })
  license_file_key: string | null;

  @Column({ type: DataType.STRING(15), allowNull: true })
  contact_mobile: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  rejection_reason: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  reviewed_at: Date | null;

  /** When the doctor ticked the Provider Terms box, and which wording they
   *  were shown. Null for doctors created before the terms existed. */
  @Column({ type: DataType.DATE, allowNull: true })
  terms_accepted_at: Date | null;

  @Column({ type: DataType.STRING(40), allowNull: true })
  terms_version: string | null;

  // ── Prescription letterhead (per-doctor branding) ──────────
  /** Clinic/practice name shown on the prescription pad. Falls back to the
   *  env clinic, then the doctor's own name, when unset. */
  @Column({ type: DataType.STRING, allowNull: true })
  clinic_name: string | null;

  /** S3 key of the clinic logo shown in the letterhead. */
  @Column({ type: DataType.STRING, allowNull: true })
  clinic_logo_key: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  clinic_address: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  clinic_phone: string | null;

  /** Custom base URL for the doctor's booking page (e.g. 'https://booking.myclinic.com'). */
  @Column({ type: DataType.STRING, allowNull: true })
  profile_base_url: string | null;

  /** S3 key of the doctor's custom profile QR code image. */
  @Column({ type: DataType.STRING, allowNull: true })
  qr_code_key: string | null;

  /** For QR/deep-link to this doctor's booking screen. */
  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  public_slug: string;

  /** Controls patient-app visibility. */
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  is_enabled: boolean;

  @HasMany(() => OpdSchedule)
  schedules: OpdSchedule[];

  @HasMany(() => ScheduleException)
  exceptions: ScheduleException[];

  @HasMany(() => Appointment)
  appointments: Appointment[];
}
