'use strict';

/**
 * Single-doctor feature set:
 *  - appointments gain patient_gender / patient_age (captured at booking) and
 *    payment_method (online for app/web bookings, cod for doctor walk-ins).
 *  - payment_screenshot_url becomes nullable — walk-ins have no screenshot.
 *  - appointment_prescriptions stores the doctor's uploaded prescription images
 *    (S3 object keys), referred to on the patient's next OPD visit.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, UUIDV4, STRING, SMALLINT, DATE } = Sequelize;

    await queryInterface.addColumn('appointments', 'patient_gender', {
      type: STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('appointments', 'patient_age', {
      type: SMALLINT,
      allowNull: true,
    });
    await queryInterface.addColumn('appointments', 'payment_method', {
      type: STRING,
      allowNull: false,
      defaultValue: 'online',
    });

    // Walk-ins carry no payment screenshot.
    await queryInterface.changeColumn('appointments', 'payment_screenshot_url', {
      type: STRING,
      allowNull: true,
    });

    await queryInterface.createTable('appointment_prescriptions', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      appointment_id: {
        type: UUID,
        allowNull: false,
        references: { model: 'appointments', key: 'id' },
        onDelete: 'CASCADE',
      },
      image_key: { type: STRING, allowNull: false },
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    });
    await queryInterface.addIndex('appointment_prescriptions', ['appointment_id'], {
      name: 'appointment_prescriptions_appointment_idx',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('appointment_prescriptions');
    await queryInterface.changeColumn('appointments', 'payment_screenshot_url', {
      type: Sequelize.STRING,
      allowNull: false,
    });
    await queryInterface.removeColumn('appointments', 'payment_method');
    await queryInterface.removeColumn('appointments', 'patient_age');
    await queryInterface.removeColumn('appointments', 'patient_gender');
  },
};
