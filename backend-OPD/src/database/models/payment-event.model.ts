import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { Subscription } from './subscription.model';
import { User } from './user.model';
import { Doctor } from './doctor.model';
import { PaymentEventSource } from '../../common/enums';

/**
 * One line of the payment audit trail — a webhook, a status poll that moved
 * something, or an admin acting by hand. Append-only: nothing updates a row
 * here, because an audit trail that can be edited is not one.
 */
@Table({ tableName: 'payment_events', timestamps: true, underscored: true })
export class PaymentEvent extends Model<PaymentEvent> {
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
  id: string;

  @ForeignKey(() => Subscription)
  @Column({ type: DataType.UUID, allowNull: true })
  subscription_id: string | null;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: true })
  user_id: string | null;

  @ForeignKey(() => Doctor)
  @Column({ type: DataType.UUID, allowNull: true })
  doctor_id: string | null;

  @Column({ type: DataType.STRING(20), allowNull: false })
  source: PaymentEventSource;

  @Column({ type: DataType.STRING(60), allowNull: false })
  event_type: string;

  @Column({ type: DataType.STRING(20), allowNull: true })
  status: string | null;

  @Column({ type: DataType.STRING(64), allowNull: true })
  cf_order_id: string | null;

  @Column({ type: DataType.STRING(64), allowNull: true })
  cf_payment_id: string | null;

  @Column({ type: DataType.DECIMAL(10, 2), allowNull: true })
  amount: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: true })
  signature_valid: boolean | null;

  /** True when this event is what actually moved the subscription. */
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  applied: boolean;

  @Column({ type: DataType.TEXT, allowNull: true })
  message: string | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  payload: unknown | null;

  @BelongsTo(() => Subscription)
  subscription: Subscription;

  @BelongsTo(() => User)
  user: User;

  @BelongsTo(() => Doctor)
  doctor: Doctor;
}
