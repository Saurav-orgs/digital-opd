import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { Doctor } from './doctor.model';
import { User } from './user.model';

/**
 * A mobile number this doctor refuses bookings from.
 *
 * Per-doctor by design: blocking is a clinic's judgement about its own
 * nuisance callers, not a platform-wide ban.
 */
@Table({
  tableName: 'blocked_numbers',
  timestamps: true,
  underscored: true,
})
export class BlockedNumber extends Model<BlockedNumber> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @ForeignKey(() => Doctor)
  @Column({ type: DataType.UUID, allowNull: false })
  doctor_id: string;

  @Column({ type: DataType.STRING(10), allowNull: false })
  mobile: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  reason: string | null;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: true })
  blocked_by_user_id: string | null;

  @BelongsTo(() => User)
  blockedBy: User;

  @BelongsTo(() => Doctor)
  doctor: Doctor;
}
