'use strict';

/**
 * Remember, per account, that the one-time WhatsApp welcome has gone out.
 *
 * The first time a number registers or books on the patient side it gets a
 * "welcome, here is your doctor's booking link" message; every later door is a
 * no-op. A column on the account is what makes "every later door" possible —
 * the three patient-side entries (register, signup, guest booking) share no
 * other state, so without a stamp here a patient who signed up and then booked
 * would be welcomed twice.
 *
 * Nullable with no default: null is "not welcomed yet", a timestamp is when.
 * Existing accounts backfill to null and so are eligible for the greeting on
 * their next patient-side action, which is the kinder reading of "first time".
 *
 * Table touched:
 *   patients — add welcome_sent_at.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('patients', 'welcome_sent_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('patients', 'welcome_sent_at');
  },
};
