'use strict';

/**
 * Patient portal foundation:
 *  - `patients` — phone-only login identity (mobile is the unique key).
 *  - `patient_reports` — pathlab-uploaded report files, keyed by patient mobile.
 *  - `notifications` — in-app notifications for a patient (reports, reminders).
 *  - `appointments` gains `next_visit_note` / `next_visit_date` — the doctor's
 *    reminder for the patient's next OPD, set from the visit itself.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, UUIDV4, STRING, TEXT, DATE, DATEONLY, JSONB } = Sequelize;

    await queryInterface.createTable('patients', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      mobile: { type: STRING, allowNull: false, unique: true },
      name: { type: STRING, allowNull: false },
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    });

    await queryInterface.createTable('patient_reports', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      patient_mobile: { type: STRING, allowNull: false },
      title: { type: STRING, allowNull: false },
      file_key: { type: STRING, allowNull: false },
      uploaded_by_user_id: {
        type: UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      appointment_id: {
        type: UUID,
        allowNull: true,
        references: { model: 'appointments', key: 'id' },
        onDelete: 'SET NULL',
      },
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    });
    await queryInterface.addIndex('patient_reports', ['patient_mobile'], {
      name: 'patient_reports_mobile_idx',
    });

    await queryInterface.createTable('notifications', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      patient_mobile: { type: STRING, allowNull: false },
      type: { type: STRING, allowNull: false },
      title: { type: STRING, allowNull: false },
      body: { type: TEXT, allowNull: true },
      data: { type: JSONB, allowNull: true },
      read_at: { type: DATE, allowNull: true },
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    });
    await queryInterface.addIndex('notifications', ['patient_mobile'], {
      name: 'notifications_mobile_idx',
    });

    await queryInterface.addColumn('appointments', 'next_visit_note', {
      type: TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('appointments', 'next_visit_date', {
      type: DATEONLY,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('appointments', 'next_visit_date');
    await queryInterface.removeColumn('appointments', 'next_visit_note');
    await queryInterface.dropTable('notifications');
    await queryInterface.dropTable('patient_reports');
    await queryInterface.dropTable('patients');
  },
};
