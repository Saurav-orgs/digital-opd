import { ageFromDob, dobFromAge } from './age';

describe('age utils', () => {
  it('turns an age into a birth date that gives the same age back', () => {
    expect(dobFromAge(34, '2026-09-28')).toBe('1992-09-28');
    expect(ageFromDob(dobFromAge(34, '2026-09-28'), '2026-09-28')).toBe(34);
    // A year on, the patient is a year older without anyone retyping it.
    expect(ageFromDob(dobFromAge(34, '2026-09-28'), '2027-09-28')).toBe(35);
    expect(dobFromAge(0, '2026-09-28')).toBe('2026-09-28');
  });

  it('moves 29 February to the 28th in a year that lacks it', () => {
    expect(dobFromAge(3, '2028-02-29')).toBe('2025-02-28');
    expect(dobFromAge(4, '2028-02-29')).toBe('2024-02-29');
  });

  it('gives nothing for a missing or implausible age', () => {
    expect(dobFromAge(undefined, '2026-09-28')).toBeNull();
    expect(dobFromAge(null, '2026-09-28')).toBeNull();
    expect(dobFromAge(-1, '2026-09-28')).toBeNull();
    expect(dobFromAge(121, '2026-09-28')).toBeNull();
    expect(dobFromAge(3.5, '2026-09-28')).toBeNull();
  });
});
