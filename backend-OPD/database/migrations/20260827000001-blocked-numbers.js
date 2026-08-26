'use strict';

/**
 * Numbers a doctor has blocked from booking.
 *
 * Booking is open to the public — a number, a name and a slot is all it takes —
 * so a single nuisance caller can fill a clinic's day with bookings nobody
 * turns up for. This gives the doctor a way to shut that down without involving
 * the platform.
 *
 * Scoped per doctor, deliberately: a number that spams one clinic is not
 * necessarily abusing another, and one tenant should not be able to lock a
 * patient out of the whole platform.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, UUIDV4, STRING, TEXT, DATE } = Sequelize;

    await queryInterface.createTable('blocked_numbers', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      doctor_id: {
        type: UUID,
        allowNull: false,
        references: { model: 'doctors', key: 'id' },
        onDelete: 'CASCADE',
      },
      mobile: { type: STRING(10), allowNull: false },
      /** Why it was blocked — shown back to the doctor in the list. */
      reason: { type: TEXT, allowNull: true },
      blocked_by_user_id: {
        type: UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    });

    // The booking path checks this on every attempt, and blocking the same
    // number twice for one doctor is meaningless.
    await queryInterface.addConstraint('blocked_numbers', {
      fields: ['doctor_id', 'mobile'],
      type: 'unique',
      name: 'blocked_numbers_doctor_mobile_uniq',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeConstraint(
      'blocked_numbers',
      'blocked_numbers_doctor_mobile_uniq',
    );
    await queryInterface.dropTable('blocked_numbers');
  },
};
