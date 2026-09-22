import { Column, DataType, Model, Table } from 'sequelize-typescript';

/**
 * A plan on sale. Edited by the super admin; the landing page reads the
 * active ones. See the migration for why a plan is deactivated rather than
 * deleted once anyone has bought it.
 */
@Table({
  tableName: 'plans',
  timestamps: true,
  underscored: true,
  paranoid: true,
})
export class Plan extends Model<Plan> {
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
  id: string;

  /** Stable identifier the landing page and older subscriptions refer to. */
  @Column({ type: DataType.STRING(30), allowNull: false, unique: true })
  code: string;

  @Column({ type: DataType.STRING(60), allowNull: false })
  name: string;

  @Column({ type: DataType.STRING(160), allowNull: true })
  tagline: string | null;

  @Column({ type: DataType.DECIMAL(10, 2), allowNull: false })
  monthly_amount: string;

  @Column({ type: DataType.INTEGER, allowNull: false })
  months: number;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  is_active: boolean;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  is_recommended: boolean;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  sort_order: number;
}
