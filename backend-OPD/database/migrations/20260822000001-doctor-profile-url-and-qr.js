'use strict';

/**
 * Doctor Profile Base URL & QR Code Image.
 *
 * Allows Super Admin to configure a custom base URL for the doctor's booking portal
 * (e.g. 'https://booking.myclinic.com') while keeping the unique /d/{public_slug} suffix,
 * and upload a custom doctor profile QR code image stored in S3.
 *
 * Table touched:
 *   doctors — add profile_base_url, qr_code_key.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { STRING } = Sequelize;
    await queryInterface.addColumn('doctors', 'profile_base_url', {
      type: STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('doctors', 'qr_code_key', {
      type: STRING,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('doctors', 'qr_code_key');
    await queryInterface.removeColumn('doctors', 'profile_base_url');
  },
};
