'use strict';

/**
 * Adds a free-text `doctor_notes` field to appointments.
 * A doctor records a note on a visit so it can be referred to on the patient's
 * next OPD (found via the patient-mobile search on the appointments list).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('appointments', 'doctor_notes', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('appointments', 'doctor_notes');
  },
};
