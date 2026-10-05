/**
 * The IVF case-sheet's fixed lists and the specialization that gates it.
 *
 * These mirror the server's `ivf-case-sheet.schema.ts`. The two apps do not
 * share code (this is deliberately not a workspace — see CLAUDE.md), so the
 * labels live in both places; the body is a free-form JSONB blob keyed by these
 * `key`s, so a label wording drifting is cosmetic, never breaking — the server
 * is the authority on which keys are kept.
 */

/** The option the doctor-setup list offers. The check below does not require
 *  this exact string. */
export const IVF_SPECIALIZATION = 'IVF & Fertility';

/**
 * Is this an IVF & Fertility doctor?
 *
 * Matched loosely, and the server agrees (`isIvfSpecialization`).
 * `specialization` is free text: a doctor who registered before the setup list
 * existed, or who typed their own, carries "IVF", "Infertility" or
 * "Reproductive Medicine". An exact comparison made every IVF feature vanish
 * for those doctors with nothing on screen to explain it.
 */
export function isIvfDoctor(specialization: string | null | undefined): boolean {
  const s = (specialization ?? '').toLowerCase();
  // "infertility" contains "fertility", so one test covers both.
  return s.includes('ivf') || s.includes('fertility') || s.includes('reproductive');
}

export const FEMALE_TESTS: { key: string; label: string }[] = [
  { key: 'cbc', label: 'CBC (Hb / Plt count)' },
  { key: 'hplc', label: 'HPLC' },
  { key: 'bldSugar', label: 'Bld Sugar (F / PP)' },
  { key: 'urine', label: 'Urine (R/E)' },
  { key: 'freeT3T4', label: 'Free T3 / T4' },
  { key: 'tsh', label: 'TSH' },
  { key: 'rubella', label: 'Rubella (IgG)' },
  { key: 'hiv', label: 'HIV (I & II)' },
  { key: 'hbsag', label: 'HBs Ag' },
  { key: 'antiHcv', label: 'Anti HCV' },
  { key: 'vdrl', label: 'VDRL' },
  { key: 'fsh', label: 'FSH (D2/D3)' },
  { key: 'lh', label: 'LH (D2/D3)' },
  { key: 'e2', label: 'E2 (D2/D3)' },
  { key: 'amh', label: 'AMH' },
  { key: 'hba1c', label: 'Hb A1C' },
  { key: 'prolactin', label: 'Prolactin' },
  { key: 'lipid', label: 'Lipid Profile' },
  { key: 'ogtt', label: 'OGTT (75 g)' },
  { key: 'lft', label: 'SGOT / SGPT (LFT)' },
  { key: 'kft', label: 'Sr. Creatinine (KFT)' },
  { key: 'ptaptt', label: 'PT / APTT' },
];

export const MALE_TESTS: { key: string; label: string }[] = [
  { key: 'cbcHplc', label: 'CBC / HPLC' },
  { key: 'bldSugar', label: 'Bld Sugar (R)' },
  { key: 't3t4tsh', label: 'T3 / T4 / TSH' },
  { key: 'hiv', label: 'HIV (I & II)' },
  { key: 'hbsag', label: 'HBs Ag' },
  { key: 'antiHcv', label: 'Anti HCV' },
  { key: 'vdrl', label: 'VDRL' },
  { key: 'others', label: 'Others' },
  { key: 'fsh', label: 'FSH' },
  { key: 'lhE2', label: 'LH / E2' },
  { key: 'totalTest', label: 'Total Testosterone' },
  { key: 'tsh', label: 'TSH' },
  { key: 'prolactin', label: 'Prolactin' },
  { key: 'karyotype', label: 'Karyotype (Husband)' },
];

export const SEMEN_COLUMNS: { key: string; label: string }[] = [
  { key: 'datePlace', label: 'Date / Place' },
  { key: 'vol', label: 'Vol' },
  { key: 'count', label: 'Count' },
  { key: 'motility', label: 'Motility' },
  { key: 'morphology', label: 'Morphology' },
  { key: 'pc', label: 'P.C.' },
  { key: 'fructose', label: 'Fructose' },
];
