import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  HasMany,
  Model,
  Table,
} from 'sequelize-typescript';
import {
  AppointmentStatus,
  BookingSource,
  ConsultationStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../common/enums';
import { Doctor } from './doctor.model';
import { AppointmentPrescription } from './prescription.model';

@Table({
  tableName: 'appointments',
  timestamps: true,
  underscored: true,
})
export class Appointment extends Model<Appointment> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @ForeignKey(() => Doctor)
  @Column({ type: DataType.UUID, allowNull: false })
  doctor_id: string;

  @Column({ type: DataType.DATEONLY, allowNull: false })
  appointment_date: string;

  @Column({ type: DataType.TIME, allowNull: false })
  start_time: string;

  @Column({ type: DataType.TIME, allowNull: false })
  end_time: string;

  @Column({ type: DataType.STRING, allowNull: false })
  patient_name: string;

  @Column({ type: DataType.STRING, allowNull: false })
  patient_mobile: string;

  /** male | female | other — captured at booking. */
  @Column({ type: DataType.STRING, allowNull: true })
  patient_gender: string | null;

  @Column({ type: DataType.SMALLINT, allowNull: true })
  patient_age: number | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  patient_address: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  description: string | null;

  /** Doctor's free-text note, referred to on the patient's next OPD visit. */
  @Column({ type: DataType.TEXT, allowNull: true })
  doctor_notes: string | null;

  /** Doctor's reminder for the patient's next visit, set from this visit. */
  @Column({ type: DataType.TEXT, allowNull: true })
  next_visit_note: string | null;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  next_visit_date: string | null;

  /** S3 object key for the uploaded payment screenshot (null for walk-ins). */
  @Column({ type: DataType.STRING, allowNull: true })
  payment_screenshot_url: string | null;

  /** Only `confirmed` occupies a slot (partial unique index). */
  @Column({
    type: DataType.STRING,
    allowNull: false,
    defaultValue: AppointmentStatus.CONFIRMED,
  })
  status: AppointmentStatus;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    defaultValue: ConsultationStatus.PENDING,
  })
  consultation_status: ConsultationStatus;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    defaultValue: PaymentStatus.PAID_UNVERIFIED,
  })
  payment_status: PaymentStatus;

  @Column({ type: DataType.STRING, allowNull: false })
  source: BookingSource;

  /** online (app/web) | cod (walk-in). */
  @Column({
    type: DataType.STRING,
    allowNull: false,
    defaultValue: PaymentMethod.ONLINE,
  })
  payment_method: PaymentMethod;

  @BelongsTo(() => Doctor)
  doctor: Doctor;

  @HasMany(() => AppointmentPrescription)
  prescriptions: AppointmentPrescription[];
}
