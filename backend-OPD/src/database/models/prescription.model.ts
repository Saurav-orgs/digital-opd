import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { Appointment } from './appointment.model';

/** A prescription image the doctor uploads against a visit (S3 object key). */
@Table({
  tableName: 'appointment_prescriptions',
  timestamps: true,
  underscored: true,
})
export class AppointmentPrescription extends Model<AppointmentPrescription> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @ForeignKey(() => Appointment)
  @Column({ type: DataType.UUID, allowNull: false })
  appointment_id: string;

  /** S3 object key for the uploaded prescription image. */
  @Column({ type: DataType.STRING, allowNull: false })
  image_key: string;

  @BelongsTo(() => Appointment)
  appointment: Appointment;
}
