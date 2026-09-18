'use strict';

/**
 * A link the doctor can hand a patient over WhatsApp.
 *
 * WhatsApp opens a chat with any number from a link, but will not take a
 * file with it — so the prescription goes as a URL. The URL carries a random
 * token that serves the issued PDF without a login, for a limited time.
 * Withdrawing the prescription clears the token, and with it the link.
 *
 * Table touched:
 *   e_prescriptions — add share_token (unique, random), share_token_expires_at.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('e_prescriptions', 'share_token', {
      type: Sequelize.STRING(64),
      allowNull: true,
      unique: true,
    });
    await queryInterface.addColumn('e_prescriptions', 'share_token_expires_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('e_prescriptions', 'share_token_expires_at');
    await queryInterface.removeColumn('e_prescriptions', 'share_token');
  },
};
