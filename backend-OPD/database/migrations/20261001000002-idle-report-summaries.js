'use strict';

/**
 * Report summaries become the doctor's to ask for, so a third state exists:
 * summarisable, but nobody has asked.
 *
 * `patient_reports.ai_summary_status` has defaulted to `pending` since it was
 * added, because a summary was queued the instant a report was uploaded —
 * `pending` meant "coming shortly" and the UI spun a loader on it. Nothing is
 * queued any more, so every one of those rows would spin that loader forever
 * for work that is never going to run.
 *
 * `pending` and `processing` rows are both stranded, not in flight. The jobs
 * ran in-process, so the deploy that ships this kills anything still going;
 * there is nothing on the other side of the restart to finish them. A row
 * that genuinely was mid-flight and somehow completes afterwards simply
 * overwrites this with `ready`, which is the right answer either way.
 *
 * `ready` and `failed` are left exactly as they are: one has a summary worth
 * keeping, and the other has an error the doctor should still see with a
 * button to try again.
 *
 * The columns are plain STRINGs rather than Postgres enums, so the new value
 * needs no type change — this is data only.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    /*
     * The column default moves too. The model sets `idle` on create, so rows
     * the application writes are right either way — but the database default
     * is what a seeder, a backfill or a hand-written INSERT gets, and leaving
     * it at `pending` would quietly reintroduce the stranded state this
     * migration exists to clear.
     */
    await queryInterface.changeColumn('patient_reports', 'ai_summary_status', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'idle',
    });

    await queryInterface.sequelize.query(
      `UPDATE patient_reports
          SET ai_summary_status = 'idle',
              ai_summary_error = NULL
        WHERE ai_summary_status IN ('pending', 'processing')`,
    );

    /*
     * The appointment-level summaries follow. Their columns are nullable and
     * `null` already means something specific — "nothing to summarise", a
     * first visit with no earlier one to compare against — so a stranded
     * `pending` must not be nulled; it becomes `idle` like the rest.
     */
    await queryInterface.sequelize.query(
      `UPDATE appointments
          SET reports_summary_status = 'idle',
              reports_summary_error = NULL
        WHERE reports_summary_status IN ('pending', 'processing')`,
    );
    await queryInterface.sequelize.query(
      `UPDATE appointments
          SET progress_summary_status = 'idle',
              progress_summary_error = NULL
        WHERE progress_summary_status IN ('pending', 'processing')`,
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('patient_reports', 'ai_summary_status', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'pending',
    });
    // `idle` has no meaning in the old world, where anything not ready or
    // failed was queued. Putting these back to `pending` is what reverting
    // means: the old code would pick them up and summarise them.
    await queryInterface.sequelize.query(
      `UPDATE patient_reports SET ai_summary_status = 'pending' WHERE ai_summary_status = 'idle'`,
    );
    await queryInterface.sequelize.query(
      `UPDATE appointments SET reports_summary_status = 'pending' WHERE reports_summary_status = 'idle'`,
    );
    await queryInterface.sequelize.query(
      `UPDATE appointments SET progress_summary_status = 'pending' WHERE progress_summary_status = 'idle'`,
    );
  },
};
