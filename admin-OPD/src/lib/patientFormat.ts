import type { ClinicPatient } from '../api/types';

/**
 * Years and months between a birth date and a reference date (today by
 * default), or null for an unusable one. Kept so a young patient's months
 * survive: a six-month-old and a two-year-old are both "0 yrs" otherwise.
 */
export function ageYm(
  dob: string,
  asOf?: string,
): { years: number; months: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const [by, bm, bd] = dob.split('-').map(Number);
  let ry: number;
  let rm: number;
  let rd: number;
  if (asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    [ry, rm, rd] = asOf.split('-').map(Number);
  } else {
    const now = new Date();
    ry = now.getFullYear();
    rm = now.getMonth() + 1;
    rd = now.getDate();
  }
  let years = ry - by;
  let months = rm - bm;
  if (rd < bd) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return years < 0 || years > 120 ? null : { years, months };
}

/**
 * A compact age in whole years — "25 yrs". The doctor side shows years only;
 * the months the birth date also implies are left to the patient-facing
 * booking form, which asks for them one patient at a time.
 */
export function formatAge(dob: string | null | undefined, asOf?: string): string | null {
  if (!dob) return null;
  const ym = ageYm(dob, asOf);
  if (!ym) return null;
  return `${ym.years} yrs`;
}

/** Age for the patient list, preferring the birth date over the last age. */
export function ageOf(p: ClinicPatient): string {
  return formatAge(p.dob) ?? (p.last_age != null ? `${p.last_age} yrs` : '—');
}

/** "Female" → "F", "Male" → "M"; anything else as written. */
/**
 * Gender as a full capitalised word — "Female", not "female" or "F".
 *
 * The column stores it lowercase; every screen that shows it to a doctor
 * capitalises, so the rule lives here rather than inline at each call site.
 */
export function prettyGender(g: string | null | undefined): string {
  const v = (g ?? '').trim();
  if (!v) return '';
  return v[0].toUpperCase() + v.slice(1).toLowerCase();
}

export function shortGender(g: string | null | undefined) {
  const v = (g ?? '').trim();
  if (!v) return '';
  const first = v[0].toUpperCase();
  if (first === 'M' || first === 'F') return first;
  return v[0].toUpperCase() + v.slice(1).toLowerCase();
}

export function prettyDate(date: string | null) {
  if (!date) return '—';
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
