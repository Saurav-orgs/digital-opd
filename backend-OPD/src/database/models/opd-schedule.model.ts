import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { Doctor } from './doctor.model';

/**
 * Per-doctor working-time config. A weekday may have MULTIPLE rows to support
 * split sessions (e.g. 11:00–14:00 and 17:00–19:00 both on Monday). There is
 * intentionally NO unique constraint on (doctor_id, day_of_week) (plan §4/§5).
 */
@Table({ tableName: 'opd_schedules', timestamps: true, underscored: true })
export class OpdSchedule extends Model<OpdSchedule> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @ForeignKey(() => Doctor)
  @Column({ type: DataType.UUID, allowNull: false })
  doctor_id: string;

  /** 0 = Sunday … 6 = Saturday. */
  @Column({ type: DataType.SMALLINT, allowNull: false })
  day_of_week: number;

  @Column({ type: DataType.TIME, allowNull: false })
  start_time: string;

  @Column({ type: DataType.TIME, allowNull: false })
  end_time: string;

  @Column({ type: DataType.SMALLINT, allowNull: false })
  slot_duration_min: number;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  is_active: boolean;

  @BelongsTo(() => Doctor)
  doctor: Doctor;
}
