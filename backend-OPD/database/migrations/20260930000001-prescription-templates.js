'use strict';

/**
 * Prescription templates — a saved diagnosis-shaped prescription the doctor
 * applies to a visit and then adjusts.
 *
 *   prescription_templates — category + name + advice + follow-up.
 *     `doctor_id IS NULL` marks a built-in: shipped with the product, read by
 *     every tenant, owned by nobody. A doctor's own templates carry their id.
 *
 *     A built-in is "editable in place" in the UI, but editing one must not
 *     reach every other clinic, so the write lands as a per-doctor row
 *     carrying `builtin_source_id`. The list then shows the override in place
 *     of the row it shadows. This is the one place the schema is deliberately
 *     more conservative than the prototype, which is single-tenant and keeps
 *     its library in a JavaScript array.
 *
 *   prescription_template_medicines — the medicine rows, in order.
 *     The columns mirror `e_prescription_medicines`, so applying a template is
 *     a column-for-column copy and the two cannot drift apart.
 *
 *     With one deliberate exception: no `timing`. That column exists on
 *     `e_prescription_medicines` but `replaceMedicines` has hardcoded it to
 *     null since food timing moved into `instructions`, so mirroring it would
 *     add a column that can never survive a round-trip through apply. The
 *     prototype's per-medicine remark ("After food", "Only if bacterial") is
 *     `instructions`, which is where that information now lives.
 *
 * There is no CHECK constraint enforcing "at least one medicine or some
 * advice". The rule spans both tables, so it lives in the service next to the
 * sentence the doctor reads when they break it. Advice-only templates are
 * valid and common — a fertility or diet-and-rest template often has no drug
 * on it at all.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, UUIDV4, STRING, TEXT, SMALLINT, INTEGER, BOOLEAN, DATE } = Sequelize;

    await queryInterface.createTable('prescription_templates', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },

      /** NULL = built-in, shared by every tenant. */
      doctor_id: {
        type: UUID,
        allowNull: true,
        references: { model: 'doctors', key: 'id' },
        onDelete: 'CASCADE',
      },

      /** The row this one overrides, when a doctor edits a built-in. */
      builtin_source_id: {
        type: UUID,
        allowNull: true,
        references: { model: 'prescription_templates', key: 'id' },
        onDelete: 'CASCADE',
      },

      category: { type: STRING(80), allowNull: false },
      name: { type: STRING(160), allowNull: false },

      /** May be the whole template — see the note above about medicines. */
      advice: { type: TEXT, allowNull: true },

      /** 3 / 7 / 14 / 30. NULL = no follow-up asked for. */
      follow_up_days: { type: SMALLINT, allowNull: true },

      is_builtin: { type: BOOLEAN, allowNull: false, defaultValue: false },

      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      deleted_at: { type: DATE, allowNull: true },
    });

    // One name per doctor. Partial, so a soft-deleted template does not hold
    // its name hostage — a doctor who deletes "Dengue watch" and writes a new
    // one under the same name should not be told it already exists.
    //
    // The built-ins share `doctor_id IS NULL`, and Postgres treats NULLs as
    // distinct in a unique index, so this does not constrain them. Their
    // uniqueness is the seeder's job, which is idempotent on name.
    await queryInterface.addIndex('prescription_templates', ['doctor_id', 'name'], {
      unique: true,
      where: { deleted_at: null },
      name: 'prescription_templates_doctor_name_unique',
    });
    await queryInterface.addIndex('prescription_templates', ['doctor_id', 'category'], {
      name: 'prescription_templates_doctor_category_idx',
    });
    await queryInterface.addIndex('prescription_templates', ['builtin_source_id'], {
      name: 'prescription_templates_builtin_source_idx',
    });

    await queryInterface.createTable('prescription_template_medicines', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      template_id: {
        type: UUID,
        allowNull: false,
        references: { model: 'prescription_templates', key: 'id' },
        onDelete: 'CASCADE',
      },

      /** Display order, so the doctor's arrangement survives a reload. */
      position: { type: SMALLINT, allowNull: false, defaultValue: 0 },

      medicine_name: { type: STRING, allowNull: false },
      strength: { type: STRING, allowNull: true },
      form: { type: STRING, allowNull: true },

      /**
       * Morning-afternoon-night, e.g. "1-0-1" — but also "As needed" or
       * "After each loose stool", which is why it is free text and not a
       * pattern. A template is what the doctor would have written.
       */
      dosage: { type: STRING, allowNull: false },

      /**
       * The course length, stored twice on purpose.
       *
       * `duration_days` is what the prescription, the PDF and the catalogue
       * read. `duration_text` is what the doctor typed, kept because a
       * smallint cannot hold "Continue" — and a built-in fertility template
       * needs exactly that for folic acid. "3 months" fits (90) and is still
       * worth keeping in the doctor's own words; "Continue" has no number at
       * all and would otherwise be lost.
       *
       * The client parses with `lib/duration.ts` and sends both, so there is
       * one parser rather than a second copy here disagreeing with it.
       * Templates only — an issued prescription stays numeric.
       */
      duration_days: { type: SMALLINT, allowNull: true },
      duration_text: { type: STRING(40), allowNull: true },

      instructions: { type: TEXT, allowNull: true },

      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    });

    await queryInterface.addIndex('prescription_template_medicines', ['template_id'], {
      name: 'prescription_template_medicines_template_idx',
    });

    /**
     * How often *this clinic* has used a template.
     *
     * Its own table rather than a column on the template, because the eight
     * built-ins are single shared rows: a counter on one of those would add up
     * every clinic's use of it, and clinic A's prescribing habits would decide
     * what clinic B sees at the top of its menu. That is the same leak as
     * editing a built-in in place, which the override row exists to prevent.
     *
     * A doctor's own templates could have carried a plain column, but then the
     * number would mean two different things depending on which tab it came
     * from, and every read would have to know which.
     */
    await queryInterface.createTable('prescription_template_usage', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      doctor_id: {
        type: UUID,
        allowNull: false,
        references: { model: 'doctors', key: 'id' },
        onDelete: 'CASCADE',
      },
      template_id: {
        type: UUID,
        allowNull: false,
        references: { model: 'prescription_templates', key: 'id' },
        onDelete: 'CASCADE',
      },
      usage_count: { type: INTEGER, allowNull: false, defaultValue: 0 },
      last_used_at: { type: DATE, allowNull: true },
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    });

    // One row per clinic per template — the upsert in `apply` depends on it.
    await queryInterface.addIndex(
      'prescription_template_usage',
      ['doctor_id', 'template_id'],
      { unique: true, name: 'prescription_template_usage_unique' },
    );
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'prescription_template_usage',
      'prescription_template_usage_unique',
    );
    await queryInterface.dropTable('prescription_template_usage');
    await queryInterface.removeIndex(
      'prescription_template_medicines',
      'prescription_template_medicines_template_idx',
    );
    await queryInterface.dropTable('prescription_template_medicines');
    await queryInterface.removeIndex(
      'prescription_templates',
      'prescription_templates_builtin_source_idx',
    );
    await queryInterface.removeIndex(
      'prescription_templates',
      'prescription_templates_doctor_category_idx',
    );
    await queryInterface.removeIndex(
      'prescription_templates',
      'prescription_templates_doctor_name_unique',
    );
    await queryInterface.dropTable('prescription_templates');
  },
};
