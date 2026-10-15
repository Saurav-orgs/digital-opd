import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { MobileVerificationPurpose } from '../../common/enums';

/**
 * A code sent over WhatsApp to a patient's mobile number — to prove a new
 * number at sign-up, or to let an existing account choose a new password.
 * Same lifecycle as `EmailVerification`; the code itself is never stored,
 * only its hash.
 */
@Table({ tableName: 'mobile_verifications', timestamps: true, underscored: true })
export class MobileVerification extends Model<MobileVerification> {
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
  id: string;

  @Column({ type: DataType.STRING(15), allowNull: false })
  mobile: string;

  /**
   * Which flow issued this code. Every query filters on it, so a code sent to
   * prove a new number can never be spent resetting an existing account's
   * password, or the other way round — see the migration.
   */
  @Column({
    type: DataType.STRING(20),
    allowNull: false,
    defaultValue: MobileVerificationPurpose.SIGNUP,
  })
  purpose: MobileVerificationPurpose;

  @Column({ type: DataType.STRING, allowNull: false })
  code_hash: string;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  attempts: number;

  @Column({ type: DataType.DATE, allowNull: false })
  expires_at: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  verified_at: Date | null;

  /**
   * Set once a reset code is verified; what the set-password call carries.
   * Null for the sign-up flow, which proves the number to `signup` / `register`
   * directly rather than handing anything back to the client.
   */
  @Column({ type: DataType.STRING, allowNull: true, unique: true })
  token_hash: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  consumed_at: Date | null;
}
