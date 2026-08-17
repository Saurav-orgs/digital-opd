'use strict';

/**
 * Initial OPD schema (plan §4).
 * Enums are stored as VARCHAR (validated at the app layer) to keep migrations
 * simple and additive. The critical concurrency guard is a PARTIAL unique index
 * on appointments filtered to status = 'confirmed'.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, UUIDV4, STRING, TEXT, BOOLEAN, SMALLINT, DECIMAL, DATEONLY, TIME, DATE } =
      Sequelize;

    const timestamps = {
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    };

    // Needed for gen_random_uuid if ever used; UUIDV4 is generated app-side too.
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

    // ── roles ──────────────────────────────────────────
    await queryInterface.createTable('roles', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      name: { type: STRING, allowNull: false, unique: true },
      description: { type: STRING, allowNull: true },
      is_system: { type: BOOLEAN, allowNull: false, defaultValue: false },
      ...timestamps,
    });

    // ── permissions ────────────────────────────────────
    await queryInterface.createTable('permissions', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      module: { type: STRING, allowNull: false },
      action: { type: STRING, allowNull: false },
      ...timestamps,
    });
    await queryInterface.addIndex('permissions', ['module', 'action'], {
      unique: true,
      name: 'permissions_module_action_uq',
    });

    // ── role_permissions ───────────────────────────────
    await queryInterface.createTable('role_permissions', {
      role_id: {
        type: UUID,
        allowNull: false,
        references: { model: 'roles', key: 'id' },
        onDelete: 'CASCADE',
      },
      permission_id: {
        type: UUID,
        allowNull: false,
        references: { model: 'permissions', key: 'id' },
        onDelete: 'CASCADE',
      },
    });
    await queryInterface.addConstraint('role_permissions', {
      fields: ['role_id', 'permission_id'],
      type: 'primary key',
      name: 'role_permissions_pkey',
    });

    // ── doctors ────────────────────────────────────────
    await queryInterface.createTable('doctors', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      name: { type: STRING, allowNull: false },
      specialization: { type: STRING, allowNull: true },
      qualifications: { type: STRING, allowNull: true },
      profile_photo_url: { type: STRING, allowNull: true },
      bio: { type: TEXT, allowNull: true },
      consultation_fee: { type: DECIMAL(10, 2), allowNull: true },
      payment_qr_url: { type: STRING, allowNull: true },
      public_slug: { type: STRING, allowNull: false, unique: true },
      is_enabled: { type: BOOLEAN, allowNull: false, defaultValue: false },
      ...timestamps,
      deleted_at: { type: DATE, allowNull: true },
    });

    // ── users ──────────────────────────────────────────
    await queryInterface.createTable('users', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      name: { type: STRING, allowNull: false },
      email: { type: STRING, allowNull: false, unique: true },
      password_hash: { type: STRING, allowNull: false },
      type: { type: STRING, allowNull: false },
      role_id: {
        type: UUID,
        allowNull: true,
        references: { model: 'roles', key: 'id' },
        onDelete: 'SET NULL',
      },
      doctor_id: {
        type: UUID,
        allowNull: true,
        references: { model: 'doctors', key: 'id' },
        onDelete: 'SET NULL',
      },
      is_active: { type: BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps,
      deleted_at: { type: DATE, allowNull: true },
    });

    // ── opd_schedules (multiple rows per weekday allowed) ──
    await queryInterface.createTable('opd_schedules', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      doctor_id: {
        type: UUID,
        allowNull: false,
        references: { model: 'doctors', key: 'id' },
        onDelete: 'CASCADE',
      },
      day_of_week: { type: SMALLINT, allowNull: false },
      start_time: { type: TIME, allowNull: false },
      end_time: { type: TIME, allowNull: false },
      slot_duration_min: { type: SMALLINT, allowNull: false },
      is_active: { type: BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps,
    });
    // NOTE: intentionally NO unique on (doctor_id, day_of_week) — split sessions.
    await queryInterface.addIndex('opd_schedules', ['doctor_id', 'day_of_week'], {
      name: 'opd_schedules_doctor_day_idx',
    });

    // ── schedule_exceptions ────────────────────────────
    await queryInterface.createTable('schedule_exceptions', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      doctor_id: {
        type: UUID,
        allowNull: false,
        references: { model: 'doctors', key: 'id' },
        onDelete: 'CASCADE',
      },
      date: { type: DATEONLY, allowNull: false },
      type: { type: STRING, allowNull: false },
      start_time: { type: TIME, allowNull: true },
      end_time: { type: TIME, allowNull: true },
      slot_duration_min: { type: SMALLINT, allowNull: true },
      reason: { type: STRING, allowNull: true },
      ...timestamps,
    });
    await queryInterface.addIndex('schedule_exceptions', ['doctor_id', 'date'], {
      unique: true,
      name: 'schedule_exceptions_doctor_date_uq',
    });

    // ── appointments ───────────────────────────────────
    await queryInterface.createTable('appointments', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      doctor_id: {
        type: UUID,
        allowNull: false,
        references: { model: 'doctors', key: 'id' },
        onDelete: 'CASCADE',
      },
      appointment_date: { type: DATEONLY, allowNull: false },
      start_time: { type: TIME, allowNull: false },
      end_time: { type: TIME, allowNull: false },
      patient_name: { type: STRING, allowNull: false },
      patient_mobile: { type: STRING, allowNull: false },
      patient_address: { type: TEXT, allowNull: true },
      description: { type: TEXT, allowNull: true },
      payment_screenshot_url: { type: STRING, allowNull: false },
      status: { type: STRING, allowNull: false, defaultValue: 'confirmed' },
      consultation_status: { type: STRING, allowNull: false, defaultValue: 'pending' },
      payment_status: { type: STRING, allowNull: false, defaultValue: 'paid_unverified' },
      source: { type: STRING, allowNull: false },
      ...timestamps,
    });
    await queryInterface.addIndex('appointments', ['patient_mobile'], {
      name: 'appointments_patient_mobile_idx',
    });
    await queryInterface.addIndex('appointments', ['doctor_id', 'appointment_date'], {
      name: 'appointments_doctor_date_idx',
    });

    // CONCURRENCY GUARD: a slot can only hold one confirmed appointment.
    // Partial unique index → rejected rows drop out, freeing the slot.
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX appointments_confirmed_slot_uq
      ON appointments (doctor_id, appointment_date, start_time)
      WHERE status = 'confirmed';
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('appointments');
    await queryInterface.dropTable('schedule_exceptions');
    await queryInterface.dropTable('opd_schedules');
    await queryInterface.dropTable('users');
    await queryInterface.dropTable('doctors');
    await queryInterface.dropTable('role_permissions');
    await queryInterface.dropTable('permissions');
    await queryInterface.dropTable('roles');
  },
};
