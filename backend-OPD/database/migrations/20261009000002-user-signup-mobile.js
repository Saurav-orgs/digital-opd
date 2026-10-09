'use strict';

/**
 * Keep the mobile number the doctor typed at sign-up.
 *
 * The pricing page asks for email, password and mobile, and the mobile was
 * passed straight to Cashfree on the order and then dropped — nothing stored
 * it. So the first-login wizard, which is the same person a few minutes
 * later, asked for the number all over again, and the checkout for a renewal
 * had to fall back to the clinic's phone or a placeholder.
 *
 * Ten digits, the only shape the sign-up accepts (`CreateAccountDto`). Null
 * for every account opened another way — a super-admin invite, or any sign-up
 * from before this — so nothing is implied about a number we never had.
 *
 * Table touched:
 *   users — add mobile.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'mobile', {
      type: Sequelize.STRING(10),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'mobile');
  },
};
