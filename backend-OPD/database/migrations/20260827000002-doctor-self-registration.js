'use strict';

/**
 * Doctors registering themselves, instead of only being created by the super
 * admin.
 *
 * A self-registered doctor is a claim, not a fact: anyone can type a name and a
 * specialisation. So registration lands in `pending` with a practice licence
 * attached, and stays inert — login refused, booking link dead — until the super
 * admin has looked at the licence and approved it. Nothing about a pending
 * doctor is reachable by patients.
 *
 * Existing doctors were created by the super admin directly, which is itself an
 * approval, so they backfill to `approved`.
 */
const STATUSES = ['pending', 'approved', 'rejected'];

module.exports = {
  async up(queryInterface, Sequelize) {
    const { STRING, TEXT, DATE } = Sequelize;

    await queryInterface.addColumn('doctors', 'verification_status', {
      type: STRING,
      allowNull: false,
      defaultValue: 'approved',
    });
    await queryInterface.addColumn('doctors', 'license_number', {
      type: STRING,
      allowNull: true,
    });
    /** S3 key of the uploaded practice licence / registration certificate. */
    await queryInterface.addColumn('doctors', 'license_file_key', {
      type: STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('doctors', 'contact_mobile', {
      type: STRING(15),
      allowNull: true,
    });
    /** Why the super admin turned the registration down, shown at login. */
    await queryInterface.addColumn('doctors', 'rejection_reason', {
      type: TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('doctors', 'reviewed_at', {
      type: DATE,
      allowNull: true,
    });

    // Everything that already exists predates self-registration.
    await queryInterface.sequelize.query(
      `UPDATE doctors SET verification_status = 'approved' WHERE verification_status IS NULL;`,
    );

    await queryInterface.addIndex('doctors', ['verification_status'], {
      name: 'doctors_verification_status_idx',
    });

    console.log(`  verification_status accepts: ${STATUSES.join(', ')}`);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('doctors', 'doctors_verification_status_idx');
    await queryInterface.removeColumn('doctors', 'reviewed_at');
    await queryInterface.removeColumn('doctors', 'rejection_reason');
    await queryInterface.removeColumn('doctors', 'contact_mobile');
    await queryInterface.removeColumn('doctors', 'license_file_key');
    await queryInterface.removeColumn('doctors', 'license_number');
    await queryInterface.removeColumn('doctors', 'verification_status');
  },
};
