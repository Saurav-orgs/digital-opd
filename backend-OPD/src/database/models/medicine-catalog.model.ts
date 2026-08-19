import { Column, DataType, Model, Table } from 'sequelize-typescript';

/**
 * The clinic's own medicine vocabulary, grown from what the doctor actually
 * confirms on issued prescriptions.
 *
 * It does three jobs: autocomplete in the prescription editor, a spelling
 * reference for the drafting model, and a vocabulary hint for speech
 * recognition — which is the cheapest large win available on drug-name
 * accuracy, since Whisper otherwise hears brand names as ordinary words.
 */
@Table({
  tableName: 'medicine_catalog',
  timestamps: true,
  underscored: true,
})
export class MedicineCatalog extends Model<MedicineCatalog> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  name: string;

  @Column({ type: DataType.STRING, allowNull: true })
  strength: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  form: string | null;

  /** Ranks autocomplete and decides which names are worth sending to the model. */
  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  usage_count: number;
}
