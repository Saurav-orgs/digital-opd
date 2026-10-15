/**
 * A patient's age, as the forms deal with it.
 *
 * There is exactly one value — the date of birth — and an age is a view of it.
 * That is also how the record works (`patient_profiles.dob`, with the server's
 * own `dobFromAge` standing in when only an age is given), so the form and the
 * column agree about what is being stored.
 *
 * The first version kept a `dob` string *and* an `age` string side by side and
 * cleared one when the patient switched to the other, which lost whatever they
 * had already entered. Two values that mean the same thing will always find a
 * way to disagree; there is one here, and the toggle only changes how it is
 * typed.
 *
 * Kept apart from the field that renders it so the forms can validate without
 * importing a component.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** Today as YYYY-MM-DD, the cap on any birth date. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole years between a YYYY-MM-DD date of birth and today, or null. */
export function ageFromDob(dob: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const [by, bm, bd] = dob.split('-').map(Number);
  const now = new Date();
  let age = now.getFullYear() - by;
  const m = now.getMonth() + 1;
  const d = now.getDate();
  if (m < bm || (m === bm && d < bd)) age--;
  return age < 0 || age > 120 ? null : age;
}

/**
 * The estimated date of birth of someone who gave only their age: that many
 * years before today, so {@link ageFromDob} gives the number back exactly and
 * moves it on a year from the next birthday.
 *
 * The same rule as the server's `dobFromAge`, including 29 February becoming
 * 28 February in a year that lacks one — a patient who types an age and one
 * whose age the server converts must end up with the same record.
 */
export function dobFromAge(age: number): string | null {
  if (!Number.isInteger(age) || age < 0 || age > 120) return null;
  const now = new Date();
  const year = now.getFullYear() - age;
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const day = m === 2 && d === 29 && !leap ? 28 : d;
  return `${String(year).padStart(4, '0')}-${pad(m)}-${pad(day)}`;
}

/**
 * What the forms check before submitting, in one place so they cannot
 * disagree. Returns an error message, or null when the answer is usable.
 */
export function validateDob(dob: string, required: boolean): string | null {
  if (!dob) return required ? 'Please enter a date of birth, or the age.' : null;
  return ageFromDob(dob) == null ? 'Please enter a valid date of birth.' : null;
}
