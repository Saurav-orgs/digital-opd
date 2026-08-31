import { Column, DataType, HasMany, Model, Table } from 'sequelize-typescript';
import { PatientProfile } from './patient-profile.model';

/**
 * A phone-number account. Not a person: the people are `PatientProfile` rows
 * hanging off this. `mobile` is the unique key and the only thing registration
 * needs — the name, age and address belong to the profile.
 */
@Table({
  tableName: 'patients',
  timestamps: true,
  underscored: true,
})
export class Patient extends Model<Patient> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  mobile: string;

  /**
   * Legacy account label from before profiles existed. Nullable and no longer
   * written to — read the profile's name instead.
   */
  @Column({ type: DataType.STRING, allowNull: true })
  name: string | null;

  /**
   * bcrypt hash of the account password.
   *
   * Nullable: the front desk can create an account for a walk-in who has never
   * chosen one. Those accounts must set a password before they can sign in —
   * a null hash is "not set yet", never "any password will do".
   */
  @Column({ type: DataType.STRING, allowNull: true })
  password_hash: string | null;

  @HasMany(() => PatientProfile)
  profiles: PatientProfile[];
}
