import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { UserType } from '../../common/enums';
import { Role } from './role.model';
import { Doctor } from './doctor.model';

@Table({
  tableName: 'users',
  timestamps: true,
  underscored: true,
  paranoid: true,
  defaultScope: { attributes: { exclude: ['password_hash'] } },
  scopes: {
    withSecret: { attributes: { include: ['password_hash'] } },
  },
})
export class User extends Model<User> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  name: string;

  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  email: string;

  @Column({ type: DataType.STRING, allowNull: false })
  password_hash: string;

  @Column({ type: DataType.STRING, allowNull: false })
  type: UserType;

  @ForeignKey(() => Role)
  @Column({ type: DataType.UUID, allowNull: true })
  role_id: string | null;

  @ForeignKey(() => Doctor)
  @Column({ type: DataType.UUID, allowNull: true })
  doctor_id: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  is_active: boolean;

  /**
   * Opened through the online plan flow — the pricing page, or a super-admin
   * invite that mapped a plan.
   *
   * Informational only. It used to decide who needed a subscription to sign in,
   * which left every doctor created another way ungated *and* unable to buy a
   * plan; `SubscriptionAccessService` now gates every doctor account regardless.
   * Kept because "did this account come in through checkout?" is still worth
   * knowing on a support call.
   */
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  subscription_required: boolean;

  /**
   * The mobile number given at sign-up, before there was a doctor profile to
   * hold one. It pre-fills the first-login wizard — the same person typed it
   * minutes earlier — and stands in at a later checkout. Null for an account
   * opened any other way; `doctors.contact_mobile` is the number of record
   * once the practice exists.
   */
  @Column({ type: DataType.STRING(10), allowNull: true })
  mobile: string | null;

  /**
   * The super admin who opened this account from the Doctors screen, if it
   * was not opened by the doctor paying for it. It is what lets the sign-in
   * screen say "ask us for a plan" rather than "finish paying" to somebody
   * who was never sent to a checkout.
   */
  @Column({ type: DataType.UUID, allowNull: true })
  invited_by: string | null;

  /**
   * The password on this account was set by somebody else and has to be
   * replaced before the account can be used. Cleared by any password write.
   */
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  must_change_password: boolean;

  @BelongsTo(() => Role)
  role: Role;

  @BelongsTo(() => Doctor)
  doctor: Doctor;
}
