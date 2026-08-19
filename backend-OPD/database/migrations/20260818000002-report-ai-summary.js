'use strict';

/**
 * AI summaries for patient reports.
 *
 * A summary is generated asynchronously after upload, so each row carries its
 * own status: the doctor's UI shows "summarising…" while it runs and the
 * failure reason if the local AI service was down. `ai_model_version` records
 * which models produced the text, so a summary written by an older model stays
 * traceable after an upgrade.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { STRING, TEXT, DATE, JSONB } = Sequelize;

    await queryInterface.addColumn('patient_reports', 'ai_summary', {
      type: JSONB,
      allowNull: true,
    });
    await queryInterface.addColumn('patient_reports', 'ai_summary_status', {
      type: STRING,
      allowNull: false,
      defaultValue: 'pending',
    });
    await queryInterface.addColumn('patient_reports', 'ai_summary_error', {
      type: TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('patient_reports', 'ai_model_version', {
      type: STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('patient_reports', 'ai_summarized_at', {
      type: DATE,
      allowNull: true,
    });

    // The startup sweeper scans for unfinished work; without this it would be a
    // full table scan on every boot.
    await queryInterface.addIndex('patient_reports', ['ai_summary_status'], {
      name: 'patient_reports_ai_status_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'patient_reports',
      'patient_reports_ai_status_idx',
    );
    await queryInterface.removeColumn('patient_reports', 'ai_summarized_at');
    await queryInterface.removeColumn('patient_reports', 'ai_model_version');
    await queryInterface.removeColumn('patient_reports', 'ai_summary_error');
    await queryInterface.removeColumn('patient_reports', 'ai_summary_status');
    await queryInterface.removeColumn('patient_reports', 'ai_summary');
  },
};
