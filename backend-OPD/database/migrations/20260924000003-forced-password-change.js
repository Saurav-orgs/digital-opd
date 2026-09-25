'use strict';

/**
 * An account whose password somebody else chose has to replace it.
 *
 * Set when a super admin opens an account from the Doctors screen: that
 * password travelled through an inbox in plain text, and it is the only
 * credential on a brand-new account, so the first thing the doctor does with
 * it is get rid of it. Cleared the moment any new password is set — by the
 * forced screen, by Forgot password, by anything.
 *
 * Nobody else is flagged. A doctor who chose their own password at sign-up has
 * nothing to replace, and flagging them would be a screen in the way of
 * somebody who already did the right thing.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'must_change_password', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'must_change_password');
  },
};
