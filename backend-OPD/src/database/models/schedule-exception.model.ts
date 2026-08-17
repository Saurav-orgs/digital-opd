import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { ScheduleExceptionType } from '../../common/enums';
import { Doctor } from './doctor.model';

/** Leave / holidays / one-off schedule changes for a specific date. */
@Table({
  tableName: 'schedule_exceptions',
  timestamps: true,
  underscored: true,
})
export class ScheduleException extends Model<ScheduleException> {
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
  date: string;

  @Column({ type: DataType.STRING, allowNull: false })
  type: ScheduleExceptionType;

  /** Only used for `custom` overrides; null for `leave`. */
  @Column({ type: DataType.TIME, allowNull: true })
  start_time: string | null;

  @Column({ type: DataType.TIME, allowNull: true })
  end_time: string | null;

  @Column({ type: DataType.SMALLINT, allowNull: true })
  slot_duration_min: number | null;

  @Column({ type: DataType.STRING, allowNull: true })
  reason: string | null;

  @BelongsTo(() => Doctor)
  doctor: Doctor;
}
