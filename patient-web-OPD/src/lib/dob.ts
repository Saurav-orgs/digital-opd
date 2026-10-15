/**
 * Dates of birth, as the patient-side forms deal with them.
 *
 * Kept apart from the field that renders them so the three forms can validate
 * without importing a component, and so the component file exports only a
 * component.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** Today as YYYY-MM-DD, the cap on any birth date. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole years between a YYYY-MM-DD birth date and today, or null. */
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
 * What the three forms check before submitting, in one place so they cannot
 * disagree. Returns an error message, or null when the answer is usable.
 */
export function validateDobOrAge(
  dob: string,
  age: string,
  required: boolean,
): string | null {
  if (dob) {
    return ageFromDob(dob) == null ? 'Please enter a valid date of birth.' : null;
  }
  if (age.trim()) {
    const n = Number(age);
    return Number.isInteger(n) && n >= 0 && n <= 120 ? null : 'Enter a valid age.';
  }
  return required ? 'Please enter a date of birth, or the age.' : null;
}
