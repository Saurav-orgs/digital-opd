'use strict';

/**
 * Payment now happens physically at the clinic, not through the software, so
 * every payment-related column is dropped:
 *   - appointments.payment_screenshot_url / payment_status / payment_method
 *   - doctors.payment_qr_url
 * A booked slot is simply `confirmed`; there is no screenshot, no online
 * payment state, and no UPI QR anywhere in the product.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeColumn('appointments', 'payment_screenshot_url');
    await queryInterface.removeColumn('appointments', 'payment_status');
    await queryInterface.removeColumn('appointments', 'payment_method');
    await queryInterface.removeColumn('doctors', 'payment_qr_url');
  },

  async down(queryInterface, Sequelize) {
    const { STRING } = Sequelize;
    // Re-added nullable so the restore never fails on existing rows.
    await queryInterface.addColumn('appointments', 'payment_screenshot_url', {
      type: STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('appointments', 'payment_status', {
      type: STRING,
      allowNull: false,
      defaultValue: 'paid_unverified',
    });
    await queryInterface.addColumn('appointments', 'payment_method', {
      type: STRING,
      allowNull: false,
      defaultValue: 'online',
    });
    await queryInterface.addColumn('doctors', 'payment_qr_url', {
      type: STRING,
      allowNull: true,
    });
  },
};
