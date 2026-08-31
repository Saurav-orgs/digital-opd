'use strict';

const bcrypt = require('bcrypt');

/**
 * Patients get a password.
 *
 * Until now the mobile number *was* the credential: POST /patient/auth/identify
 * took a bare number and handed back a session plus the list of everyone
 * registered on it. Anyone could read a stranger's family's medical records by
 * guessing ten digits.
 *
 * Nullable rather than NOT NULL, because an account can be created without one:
 * the front desk books a walk-in by phone number, and that patient has never
 * chosen a password. Those accounts are asked to set one the first time they
 * sign in, which is why the API reports `has_password` separately from
 * `exists`.
 *
 * Existing rows are backfilled with a shared development password at the
 * client's instruction — this is a local database with test data in it. It must
 * not be run against real patient data.
 */
const SEED_PASSWORD = '12345678';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('patients', 'password_hash', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    const hash = await bcrypt.hash(SEED_PASSWORD, 10);
    await queryInterface.sequelize.query(
      'UPDATE patients SET password_hash = :hash WHERE password_hash IS NULL',
      { replacements: { hash } },
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('patients', 'password_hash');
  },
};
