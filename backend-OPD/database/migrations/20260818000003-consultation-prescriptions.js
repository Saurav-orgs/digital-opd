'use strict';

/**
 * Voice-to-prescription.
 *
 * The doctor records the consultation; it is transcribed locally, an AI drafts a
 * structured prescription, the doctor edits it, then issues it to the patient.
 *
 *  - consultation_sessions    the recording job + resulting transcript.
 *                             Audio itself is never stored, only the transcript.
 *  - e_prescriptions          one prescription per appointment, draft → issued.
 *  - e_prescription_medicines the structured medicine rows.
 *  - medicine_catalog         the clinic's own vocabulary, grown from what the
 *                             doctor actually confirms. Feeds autocomplete and
 *                             biases both speech recognition and drafting.
 *  - ai_training_samples      every AI draft paired with the doctor's corrected
 *                             version — the dataset for fine-tuning later.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, UUIDV4, STRING, TEXT, INTEGER, SMALLINT, BOOLEAN, DATE, DATEONLY, JSONB } =
      Sequelize;
    const now = { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') };

    // ── consultation_sessions ────────────────────────────────
    await queryInterface.createTable('consultation_sessions', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      appointment_id: {
        type: UUID,
        allowNull: false,
        references: { model: 'appointments', key: 'id' },
        onDelete: 'CASCADE',
      },
      // transcribing → drafting → draft_ready, or failed at either step.
      status: { type: STRING, allowNull: false, defaultValue: 'transcribing' },
      transcript: { type: TEXT, allowNull: true },
      language: { type: STRING, allowNull: true },
      duration_seconds: { type: INTEGER, allowNull: true },
      model_version: { type: STRING, allowNull: true },
      error: { type: TEXT, allowNull: true },
      created_at: now,
      updated_at: now,
    });
    await queryInterface.addIndex('consultation_sessions', ['appointment_id'], {
      name: 'consultation_sessions_appointment_idx',
    });

    // ── e_prescriptions ──────────────────────────────────────
    await queryInterface.createTable('e_prescriptions', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      appointment_id: {
        type: UUID,
        allowNull: false,
        references: { model: 'appointments', key: 'id' },
        onDelete: 'CASCADE',
      },
      // Null when the doctor wrote the prescription by hand instead of dictating.
      consultation_session_id: {
        type: UUID,
        allowNull: true,
        references: { model: 'consultation_sessions', key: 'id' },
        onDelete: 'SET NULL',
      },
      status: { type: STRING, allowNull: false, defaultValue: 'draft' },
      diagnosis: { type: TEXT, allowNull: true },
      advice: { type: TEXT, allowNull: true },
      follow_up_date: { type: DATEONLY, allowNull: true },
      pdf_key: { type: STRING, allowNull: true },
      issued_at: { type: DATE, allowNull: true },
      created_at: now,
      updated_at: now,
    });
    // One prescription per appointment — the doctor edits it, they don't
    // accumulate drafts.
    await queryInterface.addIndex('e_prescriptions', ['appointment_id'], {
      name: 'e_prescriptions_appointment_uniq',
      unique: true,
    });

    // ── e_prescription_medicines ─────────────────────────────
    await queryInterface.createTable('e_prescription_medicines', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      e_prescription_id: {
        type: UUID,
        allowNull: false,
        references: { model: 'e_prescriptions', key: 'id' },
        onDelete: 'CASCADE',
      },
      position: { type: SMALLINT, allowNull: false, defaultValue: 0 },
      medicine_name: { type: STRING, allowNull: false },
      strength: { type: STRING, allowNull: true },
      form: { type: STRING, allowNull: true },
      // Indian convention: morning-afternoon-night, e.g. "1-0-1".
      dosage: { type: STRING, allowNull: false },
      timing: { type: STRING, allowNull: true },
      duration_days: { type: SMALLINT, allowNull: true },
      instructions: { type: TEXT, allowNull: true },
      // Whether the row came from the AI or the doctor typed it, and whether
      // the doctor changed an AI row. Drives the training dataset.
      source: { type: STRING, allowNull: false, defaultValue: 'doctor' },
      was_edited: { type: BOOLEAN, allowNull: false, defaultValue: false },
      created_at: now,
      updated_at: now,
    });
    await queryInterface.addIndex('e_prescription_medicines', ['e_prescription_id'], {
      name: 'e_prescription_medicines_prescription_idx',
    });

    // ── medicine_catalog ─────────────────────────────────────
    await queryInterface.createTable('medicine_catalog', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      name: { type: STRING, allowNull: false },
      strength: { type: STRING, allowNull: true },
      form: { type: STRING, allowNull: true },
      // Ranks autocomplete and picks which names are worth sending to the model.
      usage_count: { type: INTEGER, allowNull: false, defaultValue: 0 },
      created_at: now,
      updated_at: now,
    });
    await queryInterface.addIndex('medicine_catalog', ['name'], {
      name: 'medicine_catalog_name_uniq',
      unique: true,
    });

    // ── ai_training_samples ──────────────────────────────────
    await queryInterface.createTable('ai_training_samples', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      kind: { type: STRING, allowNull: false }, // prescription | report_summary
      appointment_id: {
        type: UUID,
        allowNull: true,
        references: { model: 'appointments', key: 'id' },
        onDelete: 'SET NULL',
      },
      input_payload: { type: JSONB, allowNull: false },
      ai_output: { type: JSONB, allowNull: true },
      doctor_output: { type: JSONB, allowNull: false },
      // False means the AI got it exactly right — just as useful for training.
      edited: { type: BOOLEAN, allowNull: false, defaultValue: false },
      model_version: { type: STRING, allowNull: true },
      created_at: now,
      updated_at: now,
    });
    await queryInterface.addIndex('ai_training_samples', ['kind', 'edited'], {
      name: 'ai_training_samples_kind_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ai_training_samples');
    await queryInterface.dropTable('medicine_catalog');
    await queryInterface.dropTable('e_prescription_medicines');
    await queryInterface.dropTable('e_prescriptions');
    await queryInterface.dropTable('consultation_sessions');
  },
};
