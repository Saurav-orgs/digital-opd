'use strict';

/**
 * Let a patient who forgot their password get back in.
 *
 * A patient account is a mobile number — there is no email anywhere on the
 * patient side — so the reset has to travel the way the sign-up code already
 * does, over WhatsApp. That means reusing `mobile_verifications` rather than
 * standing up a second table shaped exactly like it, and the two columns here
 * are what it is missing to carry a reset.
 *
 *   purpose     — which flow issued the code. Sign-up refuses a number that
 *                 already has a password and the reset only serves one that
 *                 does, so the two sets happen to be disjoint today; that is a
 *                 coincidence of two guards rather than something the table
 *                 enforces, and a code sent to prove a new number must never
 *                 be spendable on someone's existing account. Existing rows
 *                 are backfilled to 'signup', which is all they ever were.
 *
 *   token_hash  — handed out once the code is checked and carried by the
 *                 set-password call, exactly as `password_resets.token_hash`
 *                 is on the admin side. Verifying the code and choosing the
 *                 password stay two steps, so a mistyped code never costs the
 *                 patient the password they just typed twice.
 *
 * Table touched:
 *   mobile_verifications — add purpose, token_hash.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('mobile_verifications', 'purpose', {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: 'signup',
    });
    await queryInterface.addColumn('mobile_verifications', 'token_hash', {
      type: Sequelize.STRING,
      allowNull: true,
      unique: true,
    });
    // The lookups are "the newest live row for this number in this flow" and
    // "the row holding this token"; neither is served by the existing index.
    await queryInterface.addIndex('mobile_verifications', ['mobile', 'purpose'], {
      name: 'mobile_verifications_mobile_purpose_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'mobile_verifications',
      'mobile_verifications_mobile_purpose_idx',
    );
    await queryInterface.removeColumn('mobile_verifications', 'token_hash');
    await queryInterface.removeColumn('mobile_verifications', 'purpose');
  },
};
