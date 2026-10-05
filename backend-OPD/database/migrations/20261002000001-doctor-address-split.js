'use strict';

/**
 * The clinic address becomes structured, and the doctor gains a medical
 * council.
 *
 * `clinic_address` is one free-text column today. The onboarding wizard asks
 * for line 1, line 2, city, PIN, state and country as separate fields — a PIN
 * code buried in a paragraph cannot be validated, and the letterhead has to
 * guess where to break the lines.
 *
 * **`clinic_address` is not migrated or re-parsed.** It becomes line 1 exactly
 * as it stands. Splitting a free-text Indian address with a regex gets it
 * wrong often enough that the wrong answer would be printed on a doctor's
 * letterhead, which is worse than a long line 1. A doctor who opens the new
 * form fills the rest in; one who never does keeps precisely what they had,
 * because the renderer joins whatever is non-null.
 *
 * `medical_council` is new — the body a registration number belongs to. A
 * registration number without its council does not identify a doctor, since
 * each state council numbers independently.
 *
 * Qualifications stay a comma-joined string. The wizard's chips are a UI over
 * that column; a table for something nothing queries would be a join to
 * maintain for no reader.
 */
const COLUMNS = {
  medical_council: { type: 'STRING', length: 120 },
  clinic_address_line2: { type: 'STRING', length: 255 },
  clinic_city: { type: 'STRING', length: 80 },
  clinic_pincode: { type: 'STRING', length: 10 },
  clinic_state: { type: 'STRING', length: 80 },
  clinic_country: { type: 'STRING', length: 80, defaultValue: 'India' },
};

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('doctors');
    for (const [name, spec] of Object.entries(COLUMNS)) {
      // Idempotent: re-running must not fail on a column already added.
      if (table[name]) continue;
      await queryInterface.addColumn('doctors', name, {
        type: Sequelize[spec.type](spec.length),
        allowNull: true,
        ...(spec.defaultValue ? { defaultValue: spec.defaultValue } : {}),
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('doctors');
    for (const name of Object.keys(COLUMNS).reverse()) {
      if (!table[name]) continue;
      await queryInterface.removeColumn('doctors', name);
    }
    // `clinic_address` is untouched in both directions — it never stopped
    // being line 1, so there is nothing to put back.
  },
};
