'use strict';

/**
 * Every doctor who never set opening hours gets the default week.
 *
 * Hours are optional at sign-up and the paid flow's first-login wizard never
 * asks for them, so a doctor who bought a plan on the landing site has no
 * `opd_schedules` rows at all. The slot engine reads that as "no OPD on any
 * date": their booking page takes nothing and the QR on their desk opens an
 * empty grid. `doctors.service.ts → seedDefaultHours` now writes these rows
 * for every new clinic; this is the same week for the clinics already created.
 *
 * Monday to Saturday, 10:00–14:00, 15-minute slots — the client's usual
 * morning OPD, and the window `DayAvailabilityEditor` already offers as the
 * first thing a doctor sees when they open a fresh day.
 *
 * Only doctors with **zero** rows are touched, so a doctor who set Monday and
 * nothing else keeps exactly the week they chose. Deleted doctors are included
 * (`deleted_at` is not filtered): the rows cascade with the doctor row, and a
 * restored doctor should come back bookable.
 *
 * Table touched:
 *   opd_schedules — insert six rows per doctor that has none.
 */

const DAYS = [1, 2, 3, 4, 5, 6]; // 0 = Sunday, which stays a day off.
const START = '10:00:00';
const END = '14:00:00';
const SLOT_MIN = 15;

module.exports = {
  async up(queryInterface) {
    /*
     * One statement, with the days joined on — not a statement per day.
     *
     * Per day, the first insert gives the doctor a row and the remaining five
     * then fail their own `NOT EXISTS`, so the whole week came out as Monday
     * alone (caught against the development database before this shipped). A
     * single `INSERT … SELECT` evaluates `NOT EXISTS` against the snapshot the
     * statement started with, so all six days see the same "has no hours"
     * doctors — and a re-run after the fact still inserts nothing, because by
     * then those doctors have rows.
     */
    await queryInterface.sequelize.query(
      `INSERT INTO opd_schedules
         (id, doctor_id, day_of_week, start_time, end_time,
          slot_duration_min, is_active, created_at, updated_at)
       SELECT gen_random_uuid(), d.id, day.n, :start, :end, :slot, true, NOW(), NOW()
         FROM doctors d
         CROSS JOIN unnest(ARRAY[:days]::int[]) AS day(n)
        WHERE NOT EXISTS (
              SELECT 1 FROM opd_schedules s WHERE s.doctor_id = d.id
        )`,
      { replacements: { start: START, end: END, slot: SLOT_MIN, days: DAYS } },
    );
  },

  async down() {
    /*
     * Deliberately a no-op.
     *
     * Nothing on an `opd_schedules` row says who wrote it, so a revert can
     * only go by shape — and "Monday to Saturday, 10:00–14:00, 15 minutes" is
     * a perfectly ordinary week a doctor may have set themselves. Tried
     * against the development database: a shape-matching delete took the
     * hours off three clinics this migration had never touched. Closing a
     * real clinic's booking page to undo a default is far worse than leaving
     * a default in place.
     *
     * Rolling the feature back means reverting `seedDefaultHours` in
     * `doctors.service.ts`; the hours this left behind are the hours the
     * client asked every doctor to start with, and a doctor who does not want
     * them clears the day on My time slots.
     */
  },
};
