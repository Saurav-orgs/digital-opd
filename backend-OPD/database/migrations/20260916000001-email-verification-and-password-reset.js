'use strict';

/**
 * Email verification at sign-up, and password reset by email — admin side.
 *
 * Both are short-lived secrets tied to an address, kept hashed so a read of
 * the table gives nothing usable:
 *
 *   email_verifications — a 6-digit code sent to an address a doctor is
 *     registering with. Registration is refused until a row for that email
 *     is `verified_at`; the row is `consumed_at` once the account exists so
 *     one verification cannot back two sign-ups. `attempts` caps guessing.
 *
 *   password_resets — a 6-digit code mailed to the account's address.
 *     Typing it right sets `verified_at` and mints a short-lived token
 *     (`token_hash`) that the new-password call must carry; `used_at` is set
 *     when the password changes. Any earlier row for the same user is
 *     invalidated by the service when a new code is issued.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, UUIDV4, STRING, INTEGER, DATE } = Sequelize;

    await queryInterface.createTable('email_verifications', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      email: { type: STRING, allowNull: false },
      code_hash: { type: STRING, allowNull: false },
      attempts: { type: INTEGER, allowNull: false, defaultValue: 0 },
      expires_at: { type: DATE, allowNull: false },
      verified_at: { type: DATE, allowNull: true },
      consumed_at: { type: DATE, allowNull: true },
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    });
    await queryInterface.addIndex('email_verifications', ['email'], {
      name: 'email_verifications_email_idx',
    });

    await queryInterface.createTable('password_resets', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      user_id: {
        type: UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      code_hash: { type: STRING, allowNull: false },
      attempts: { type: INTEGER, allowNull: false, defaultValue: 0 },
      expires_at: { type: DATE, allowNull: false },
      verified_at: { type: DATE, allowNull: true },
      token_hash: { type: STRING, allowNull: true, unique: true },
      used_at: { type: DATE, allowNull: true },
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    });
    await queryInterface.addIndex('password_resets', ['user_id'], {
      name: 'password_resets_user_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('password_resets');
    await queryInterface.dropTable('email_verifications');
  },
};
