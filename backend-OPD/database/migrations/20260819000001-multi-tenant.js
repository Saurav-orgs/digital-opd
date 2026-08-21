'use strict';

/**
 * Multi-tenant foundation.
 *
 * Adds doctor_id (tenant key) to every table that holds per-doctor clinical
 * data, replacing the earlier implicit assumption that there is exactly one
 * doctor in the system.  All existing rows are backfilled to the first (and,
 * at this point, only) doctor that exists in the database.
 *
 * Tables touched:
 *   roles              — add doctor_id (null = global/system role);
 *                        replace the global unique-name constraint with two
 *                        partial indexes so tenants can reuse names like
 *                        "Doctor" without colliding.
 *   medicine_catalog   — add doctor_id; replace unique(name) with
 *                        unique(doctor_id, name).
 *   patient_reports    — add doctor_id.
 *   notifications      — add doctor_id.
 *   ai_training_samples — add doctor_id (derives from the linked appointment).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, DATE } = Sequelize;

    // ── helpers ─────────────────────────────────────────────────
    const doctorFk = {
      type: UUID,
      allowNull: true,
      references: { model: 'doctors', key: 'id' },
      onDelete: 'SET NULL',
    };

    // The first doctor to exist is the current single-tenant doctor.  Every
    // existing row gets backfilled to them.  If the DB is brand new (no
    // doctors yet) this is a no-op — no rows to backfill.
    const [[firstDoctor]] = await queryInterface.sequelize.query(
      `SELECT id FROM doctors ORDER BY created_at ASC LIMIT 1`,
    );
    const firstDoctorId = firstDoctor ? firstDoctor.id : null;

    // ── roles ────────────────────────────────────────────────────
    await queryInterface.addColumn('roles', 'doctor_id', doctorFk);

    // Drop the existing global unique constraint on roles.name so tenants
    // can each have a role called "Doctor" without colliding.
    // The constraint name PostgreSQL gives an inline `unique: true` is the
    // table name + "_" + column name + "_key".
    await queryInterface.removeConstraint('roles', 'roles_name_key');

    // Partial unique: global roles (doctor_id IS NULL) — name still unique
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX roles_global_name_uq
      ON roles (name)
      WHERE doctor_id IS NULL;
    `);
    // Partial unique: per-tenant roles — unique within each tenant
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX roles_tenant_name_uq
      ON roles (doctor_id, name)
      WHERE doctor_id IS NOT NULL;
    `);

    if (firstDoctorId) {
      // Global/system roles stay at doctor_id = NULL.  No backfill needed for
      // roles because the system roles (SuperAdmin, Pathlab) should remain
      // global, and there are no tenant roles yet.
    }

    // ── medicine_catalog ─────────────────────────────────────────
    await queryInterface.addColumn('medicine_catalog', 'doctor_id', doctorFk);

    // Replace unique(name) with unique(doctor_id, name).
    await queryInterface.removeIndex('medicine_catalog', 'medicine_catalog_name_uniq');
    await queryInterface.addIndex('medicine_catalog', ['doctor_id', 'name'], {
      name: 'medicine_catalog_doctor_name_uniq',
      unique: true,
    });

    if (firstDoctorId) {
      await queryInterface.sequelize.query(
        `UPDATE medicine_catalog SET doctor_id = :id WHERE doctor_id IS NULL`,
        { replacements: { id: firstDoctorId } },
      );
    }

    // ── patient_reports ──────────────────────────────────────────
    await queryInterface.addColumn('patient_reports', 'doctor_id', doctorFk);
    if (firstDoctorId) {
      await queryInterface.sequelize.query(
        `UPDATE patient_reports SET doctor_id = :id WHERE doctor_id IS NULL`,
        { replacements: { id: firstDoctorId } },
      );
    }

    // ── notifications ────────────────────────────────────────────
    await queryInterface.addColumn('notifications', 'doctor_id', doctorFk);
    if (firstDoctorId) {
      await queryInterface.sequelize.query(
        `UPDATE notifications SET doctor_id = :id WHERE doctor_id IS NULL`,
        { replacements: { id: firstDoctorId } },
      );
    }

    // ── ai_training_samples ──────────────────────────────────────
    await queryInterface.addColumn('ai_training_samples', 'doctor_id', doctorFk);
    if (firstDoctorId) {
      await queryInterface.sequelize.query(
        `UPDATE ai_training_samples SET doctor_id = :id WHERE doctor_id IS NULL`,
        { replacements: { id: firstDoctorId } },
      );
    }
  },

  async down(queryInterface) {
    // Restore roles unique constraint
    await queryInterface.removeIndex('roles', 'roles_tenant_name_uq');
    await queryInterface.removeIndex('roles', 'roles_global_name_uq');
    await queryInterface.addConstraint('roles', {
      fields: ['name'],
      type: 'unique',
      name: 'roles_name_key',
    });
    await queryInterface.removeColumn('roles', 'doctor_id');

    // Restore medicine_catalog unique constraint
    await queryInterface.removeIndex('medicine_catalog', 'medicine_catalog_doctor_name_uniq');
    await queryInterface.addIndex('medicine_catalog', ['name'], {
      name: 'medicine_catalog_name_uniq',
      unique: true,
    });
    await queryInterface.removeColumn('medicine_catalog', 'doctor_id');

    await queryInterface.removeColumn('patient_reports', 'doctor_id');
    await queryInterface.removeColumn('notifications', 'doctor_id');
    await queryInterface.removeColumn('ai_training_samples', 'doctor_id');
  },
};
