import { BelongsTo, Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript';
import { User } from './user.model';
import { Doctor } from './doctor.model';
import { Subscription } from './subscription.model';

/** The issuer's details as they read on the day the invoice was raised. */
export interface InvoiceIssuer {
  name: string;
  address: string | null;
  gstin: string | null;
  pan: string | null;
  state: string | null;
  email: string | null;
  phone: string | null;
}

/** Who the invoice was made out to, snapshotted the same way. */
export interface InvoiceBuyer {
  name: string;
  email: string;
  mobile: string | null;
  gstin: string | null;
  address: string | null;
  placeOfSupply: string | null;
}

/**
 * A tax invoice for one paid subscription. Written once, when the payment is
 * confirmed, and never edited — see the migration for why everything on it is
 * a copy rather than a join. The PDF is rendered from this row on demand.
 */
@Table({ tableName: 'invoices', timestamps: true, underscored: true })
export class Invoice extends Model<Invoice> {
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
  id: string;

  @Column({ type: DataType.STRING(40), allowNull: false, unique: true })
  invoice_no: string;

  /** Financial year of the series, as `2026-27`. */
  @Column({ type: DataType.STRING(9), allowNull: false })
  fy: string;

  @Column({ type: DataType.INTEGER, allowNull: false })
  seq: number;

  @ForeignKey(() => Subscription)
  @Column({ type: DataType.UUID, allowNull: false, unique: true })
  subscription_id: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  user_id: string;

  @ForeignKey(() => Doctor)
  @Column({ type: DataType.UUID, allowNull: true })
  doctor_id: string | null;

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  issued_at: Date;

  @Column({ type: DataType.STRING(30), allowNull: false })
  plan_code: string;

  @Column({ type: DataType.STRING(60), allowNull: false })
  plan_name: string;

  @Column({ type: DataType.INTEGER, allowNull: false })
  months: number;

  @Column({ type: DataType.DATE, allowNull: true })
  period_start: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  period_end: Date | null;

  @Column({ type: DataType.STRING(3), allowNull: false, defaultValue: 'INR' })
  currency: string;

  @Column({ type: DataType.DECIMAL(10, 2), allowNull: false })
  base_amount: string;

  @Column({ type: DataType.DECIMAL(5, 2), allowNull: false })
  gst_rate: string;

  @Column({ type: DataType.DECIMAL(10, 2), allowNull: false })
  gst_amount: string;

  @Column({ type: DataType.DECIMAL(10, 2), allowNull: false })
  total_amount: string;

  @Column({ type: DataType.STRING(60), allowNull: true })
  cf_order_id: string | null;

  @Column({ type: DataType.STRING(60), allowNull: true })
  cf_payment_id: string | null;

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {} })
  issuer: InvoiceIssuer;

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {} })
  buyer: InvoiceBuyer;

  @BelongsTo(() => User)
  user?: User;

  @BelongsTo(() => Doctor)
  doctor?: Doctor;

  @BelongsTo(() => Subscription)
  subscription?: Subscription;
}
