'use strict';

/**
 * Platform settings the super admin can change without a redeploy.
 *
 * The first one is the patient portal's base URL. It was an environment
 * variable, which meant the address baked into every doctor's booking QR could
 * only be changed by editing a file on the server and restarting — and when it
 * was wrong (or unset, as it was here) every generated QR pointed at a host
 * that answered nothing.
 *
 * Key/value rather than a column per setting: these are operational knobs, and
 * a table that grows by rows is cheaper than one that grows by migrations.
 */
const PATIENT_WEB_BASE = 'https://76ml0vk8-5175.inc1.devtunnels.ms';

module.exports = {
  async up(queryInterface, Sequelize) {
    const { STRING, TEXT, DATE, literal } = Sequelize;

    await queryInterface.createTable('app_settings', {
      key: { type: STRING(80), primaryKey: true, allowNull: false },
      value: { type: TEXT, allowNull: true },
      created_at: { type: DATE, allowNull: false, defaultValue: literal('NOW()') },
      updated_at: { type: DATE, allowNull: false, defaultValue: literal('NOW()') },
    });

    // Seeded with the tunnel the patient portal is actually reachable on, so
    // the QRs generated from here can be scanned by a phone. A phone cannot
    // reach localhost, which is what the old default resolved to.
    await queryInterface.bulkInsert('app_settings', [
      {
        key: 'patient_web_base',
        value: PATIENT_WEB_BASE,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('app_settings');
  },
};
