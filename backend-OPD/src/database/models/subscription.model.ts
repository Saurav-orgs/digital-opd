import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { User } from './user.model';
import { Doctor } from './doctor.model';
import { Plan } from './plan.model';
import { SubscriptionStatus } from '../../common/enums';

/**
 * One payment attempt for one plan. See the migration for the lifecycle;
 * `ends_at` on an `active` row is what lets a doctor sign in.
 */
@Table({ tableName: 'subscriptions', timestamps: true, underscored: true })
export class Subscription extends Model<Subscription> {
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
  id: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  user_id: string;

  @ForeignKey(() => Doctor)
  @Column({ type: DataType.UUID, allowNull: true })
  doctor_id: string | null;

  /**
   * The plan's `code` as it was when this was sold. A snapshot, like the
   * amounts below: editing a plan must not rewrite a paid invoice.
   */
  @Column({ type: DataType.STRING(20), allowNull: false })
  plan_id: string;

  /** The plan row it came from, for joins and reporting. */
  @ForeignKey(() => Plan)
  @Column({ type: DataType.UUID, allowNull: true })
  plan_ref: string | null;

  @Column({ type: DataType.INTEGER, allowNull: false })
  months: number;

  @Column({ type: DataType.DECIMAL(10, 2), allowNull: false })
  base_amount: string;

  @Column({ type: DataType.DECIMAL(5, 2), allowNull: false })
  gst_rate: string;

  @Column({ type: DataType.DECIMAL(10, 2), allowNull: false })
  gst_amount: string;

  @Column({ type: DataType.DECIMAL(10, 2), allowNull: false })
  total_amount: string;

  @Column({ type: DataType.STRING(3), allowNull: false, defaultValue: 'INR' })
  currency: string;

  @Column({ type: DataType.STRING(20), allowNull: false, defaultValue: SubscriptionStatus.PENDING })
  status: SubscriptionStatus;

  @Column({ type: DataType.STRING(64), allowNull: false, unique: true })
  cf_order_id: string;

  @Column({ type: DataType.STRING(64), allowNull: true })
  cf_payment_id: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  payment_session_id: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  starts_at: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  ends_at: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  paid_at: Date | null;

  /** Set when a super admin granted this rather than it being paid for online. */
  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: true })
  granted_by: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  grant_note: string | null;

  @BelongsTo(() => User, 'user_id')
  user: User;

  @BelongsTo(() => Doctor, 'doctor_id')
  doctor: Doctor;

  @BelongsTo(() => Plan, 'plan_ref')
  plan: Plan;
}
