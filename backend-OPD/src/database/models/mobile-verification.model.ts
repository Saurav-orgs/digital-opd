import { Column, DataType, Model, Table } from 'sequelize-typescript';

/**
 * A code sent over WhatsApp to a mobile number a patient is registering
 * with. Same lifecycle as `EmailVerification`; the code itself is never
 * stored, only its hash.
 */
@Table({ tableName: 'mobile_verifications', timestamps: true, underscored: true })
export class MobileVerification extends Model<MobileVerification> {
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
  id: string;

  @Column({ type: DataType.STRING(15), allowNull: false })
  mobile: string;

  @Column({ type: DataType.STRING, allowNull: false })
  code_hash: string;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  attempts: number;

  @Column({ type: DataType.DATE, allowNull: false })
  expires_at: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  verified_at: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  consumed_at: Date | null;
}
