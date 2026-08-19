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
