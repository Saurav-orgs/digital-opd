'use strict';

/**
 * The eight built-in prescription templates, as the design's prototype defines
 * them (`doctor-panel.html`, the `library` array).
 *
 * Owned by nobody (`doctor_id IS NULL`), so every clinic sees them. A doctor
 * who edits one gets their own overriding row; these are never mutated, which
 * is why re-running this seeder cannot undo anyone's edit.
 *
 * `duration_days` is the parsed number and `duration_text` the words as
 * written — "3 months" is both 90 and "3 months", while "Continue" is only
 * words. The numbers here are written out rather than parsed, because a seeder
 * re-implementing the client's `lib/duration.ts` is how the two start
 * disagreeing.
 *
 * Nothing here is clinical guidance from us. They are the starting points the
 * design shipped with, and every one of them is editable by the doctor before
 * it reaches a patient.
 */

const TEMPLATES = [
  {
    category: 'Fever',
    name: 'Viral fever — adult',
    advice: 'Plenty of fluids, rest. Review if fever persists beyond 3 days.',
    follow_up_days: 3,
    medicines: [
      { medicine_name: 'Paracetamol', strength: '650 mg', dosage: '1-1-1', duration_days: 3, duration_text: '3 days', instructions: 'After food' },
      { medicine_name: 'Cetirizine', strength: '10 mg', dosage: '0-0-1', duration_days: 5, duration_text: '5 days', instructions: null },
    ],
  },
  {
    category: 'Fever',
    name: 'Fever with body ache',
    advice: 'Tepid sponging for high fever. Return if rash or breathlessness.',
    follow_up_days: 3,
    medicines: [
      { medicine_name: 'Paracetamol', strength: '500 mg', dosage: '1-1-1', duration_days: 5, duration_text: '5 days', instructions: 'After food' },
      { medicine_name: 'Sulfamethoxazole-Trimethoprim', strength: '800/160 mg', dosage: '1-0-1', duration_days: 5, duration_text: '5 days', instructions: 'Only if bacterial' },
      { medicine_name: 'ORS', strength: '1 sachet', dosage: 'As needed', duration_days: 3, duration_text: '3 days', instructions: 'In 1 L water' },
    ],
  },
  {
    category: 'Cold & cough',
    name: 'Common cold',
    advice: 'Steam inhalation twice daily. Warm fluids.',
    follow_up_days: 7,
    medicines: [
      { medicine_name: 'Cetirizine', strength: '10 mg', dosage: '0-0-1', duration_days: 5, duration_text: '5 days', instructions: null },
      { medicine_name: 'Dextromethorphan syrup', strength: '10 ml', dosage: '1-1-1', duration_days: 5, duration_text: '5 days', instructions: 'Dry cough only' },
    ],
  },
  {
    category: 'Gastro',
    name: 'Acute gastroenteritis',
    advice: 'Light diet — khichdi, curd rice. Avoid milk and oily food.',
    follow_up_days: 3,
    medicines: [
      { medicine_name: 'ORS', strength: '1 sachet', dosage: 'After each loose stool', duration_days: 3, duration_text: '3 days', instructions: null },
      { medicine_name: 'Ondansetron', strength: '4 mg', dosage: '1-0-1', duration_days: 2, duration_text: '2 days', instructions: 'If vomiting' },
      { medicine_name: 'Zinc', strength: '20 mg', dosage: '1-0-0', duration_days: 10, duration_text: '10 days', instructions: null },
    ],
  },
  {
    category: "Women's health",
    name: 'PCOS — first line',
    advice: 'Low-GI diet, 30 min daily activity. Weight and cycle diary.',
    follow_up_days: 30,
    medicines: [
      { medicine_name: 'Metformin', strength: '500 mg', dosage: '1-0-1', duration_days: 90, duration_text: '3 months', instructions: 'With meals' },
      { medicine_name: 'Myo-inositol', strength: '2 g', dosage: '1-0-1', duration_days: 90, duration_text: '3 months', instructions: null },
    ],
  },
  {
    category: 'IVF',
    name: 'Ovarian stimulation — day 2',
    advice: 'Follicular scan on day 6. Avoid strenuous activity.',
    follow_up_days: 7,
    medicines: [
      { medicine_name: 'Recombinant FSH', strength: '225 IU', dosage: '0-0-1', duration_days: 5, duration_text: '5 days', instructions: 'SC, same time daily' },
      // The reason `duration_text` exists: no number to store.
      { medicine_name: 'Folic acid', strength: '5 mg', dosage: '1-0-0', duration_days: null, duration_text: 'Continue', instructions: null },
    ],
  },
  {
    category: 'Chronic',
    name: 'Hypertension — maintenance',
    advice: 'Salt under 5 g/day. Home BP log twice a week.',
    follow_up_days: 30,
    medicines: [
      { medicine_name: 'Amlodipine', strength: '5 mg', dosage: '1-0-0', duration_days: 30, duration_text: '30 days', instructions: 'Morning' },
    ],
  },
  {
    category: 'Chronic',
    name: 'Type 2 diabetes — maintenance',
    advice: 'HbA1c every 3 months. Foot check daily.',
    follow_up_days: 30,
    medicines: [
      { medicine_name: 'Metformin', strength: '500 mg', dosage: '1-0-1', duration_days: 30, duration_text: '30 days', instructions: 'With meals' },
    ],
  },
];

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;

    for (const tpl of TEMPLATES) {
      // Idempotent on name, among the shared rows only. Re-running adds what
      // is missing and leaves everything else — including a doctor's override
      // of one of these — exactly as it was.
      const [existing] = await sequelize.query(
        `SELECT id FROM prescription_templates
          WHERE doctor_id IS NULL AND name = :name AND deleted_at IS NULL
          LIMIT 1`,
        { replacements: { name: tpl.name }, type: sequelize.QueryTypes.SELECT },
      );
      if (existing) continue;

      const [inserted] = await sequelize.query(
        `INSERT INTO prescription_templates
           (id, doctor_id, builtin_source_id, category, name, advice,
            follow_up_days, is_builtin, created_at, updated_at)
         VALUES
           (gen_random_uuid(), NULL, NULL, :category, :name, :advice,
            :follow_up_days, true, now(), now())
         RETURNING id`,
        {
          replacements: {
            category: tpl.category,
            name: tpl.name,
            advice: tpl.advice,
            follow_up_days: tpl.follow_up_days,
          },
          type: sequelize.QueryTypes.INSERT,
        },
      );

      const templateId = inserted[0].id;
      let position = 0;
      for (const med of tpl.medicines) {
        await sequelize.query(
          `INSERT INTO prescription_template_medicines
             (id, template_id, position, medicine_name, strength, form,
              dosage, duration_days, duration_text, instructions,
              created_at, updated_at)
           VALUES
             (gen_random_uuid(), :template_id, :position, :medicine_name,
              :strength, NULL, :dosage, :duration_days, :duration_text,
              :instructions, now(), now())`,
          {
            replacements: {
              template_id: templateId,
              position: position++,
              medicine_name: med.medicine_name,
              strength: med.strength,
              dosage: med.dosage,
              duration_days: med.duration_days,
              duration_text: med.duration_text,
              instructions: med.instructions,
            },
          },
        );
      }
    }
  },

  async down(queryInterface) {
    // Only the shared rows this seeder could have created. A doctor's own
    // templates, and their overrides of these, are their work and are left
    // alone — the override's cascade would take them with it otherwise, so
    // the overrides are detached first.
    const names = TEMPLATES.map((t) => t.name);
    await queryInterface.sequelize.query(
      `UPDATE prescription_templates SET builtin_source_id = NULL
        WHERE builtin_source_id IN (
              SELECT id FROM prescription_templates
               WHERE doctor_id IS NULL AND name = ANY(ARRAY[:names]::text[])
        )`,
      { replacements: { names } },
    );
    await queryInterface.sequelize.query(
      `DELETE FROM prescription_templates
            WHERE doctor_id IS NULL AND name = ANY(ARRAY[:names]::text[])`,
      { replacements: { names } },
    );
  },
};
