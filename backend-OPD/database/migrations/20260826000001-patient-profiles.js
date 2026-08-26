'use strict';

/**
 * Family patients: one mobile number owns many patients.
 *
 * Until now a patient *was* a mobile number — `patients.mobile` was unique and
 * every clinical row was keyed by `patient_mobile`. That made a man and his
 * wife booking from the same phone one indistinguishable record.
 *
 * `patients` becomes a thin account row (the number) and `patient_profiles`
 * holds the actual people. Identity is the profile id — never the name, so two
 * patients on one number may legitimately share a name. Selection at booking is
 * explicit: pick an existing patient, or fill the form and get a new one.
 *
 * Also here, because they touch the same tables:
 *  - structured address (city / state / pincode) alongside the existing
 *    free-text `patient_address`, which becomes the address line;
 *  - `progress_summary` — the combined summary carried across visits;
 *  - `cancelled` bookings, so a wrong booking can be undone.
 *
 * The system is not live: the backfill below reconstructs profiles from the
 * dummy data by name, and drops report rows it cannot attribute rather than
 * guessing which family member they belonged to.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, UUIDV4, STRING, TEXT, DATE, DATEONLY, INTEGER, JSONB } =
      Sequelize;

    await queryInterface.createTable('patient_profiles', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      // Human-visible id. Two patients on one number may share a name, so the
      // doctor and front desk need something to tell them apart on screen.
      patient_code: { type: STRING, allowNull: false, unique: true },
      patient_id: {
        type: UUID,
        allowNull: false,
        references: { model: 'patients', key: 'id' },
        onDelete: 'CASCADE',
      },
      // Deliberately NOT unique per account — see the file header.
      name: { type: STRING, allowNull: false },
      // A label for the booking UI only; carries no privilege.
      relation: { type: STRING, allowNull: true },
      gender: { type: STRING, allowNull: true },
      dob: { type: DATEONLY, allowNull: true },
      address_line: { type: TEXT, allowNull: true },
      city: { type: STRING, allowNull: true },
      state: { type: STRING, allowNull: true },
      pincode: { type: STRING(6), allowNull: true },
      archived_at: { type: DATE, allowNull: true },
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    });
    await queryInterface.addIndex('patient_profiles', ['patient_id'], {
      name: 'patient_profiles_patient_idx',
    });

    // The name now lives on the profile; the account row is just the number.
    await queryInterface.changeColumn('patients', 'name', {
      type: STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('appointments', 'patient_profile_id', {
      type: UUID,
      allowNull: true,
      references: { model: 'patient_profiles', key: 'id' },
      onDelete: 'SET NULL',
    });
    // Every history/summary lookup is "this patient's visits, newest first".
    await queryInterface.addIndex(
      'appointments',
      ['patient_profile_id', 'appointment_date'],
      { name: 'appointments_profile_date_idx' },
    );

    await queryInterface.addColumn('patient_reports', 'patient_profile_id', {
      type: UUID,
      allowNull: true,
      references: { model: 'patient_profiles', key: 'id' },
      onDelete: 'SET NULL',
    });
    await queryInterface.addIndex('patient_reports', ['patient_profile_id'], {
      name: 'patient_reports_profile_idx',
    });

    await queryInterface.addColumn('notifications', 'patient_profile_id', {
      type: UUID,
      allowNull: true,
      references: { model: 'patient_profiles', key: 'id' },
      onDelete: 'SET NULL',
    });
    await queryInterface.addIndex('notifications', ['patient_profile_id'], {
      name: 'notifications_profile_idx',
    });

    // ── Structured address ──────────────────────────────────
    // `patient_address` stays as the address line, so nothing needs moving.
    await queryInterface.addColumn('appointments', 'patient_city', {
      type: STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('appointments', 'patient_state', {
      type: STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('appointments', 'patient_pincode', {
      type: STRING(6),
      allowNull: true,
    });

    // ── Combined summary carried across visits ──────────────
    // Built from the previous visit's summary + this visit's reports. Null
    // status means there was no earlier visit to compare against.
    await queryInterface.addColumn('appointments', 'progress_summary', {
      type: JSONB,
      allowNull: true,
    });
    await queryInterface.addColumn('appointments', 'progress_summary_status', {
      type: STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('appointments', 'progress_summary_error', {
      type: TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn(
      'appointments',
      'progress_summary_visit_count',
      { type: INTEGER, allowNull: false, defaultValue: 0 },
    );
    await queryInterface.addColumn('appointments', 'progress_summarized_at', {
      type: DATE,
      allowNull: true,
    });

    // ── Backfill ────────────────────────────────────────────
    // Accounts for any mobile that only ever appeared on a booking or report.
    await queryInterface.sequelize.query(`
      INSERT INTO patients (id, mobile, name, created_at, updated_at)
      SELECT gen_random_uuid(), m.mobile, NULL, now(), now()
      FROM (
        SELECT DISTINCT patient_mobile AS mobile FROM appointments
        UNION
        SELECT DISTINCT patient_mobile AS mobile FROM patient_reports
      ) m
      WHERE NOT EXISTS (SELECT 1 FROM patients p WHERE p.mobile = m.mobile);
    `);

    // One profile per distinct name on each account. The name is used here,
    // once, to reconstruct history — never again at runtime.
    await queryInterface.sequelize.query(`
      INSERT INTO patient_profiles
        (id, patient_code, patient_id, name, gender, address_line,
         created_at, updated_at)
      SELECT
        gen_random_uuid(),
        'PT-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)),
        p.id,
        g.name,
        g.gender,
        g.address_line,
        now(),
        now()
      FROM (
        SELECT DISTINCT ON (a.patient_mobile, lower(trim(a.patient_name)))
          a.patient_mobile,
          trim(a.patient_name)  AS name,
          a.patient_gender      AS gender,
          a.patient_address     AS address_line
        FROM appointments a
        ORDER BY a.patient_mobile,
                 lower(trim(a.patient_name)),
                 a.appointment_date DESC, a.start_time DESC
      ) g
      JOIN patients p ON p.mobile = g.patient_mobile;
    `);

    // Existing patients rows carried a name; give the ones with no booking a
    // profile too, so a registered-but-never-booked account isn't left empty.
    await queryInterface.sequelize.query(`
      INSERT INTO patient_profiles
        (id, patient_code, patient_id, name, created_at, updated_at)
      SELECT
        gen_random_uuid(),
        'PT-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)),
        p.id,
        p.name,
        now(),
        now()
      FROM patients p
      WHERE p.name IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM patient_profiles pp WHERE pp.patient_id = p.id
        );
    `);

    await queryInterface.sequelize.query(`
      UPDATE appointments a
      SET patient_profile_id = pp.id
      FROM patient_profiles pp
      JOIN patients p ON p.id = pp.patient_id
      WHERE p.mobile = a.patient_mobile
        AND lower(trim(pp.name)) = lower(trim(a.patient_name));
    `);

    // A report attached to a visit inherits that visit's patient.
    await queryInterface.sequelize.query(`
      UPDATE patient_reports r
      SET patient_profile_id = a.patient_profile_id
      FROM appointments a
      WHERE a.id = r.appointment_id
        AND a.patient_profile_id IS NOT NULL;
    `);

    // Reports keyed only by mobile cannot be attributed to a family member.
    // Attaching them to the wrong person is worse than losing dummy test data,
    // and there is no production data here to preserve.
    await queryInterface.sequelize.query(`
      DELETE FROM patient_reports WHERE patient_profile_id IS NULL;
    `);
    await queryInterface.sequelize.query(`
      DELETE FROM notifications WHERE patient_mobile NOT IN (
        SELECT mobile FROM patients
      );
    `);
    await queryInterface.sequelize.query(`
      UPDATE notifications n
      SET patient_profile_id = sub.profile_id
      FROM (
        SELECT DISTINCT ON (pp.patient_id) pp.patient_id, pp.id AS profile_id, p.mobile
        FROM patient_profiles pp
        JOIN patients p ON p.id = pp.patient_id
        ORDER BY pp.patient_id, pp.created_at ASC
      ) sub
      WHERE sub.mobile = n.patient_mobile;
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('appointments', 'progress_summarized_at');
    await queryInterface.removeColumn(
      'appointments',
      'progress_summary_visit_count',
    );
    await queryInterface.removeColumn('appointments', 'progress_summary_error');
    await queryInterface.removeColumn('appointments', 'progress_summary_status');
    await queryInterface.removeColumn('appointments', 'progress_summary');
    await queryInterface.removeColumn('appointments', 'patient_pincode');
    await queryInterface.removeColumn('appointments', 'patient_state');
    await queryInterface.removeColumn('appointments', 'patient_city');

    await queryInterface.removeIndex('notifications', 'notifications_profile_idx');
    await queryInterface.removeColumn('notifications', 'patient_profile_id');
    await queryInterface.removeIndex(
      'patient_reports',
      'patient_reports_profile_idx',
    );
    await queryInterface.removeColumn('patient_reports', 'patient_profile_id');
    await queryInterface.removeIndex(
      'appointments',
      'appointments_profile_date_idx',
    );
    await queryInterface.removeColumn('appointments', 'patient_profile_id');

    // Names moved onto the profiles, so anything left null must be filled
    // before the column can be NOT NULL again.
    await queryInterface.sequelize.query(
      `UPDATE patients SET name = 'Unknown' WHERE name IS NULL;`,
    );
    await queryInterface.changeColumn('patients', 'name', {
      type: Sequelize.STRING,
      allowNull: false,
    });

    await queryInterface.removeIndex(
      'patient_profiles',
      'patient_profiles_patient_idx',
    );
    await queryInterface.dropTable('patient_profiles');
  },
};
