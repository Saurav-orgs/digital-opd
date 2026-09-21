'use strict';

/**
 * Previous history on a prescription.
 *
 * While dictating, doctors sometimes put the patient's background on record
 * — "known diabetic", "allergic to penicillin", "already on Telma" — because
 * it explains what they are prescribing today. It had nowhere to go, so it
 * was either dropped or squeezed into the diagnosis. Now it is its own line,
 * printed on the sheet when present and absent from the form when not.
 *
 * Table touched:
 *   e_prescriptions — add previous_history (text, nullable).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('e_prescriptions', 'previous_history', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('e_prescriptions', 'previous_history');
  },
};
