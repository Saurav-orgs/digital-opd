/**
 * Age in whole years on a given date, from a YYYY-MM-DD date of birth.
 *
 * Storing the date of birth rather than the age is what keeps a patient's
 * record from going stale between visits: an age typed once at the desk is
 * wrong within a year, a birth date never is. This derives the number wherever
 * one is still wanted — the appointment row keeps an age snapshot, and the
 * prescription letterhead prints one.
 *
 * Returns null for anything that is not a real date, a birth date in the
 * future, or an implausible age, so a bad value reads as "unknown" rather than
 * printing a negative number on a prescription.
 */
export function ageFromDob(
  dob: string | null | undefined,
  onDate: string,
): number | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(onDate)) return null;

  const [by, bm, bd] = dob.split('-').map(Number);
  const [ry, rm, rd] = onDate.split('-').map(Number);

  let age = ry - by;
  // Birthday not reached yet this year.
  if (rm < bm || (rm === bm && rd < bd)) age--;

  if (age < 0 || age > 120) return null;
  return age;
}

/**
 * An estimated YYYY-MM-DD date of birth for someone who gave only their age:
 * `age` years before `onDate`, so {@link ageFromDob} gives back exactly that
 * age today and moves on by a year a year from now.
 *
 * Registration asks for an age, not a birth date — a patient knows the first
 * and often not the second. Keeping it as an estimated birth date rather than
 * a bare number is what stops it going stale, the same reason the column holds
 * a date at all. 29 February becomes 28 February in a year that lacks it.
 */
export function dobFromAge(
  age: number | null | undefined,
  onDate: string,
): string | null {
  if (age == null || !Number.isInteger(age) || age < 0 || age > 120) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(onDate)) return null;

  const [y, m, d] = onDate.split('-').map(Number);
  const year = y - age;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const day = m === 2 && d === 29 && !leap ? 28 : d;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(year).padStart(4, '0')}-${pad(m)}-${pad(day)}`;
}
