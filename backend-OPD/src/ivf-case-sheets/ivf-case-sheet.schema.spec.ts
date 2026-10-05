import {
  IVF_SPECIALIZATION,
  isIvfCaseSheetEmpty,
  isIvfSpecialization,
  sanitizeIvfCaseSheetData,
} from './ivf-case-sheet.schema';

/**
 * The sanitizer is the server's authority on what a valid case-sheet body is —
 * the DTO only asserts an object came in. These lock down the three things it
 * must do: drop anything not in the schema, cap what it keeps, and keep only
 * the known investigation keys.
 */
describe('sanitizeIvfCaseSheetData', () => {
  it('keeps known fields, trimmed', () => {
    const out = sanitizeIvfCaseSheetData({
      marriedSinceYrs: '  5  ',
      wife: { name: ' Asha ', age: '32', occupation: '' },
      diagnosisAndPlan: 'Primary infertility, plan IVF',
    });
    expect(out.marriedSinceYrs).toBe('5');
    expect(out.wife).toEqual({ name: 'Asha', age: '32' });
    expect(out.diagnosisAndPlan).toBe('Primary infertility, plan IVF');
  });

  it('drops unknown top-level keys and unknown nested keys', () => {
    const out = sanitizeIvfCaseSheetData({
      evil: 'x'.repeat(10000),
      wife: { name: 'Asha', hacker: 'drop me' },
      __proto__: { polluted: true },
    } as any);
    expect((out as any).evil).toBeUndefined();
    expect((out.wife as any).hacker).toBeUndefined();
    expect((out as any).polluted).toBeUndefined();
  });

  it('keeps only known investigation test keys', () => {
    const out = sanitizeIvfCaseSheetData({
      femaleInvestigations: {
        fsh: { date: '2026-01-02', report: '6.1' },
        madeUpTest: { date: '2026-01-02', report: 'nope' },
      },
      maleInvestigations: { totalTest: { report: '450' }, bogus: { report: 'x' } },
    });
    expect(out.femaleInvestigations).toEqual({
      fsh: { date: '2026-01-02', report: '6.1' },
    });
    expect(out.maleInvestigations).toEqual({ totalTest: { report: '450' } });
  });

  it('caps semen analysis at three rows and drops empty ones', () => {
    const out = sanitizeIvfCaseSheetData({
      semenAnalysis: [
        { count: '40' },
        {},
        { vol: '2' },
        { vol: '3' },
        { vol: '4' },
      ],
    });
    // Sliced to the first three, and the empty row within them removed.
    expect(out.semenAnalysis).toEqual([{ count: '40' }, { vol: '2' }]);
  });

  it('caps a long free-text field', () => {
    const out = sanitizeIvfCaseSheetData({ diagnosisAndPlan: 'y'.repeat(9000) });
    expect(out.diagnosisAndPlan!.length).toBe(4000);
  });

  it('returns an empty object for junk input', () => {
    expect(sanitizeIvfCaseSheetData(null)).toEqual({});
    expect(sanitizeIvfCaseSheetData('nonsense')).toEqual({});
    expect(isIvfCaseSheetEmpty(sanitizeIvfCaseSheetData({}))).toBe(true);
  });

  it('is not empty once a single field is filled', () => {
    expect(isIvfCaseSheetEmpty(sanitizeIvfCaseSheetData({ lmp: '2026-01-01' }))).toBe(false);
  });

  it('pins the specialization the setup list offers', () => {
    expect(IVF_SPECIALIZATION).toBe('IVF & Fertility');
  });
});

/**
 * `specialization` is free text, and an exact comparison against
 * "IVF & Fertility" made every IVF feature disappear for doctors who had
 * written anything else — with nothing on screen to say why.
 */
describe('isIvfSpecialization', () => {
  it.each([
    'IVF & Fertility',
    'ivf & fertility',
    '  IVF  ',
    'Infertility',
    'Fertility specialist',
    'Reproductive Medicine',
    'Obstetrics, Gynaecology & IVF',
  ])('treats %j as an IVF doctor', (value) => {
    expect(isIvfSpecialization(value)).toBe(true);
  });

  it.each(['General Medicine', 'Paediatrics', 'Gynaecology & Obstetrics', '', null, undefined])(
    'treats %j as not an IVF doctor',
    (value) => {
      expect(isIvfSpecialization(value as string | null | undefined)).toBe(false);
    },
  );
});
