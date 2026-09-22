'use strict';

/**
 * Mobile verification at patient sign-up — a 6-digit code sent over WhatsApp.
 *
 * Mirrors `email_verifications` on the admin side: opening a patient account
 * (signup from the booking flow, or register from the portal) is refused
 * until a row for that mobile is `verified_at`; the row is `consumed_at`
 * once the account has its password so one code cannot back two sign-ups.
 * `attempts` caps guessing; the hash is all that is ever stored.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, UUIDV4, STRING, INTEGER, DATE } = Sequelize;

    await queryInterface.createTable('mobile_verifications', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      mobile: { type: STRING(15), allowNull: false },
      code_hash: { type: STRING, allowNull: false },
      attempts: { type: INTEGER, allowNull: false, defaultValue: 0 },
      expires_at: { type: DATE, allowNull: false },
      verified_at: { type: DATE, allowNull: true },
      consumed_at: { type: DATE, allowNull: true },
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    });
    await queryInterface.addIndex('mobile_verifications', ['mobile'], {
      name: 'mobile_verifications_mobile_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('mobile_verifications');
  },
};
