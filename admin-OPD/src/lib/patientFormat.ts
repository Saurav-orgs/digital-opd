import type { ClinicPatient } from '../api/types';

/** Age in whole years, preferring the birth date over the last recorded age. */
export function ageOf(p: ClinicPatient): string {
  if (p.dob) {
    const born = new Date(`${p.dob}T00:00:00`);
    if (!Number.isNaN(born.getTime())) {
      const now = new Date();
      let age = now.getFullYear() - born.getFullYear();
      const monthDelta = now.getMonth() - born.getMonth();
      if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < born.getDate())) {
        age--;
      }
      if (age >= 0 && age <= 120) return `${age} yrs`;
    }
  }
  return p.last_age != null ? `${p.last_age} yrs` : '—';
}

/** "Female" → "F", "Male" → "M"; anything else as written. */
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
