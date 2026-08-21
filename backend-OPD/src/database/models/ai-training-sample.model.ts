import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { Appointment } from './appointment.model';
import { Doctor } from './doctor.model';
import { TrainingSampleKind } from '../../common/enums';

/**
 * A supervised training pair, captured whenever the doctor issues a prescription.
 *
 * `input_payload` is what the model saw (the transcript and context), `ai_output`
 * is what it produced, and `doctor_output` is what the doctor actually signed
 * off. That triple is exactly the dataset needed to fine-tune the drafting model
 * on this clinic's real language and prescribing habits — see
 * ai-OPD/finetune/. Rows where `edited` is false are just as valuable: they are
 * confirmations that the model was already right.
 */
@Table({
  tableName: 'ai_training_samples',
  timestamps: true,
  underscored: true,
})
export class AiTrainingSample extends Model<AiTrainingSample> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  kind: TrainingSampleKind;

  @ForeignKey(() => Appointment)
  @Column({ type: DataType.UUID, allowNull: true })
  appointment_id: string | null;

  @Column({ type: DataType.JSONB, allowNull: false })
  input_payload: Record<string, unknown>;

  @Column({ type: DataType.JSONB, allowNull: true })
  ai_output: Record<string, unknown> | null;

  @Column({ type: DataType.JSONB, allowNull: false })
  doctor_output: Record<string, unknown>;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  edited: boolean;

  @Column({ type: DataType.STRING, allowNull: true })
  model_version: string | null;

  @ForeignKey(() => Doctor)
  @Column({ type: DataType.UUID, allowNull: true })
  doctor_id: string | null;

  @BelongsTo(() => Appointment)
  appointment: Appointment;

  @BelongsTo(() => Doctor)
  doctor: Doctor;
}
