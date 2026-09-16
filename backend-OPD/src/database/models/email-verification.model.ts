import { Column, DataType, Model, Table } from 'sequelize-typescript';

/**
 * A code sent to an email address a doctor is registering with. See the
 * migration for the lifecycle; the code itself is never stored, only its hash.
 */
@Table({ tableName: 'email_verifications', timestamps: true, underscored: true })
export class EmailVerification extends Model<EmailVerification> {
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
  id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  email: string;

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
