'use strict';

/**
 * Give every existing patient a date of birth, so their next booking fills
 * itself in.
 *
 * `patient_profiles.dob` has been the column of record for a while, but
 * nothing was writing it: every patient-side form asked for an age, and the
 * age went onto the appointment row as a snapshot. So in practice `dob` was
 * null for everybody, and a returning patient was asked for their age again at
 * every booking — the record held the answer three times over in its
 * appointments and could not offer it once.
 *
 * The forms ask for a date now (and keep a given age as an estimated date, see
 * `dobFromAge`), but that only helps patients who come back *after* this. This
 * is the same estimate applied backwards: the age on their most recent visit,
 * counted back from the date of that visit. A patient who was 32 on
 * 2026-03-14 gets 1994-03-14, which reads 32 today and 33 next March — the
 * whole reason the column holds a date rather than a number.
 *
 * It is an estimate, and only to the day. That is exactly what it would have
 * been had they typed the age into the new form, so nothing here is less
 * certain than what we already store. Only rows with no `dob` are touched, so
 * a real birth date is never overwritten and re-running changes nothing.
 *
 * Tables touched:
 *   patient_profiles — fill dob where it is null, from appointments.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE patient_profiles p
         SET dob = (latest.appointment_date - (latest.patient_age || ' years')::interval)::date,
             updated_at = NOW()
        FROM (
              SELECT DISTINCT ON (patient_profile_id)
                     patient_profile_id,
                     appointment_date,
                     patient_age
                FROM appointments
               WHERE patient_profile_id IS NOT NULL
                 AND patient_age IS NOT NULL
                 AND patient_age BETWEEN 0 AND 120
               ORDER BY patient_profile_id, appointment_date DESC, start_time DESC
             ) AS latest
       WHERE p.id = latest.patient_profile_id
         AND p.dob IS NULL
    `);
  },

  async down() {
    /*
     * Deliberately nothing.
     *
     * Reversing this would mean nulling a `dob` — and by the time anyone runs
     * it, some of those dates will have been corrected by a doctor at the
     * desk. There is no column recording which ones this migration wrote, so
     * "undo" could only be "delete everyone's date of birth", which is worse
     * than the estimate it would be undoing.
     */
  },
};
