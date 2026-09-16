import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { User } from './user.model';

/** A password-reset code mailed to an admin-side user; see the migration for the lifecycle. */
@Table({ tableName: 'password_resets', timestamps: true, underscored: true })
export class PasswordReset extends Model<PasswordReset> {
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
  id: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  user_id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  code_hash: string;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  attempts: number;

  @Column({ type: DataType.DATE, allowNull: false })
  expires_at: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  verified_at: Date | null;

  /** Set once the code is verified; what the new-password call carries. */
  @Column({ type: DataType.STRING, allowNull: true, unique: true })
  token_hash: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  used_at: Date | null;

  @BelongsTo(() => User)
  user: User;
}
