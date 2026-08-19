'use strict';

/**
 * Consolidated AI summary of ALL reports a patient uploaded for one visit.
 *
 * The per-report summaries (on patient_reports) stay as they are; this adds one
 * combined overview per appointment so the doctor reads a single clinical
 * picture instead of three or four separate ones. It is (re)generated whenever
 * the set of summarised reports for the appointment changes.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { STRING, TEXT, INTEGER, DATE, JSONB } = Sequelize;

    await queryInterface.addColumn('appointments', 'reports_summary', {
      type: JSONB,
      allowNull: true,
    });
    // null = nothing to summarise yet; otherwise pending|processing|ready|failed.
    await queryInterface.addColumn('appointments', 'reports_summary_status', {
      type: STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('appointments', 'reports_summary_error', {
      type: TEXT,
      allowNull: true,
    });
    // How many report summaries this consolidation covered — lets the UI say
    // "across 3 reports" and lets the service tell when to regenerate.
    await queryInterface.addColumn('appointments', 'reports_summary_count', {
      type: INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('appointments', 'reports_summarized_at', {
      type: DATE,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('appointments', 'reports_summarized_at');
    await queryInterface.removeColumn('appointments', 'reports_summary_count');
    await queryInterface.removeColumn('appointments', 'reports_summary_error');
    await queryInterface.removeColumn('appointments', 'reports_summary_status');
    await queryInterface.removeColumn('appointments', 'reports_summary');
  },
};
