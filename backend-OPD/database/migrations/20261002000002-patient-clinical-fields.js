'use strict';

/**
 * A patient profile gains a clinical summary the clinic maintains by hand, and
 * a marker for the clinic that registered it.
 *
 * `blood_group`, `conditions` and `long_term_medicines` are the desk's own
 * notes on a patient — what the profile screen's "Clinical summary" card shows
 * and the new-patient form captures. They are deliberately separate from the
 * conditions the overview endpoint *derives* from issued prescriptions: that
 * derived list is a read of what was diagnosed, this is what a human recorded.
 * Both have their place; the derived one cannot be edited and the recorded one
 * is not inferred.
 *
 * `conditions` and `long_term_medicines` are JSONB arrays of plain strings —
 * the same shape the UI holds them in, so there is no join to maintain for
 * something only ever read and written whole. JSONB rather than a Postgres
 * text[] to match `patient_reports.ai_summary` and the appointment summary
 * columns, which are the house style for "a small list the app owns".
 *
 * `registered_by_doctor_id` records the clinic that created a profile from its
 * own desk. The clinic patient list is otherwise scoped by appointment — you
 * are a clinic's patient because you were *seen* there — and a patient the desk
 * registers has not been seen yet, so without this column a freshly registered
 * patient would vanish from the list until their first visit. It is nullable:
 * a profile created by public booking or the patient app has no clinic behind
 * it, only the account.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { STRING, JSONB, UUID } = Sequelize;
    const table = await queryInterface.describeTable('patient_profiles');

    if (!table.blood_group) {
      await queryInterface.addColumn('patient_profiles', 'blood_group', {
        type: STRING(8),
        allowNull: true,
      });
    }
    if (!table.conditions) {
      await queryInterface.addColumn('patient_profiles', 'conditions', {
        type: JSONB,
        allowNull: false,
        defaultValue: [],
      });
    }
    if (!table.long_term_medicines) {
      await queryInterface.addColumn('patient_profiles', 'long_term_medicines', {
        type: JSONB,
        allowNull: false,
        defaultValue: [],
      });
    }
    if (!table.registered_by_doctor_id) {
      await queryInterface.addColumn('patient_profiles', 'registered_by_doctor_id', {
        type: UUID,
        allowNull: true,
      });
      // The list query filters on it for every clinic patient page load.
      await queryInterface.addIndex('patient_profiles', ['registered_by_doctor_id'], {
        name: 'patient_profiles_registered_by_idx',
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('patient_profiles');
    if (table.registered_by_doctor_id) {
      await queryInterface.removeIndex(
        'patient_profiles',
        'patient_profiles_registered_by_idx',
      );
      await queryInterface.removeColumn('patient_profiles', 'registered_by_doctor_id');
    }
    if (table.long_term_medicines) {
      await queryInterface.removeColumn('patient_profiles', 'long_term_medicines');
    }
    if (table.conditions) {
      await queryInterface.removeColumn('patient_profiles', 'conditions');
    }
    if (table.blood_group) {
      await queryInterface.removeColumn('patient_profiles', 'blood_group');
    }
  },
};
