'use strict';

/**
 * Record that a doctor accepted the Provider Terms at registration.
 *
 * The checkbox on the sign-up form is a legal acceptance, and an acceptance
 * nobody wrote down is not worth collecting: the point of asking is to be able
 * to say later *who* agreed, *when*, and — because the wording will change —
 * to *which version* of the document. So the version string is stored
 * alongside the timestamp rather than assumed to be "whatever is current".
 *
 * Nullable, and existing doctors are left null: they were created before the
 * terms existed and backfilling a date would invent a consent that never
 * happened.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { STRING, DATE } = Sequelize;

    await queryInterface.addColumn('doctors', 'terms_accepted_at', {
      type: DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('doctors', 'terms_version', {
      type: STRING(40),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('doctors', 'terms_version');
    await queryInterface.removeColumn('doctors', 'terms_accepted_at');
  },
};
