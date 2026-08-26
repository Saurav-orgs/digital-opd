import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { Patient } from './patient.model';

/**
 * A real person. One `Patient` account (a mobile number) owns many of these —
 * the man who books, his wife, his father.
 *
 * Identity is `id`, never the name: two profiles on one account may carry the
 * same name and are still two different patients. Nothing here is matched
 * fuzzily at runtime — the patient picks a profile at booking, or gets a new
 * one. `patient_code` exists so the doctor can tell two same-named patients
 * apart on screen.
 */
@Table({
  tableName: 'patient_profiles',
  timestamps: true,
  underscored: true,
})
export class PatientProfile extends Model<PatientProfile> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  /** Human-visible id, e.g. `PT-7K3M9Q`. Unique across the platform. */
  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  patient_code: string;

  @ForeignKey(() => Patient)
  @Column({ type: DataType.UUID, allowNull: false })
  patient_id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  name: string;

  /** self | spouse | child | parent | other — a booking-UI label only. */
  @Column({ type: DataType.STRING, allowNull: true })
  relation: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  gender: string | null;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  dob: string | null;

  // ── Current address, used to prefill the next booking ──────
  // Each appointment keeps its own snapshot; this is the living copy.

  @Column({ type: DataType.TEXT, allowNull: true })
  address_line: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  city: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  state: string | null;

  @Column({ type: DataType.STRING(6), allowNull: true })
  pincode: string | null;

  /** Set instead of deleting once the patient has a completed OPD. */
  @Column({ type: DataType.DATE, allowNull: true })
  archived_at: Date | null;

  @BelongsTo(() => Patient)
  account: Patient;
}
