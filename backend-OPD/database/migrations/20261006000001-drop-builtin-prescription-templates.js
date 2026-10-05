'use strict';

/**
 * The eight shipped prescription templates go. Templates are now only what a
 * doctor wrote: "no pre-added templates" was the instruction, and the
 * Pre-added tab went with them.
 *
 * Order matters here. A doctor who edited a built-in has their own row
 * carrying `builtin_source_id`, and that column is `ON DELETE CASCADE` — so
 * deleting the built-ins first would take those edited copies with them, which
 * is exactly the work worth keeping. They are cut loose first and become
 * ordinary templates of the doctor's own.
 *
 * The `is_builtin` / `builtin_source_id` columns are left in place. Nothing
 * writes them any more and the service no longer reads them; dropping them is
 * a separate change with nothing to gain here.
 *
 * Not reversible: the seeder that produced these rows is deleted in the same
 * commit, so there is nothing left to put back. `down` is deliberately a no-op
 * rather than a lie.
 */
module.exports = {
  async up(queryInterface) {
    // 1. A doctor's edited copy of a built-in becomes their own template.
    await queryInterface.sequelize.query(`
      UPDATE prescription_templates
         SET builtin_source_id = NULL,
             is_builtin = false
       WHERE builtin_source_id IS NOT NULL
    `);

    // 2. The shipped rows themselves — owned by nobody — are removed. Their
    //    medicines go with them (prescription_template_medicines cascades).
    await queryInterface.sequelize.query(`
      DELETE FROM prescription_templates
       WHERE doctor_id IS NULL
    `);
  },

  async down() {
    // Nothing to restore — see the note above.
  },
};
