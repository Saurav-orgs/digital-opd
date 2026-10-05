'use strict';

/**
 * The IVF case-sheet — the infertility intake / investigations worksheet an
 * IVF & Fertility doctor fills for a visit, and the templates they save to
 * start the next one from.
 *
 *   ivf_case_sheets — one per appointment, the same lifecycle as an
 *     e-prescription: a draft the doctor edits, then issues, which renders the
 *     A4 PDF onto their letterhead and notifies the patient. The unique
 *     `appointment_id` is what makes "one per appointment" true under a race,
 *     the way `e_prescriptions` is keyed; `find-or-create` gives the editor an
 *     empty draft on first open.
 *
 *   ivf_case_sheet_templates — a doctor's saved starting points. Simpler than
 *     `prescription_templates`: no built-ins and no overrides, because the form
 *     is one clinic's own and there is nothing product-wide to ship. `name`
 *     unique per doctor (partial, so a deleted template does not hold its name).
 *
 * The body of both is a single JSONB `data` column, not a column per field.
 * The sheet is a form the clinic owns, read and written whole and never
 * queried by field — the same call `patient_profiles.conditions` made — so a
 * fixed set of ~70 columns would be churn with no query to justify it. The
 * server decides what a valid body is (`ivf-case-sheet.schema.ts`), not a
 * CHECK constraint, because the rule is "known keys only, each capped", which
 * no column type expresses.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, UUIDV4, STRING, JSONB, DATE } = Sequelize;

    await queryInterface.createTable('ivf_case_sheets', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },

      appointment_id: {
        type: UUID,
        allowNull: false,
        references: { model: 'appointments', key: 'id' },
        onDelete: 'CASCADE',
      },

      doctor_id: {
        type: UUID,
        allowNull: false,
        references: { model: 'doctors', key: 'id' },
        onDelete: 'CASCADE',
      },

      /** 'draft' until issued, then 'issued' — the same two states a
       *  prescription has (`PrescriptionStatus`). Plain string, no enum type. */
      status: { type: STRING(16), allowNull: false, defaultValue: 'draft' },

      /** The whole form. See the note above about JSONB over columns. */
      data: { type: JSONB, allowNull: false, defaultValue: {} },

      /** S3 key of the generated PDF, written when the sheet is issued. */
      pdf_key: { type: STRING, allowNull: true },

      issued_at: { type: DATE, allowNull: true },

      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      deleted_at: { type: DATE, allowNull: true },
    });

    // One sheet per appointment. Partial so a soft-deleted sheet does not block
    // a fresh one for the same visit.
    await queryInterface.addIndex('ivf_case_sheets', ['appointment_id'], {
      unique: true,
      where: { deleted_at: null },
      name: 'ivf_case_sheets_appointment_unique',
    });
    await queryInterface.addIndex('ivf_case_sheets', ['doctor_id'], {
      name: 'ivf_case_sheets_doctor_idx',
    });

    await queryInterface.createTable('ivf_case_sheet_templates', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },

      doctor_id: {
        type: UUID,
        allowNull: false,
        references: { model: 'doctors', key: 'id' },
        onDelete: 'CASCADE',
      },

      name: { type: STRING(160), allowNull: false },

      /** A saved case-sheet body, same shape as `ivf_case_sheets.data`. */
      data: { type: JSONB, allowNull: false, defaultValue: {} },

      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      deleted_at: { type: DATE, allowNull: true },
    });

    // One name per doctor, partial for the same reason
    // `prescription_templates_doctor_name_unique` is.
    await queryInterface.addIndex('ivf_case_sheet_templates', ['doctor_id', 'name'], {
      unique: true,
      where: { deleted_at: null },
      name: 'ivf_case_sheet_templates_doctor_name_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ivf_case_sheet_templates');
    await queryInterface.dropTable('ivf_case_sheets');
  },
};
