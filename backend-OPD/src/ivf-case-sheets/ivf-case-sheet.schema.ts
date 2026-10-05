/**
 * The shape of an IVF case-sheet's body, and the one place that decides which
 * fields exist.
 *
 * The body is stored as a single JSONB `data` column rather than ~70 columns:
 * it is a form the clinic owns end to end, read and written whole, never joined
 * or queried by field. That is the same call `patient_profiles.conditions` and
 * the report summaries made. The cost is that the server, not the database,
 * decides what a valid body is — which is what `sanitize` is for. Anything the
 * client sends that is not named here is dropped, every value is coerced to a
 * trimmed string and capped, and the investigation maps keep only the known
 * test keys. So a draft can never grow unbounded and the PDF can trust what it
 * reads.
 *
 * The specialization gate (`IVF_SPECIALIZATION`) lives here too so the service,
 * and nothing else, has the single string that must match the option in the
 * admin's doctor-setup list.
 */

/** The option the admin's doctor-setup list offers. Kept for reference — the
 *  gate below does not require this exact string. */
export const IVF_SPECIALIZATION = 'IVF & Fertility';

/**
 * Is this an IVF & Fertility doctor?
 *
 * Matched loosely, on purpose. `specialization` is free text: the setup screen
 * offers "IVF & Fertility", but a doctor who registered before that list
 * existed — or who typed their own — carries "IVF", "Infertility",
 * "Reproductive Medicine" or similar. An exact comparison made the whole case
 * sheet vanish for exactly those doctors, with no clue why, so anything
 * mentioning IVF or fertility counts.
 */
export function isIvfSpecialization(specialization: string | null | undefined): boolean {
  const s = (specialization ?? '').toLowerCase();
  // "infertility" contains "fertility", so both are covered by one test.
  return s.includes('ivf') || s.includes('fertility') || s.includes('reproductive');
}

/** Per-field cap. `diagnosisAndPlan` gets a larger one — it is the free note. */
const FIELD_MAX = 400;
const LONG_FIELD_MAX = 4000;
/** Semen analysis is three attempts on the pad; more is a data-entry slip. */
const MAX_SEMEN_ROWS = 3;

export interface PersonDetails {
  name?: string;
  age?: string;
  occupation?: string;
}

export interface Vitals {
  weight?: string;
  height?: string;
  bmi?: string;
  bp?: string;
  date?: string;
}

export interface InvestigationValue {
  date?: string;
  report?: string;
}

export interface SemenRow {
  datePlace?: string;
  vol?: string;
  count?: string;
  motility?: string;
  morphology?: string;
  pc?: string;
  fructose?: string;
}

export interface IvfCaseSheetData {
  wife?: PersonDetails;
  husband?: PersonDetails;
  vitals?: Vitals;

  marriedSinceYrs?: string;
  durationOfInfertility?: string;
  menstrualCycle?: string;
  lmp?: string;
  obstetricHistory?: string;
  medicalHistory?: {
    dm?: string;
    ht?: string;
    thyroid?: string;
    tb?: string;
    others?: string;
  };
  coitalDifficulty?: string;
  contraception?: string;
  surgicalHistory?: string;
  familyHistory?: string;
  drugAllergy?: string;
  ovulationInduction?: string;
  previousIUI?: string;
  stimulation?: string;
  previousIVFDetails?: string;
  hsg?: { date?: string; uterus?: string; tubes?: string };
  laparoscopy?: { date?: string; notes?: string };
  hysteroscopy?: { date?: string; notes?: string };
  clinicalExam?: {
    thyroid?: string;
    galactorrhoea?: string;
    hirsutism?: string;
    psppv?: string;
  };
  partnerHistory?: { medical?: string; surgical?: string };
  smoking?: string;
  substanceAbuse?: string;

  femaleBloodGroup?: string;
  femaleInvestigations?: Record<string, InvestigationValue>;
  thrombophilias?: string;
  karyotypeWife?: string;
  papSmear?: string;
  hpv?: string;
  semenAnalysis?: SemenRow[];
  maleBloodGroup?: string;
  maleInvestigations?: Record<string, InvestigationValue>;
  usgPelvis?: { date?: string; notes?: string };
  afc?: { rt?: string; lt?: string };

  diagnosisAndPlan?: string;
}

/** The female investigation panel, in the order it prints. */
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

/** The male investigation panel, in the order it prints. */
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

const FEMALE_TEST_KEYS = new Set(FEMALE_TESTS.map((t) => t.key));
const MALE_TEST_KEYS = new Set(MALE_TESTS.map((t) => t.key));

// ── Sanitizing ───────────────────────────────────────────────

function str(v: unknown, max = FIELD_MAX): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.slice(0, max);
}

/** Keep only the named keys of an object, each coerced through `str`. */
function pick<T>(
  v: unknown,
  keys: (keyof T & string)[],
): Partial<Record<keyof T & string, string>> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const src = v as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of keys) {
    const s = str(src[k]);
    if (s !== undefined) out[k] = s;
  }
  return Object.keys(out).length ? (out as any) : undefined;
}

function investigations(
  v: unknown,
  allowed: Set<string>,
): Record<string, InvestigationValue> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const src = v as Record<string, unknown>;
  const out: Record<string, InvestigationValue> = {};
  for (const key of Object.keys(src)) {
    if (!allowed.has(key)) continue;
    const row = pick<InvestigationValue>(src[key], ['date', 'report']);
    if (row) out[key] = row;
  }
  return Object.keys(out).length ? out : undefined;
}

function semen(v: unknown): SemenRow[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const rows = v
    .slice(0, MAX_SEMEN_ROWS)
    .map((r) =>
      pick<SemenRow>(r, [
        'datePlace',
        'vol',
        'count',
        'motility',
        'morphology',
        'pc',
        'fructose',
      ]),
    )
    .filter((r): r is SemenRow => !!r);
  return rows.length ? rows : undefined;
}

/**
 * Drop everything the schema does not name, cap what it does, and keep only
 * the known investigation keys. The result is safe to store and the only thing
 * the PDF ever reads.
 */
export function sanitizeIvfCaseSheetData(input: unknown): IvfCaseSheetData {
  const src = (input && typeof input === 'object' ? input : {}) as Record<
    string,
    unknown
  >;
  const out: IvfCaseSheetData = {};

  const assign = <K extends keyof IvfCaseSheetData>(
    key: K,
    value: IvfCaseSheetData[K] | undefined,
  ) => {
    if (value !== undefined) out[key] = value;
  };

  assign('wife', pick<PersonDetails>(src.wife, ['name', 'age', 'occupation']));
  assign(
    'husband',
    pick<PersonDetails>(src.husband, ['name', 'age', 'occupation']),
  );
  assign(
    'vitals',
    pick<Vitals>(src.vitals, ['weight', 'height', 'bmi', 'bp', 'date']),
  );

  assign('marriedSinceYrs', str(src.marriedSinceYrs));
  assign('durationOfInfertility', str(src.durationOfInfertility));
  assign('menstrualCycle', str(src.menstrualCycle));
  assign('lmp', str(src.lmp));
  assign('obstetricHistory', str(src.obstetricHistory, LONG_FIELD_MAX));
  assign(
    'medicalHistory',
    pick(src.medicalHistory, ['dm', 'ht', 'thyroid', 'tb', 'others']),
  );
  assign('coitalDifficulty', str(src.coitalDifficulty));
  assign('contraception', str(src.contraception));
  assign('surgicalHistory', str(src.surgicalHistory, LONG_FIELD_MAX));
  assign('familyHistory', str(src.familyHistory, LONG_FIELD_MAX));
  assign('drugAllergy', str(src.drugAllergy));
  assign('ovulationInduction', str(src.ovulationInduction, LONG_FIELD_MAX));
  assign('previousIUI', str(src.previousIUI, LONG_FIELD_MAX));
  assign('stimulation', str(src.stimulation));
  assign('previousIVFDetails', str(src.previousIVFDetails, LONG_FIELD_MAX));
  assign('hsg', pick(src.hsg, ['date', 'uterus', 'tubes']));
  assign('laparoscopy', pick(src.laparoscopy, ['date', 'notes']));
  assign('hysteroscopy', pick(src.hysteroscopy, ['date', 'notes']));
  assign(
    'clinicalExam',
    pick(src.clinicalExam, ['thyroid', 'galactorrhoea', 'hirsutism', 'psppv']),
  );
  assign('partnerHistory', pick(src.partnerHistory, ['medical', 'surgical']));
  assign('smoking', str(src.smoking));
  assign('substanceAbuse', str(src.substanceAbuse));

  assign('femaleBloodGroup', str(src.femaleBloodGroup, 16));
  assign(
    'femaleInvestigations',
    investigations(src.femaleInvestigations, FEMALE_TEST_KEYS),
  );
  assign('thrombophilias', str(src.thrombophilias, LONG_FIELD_MAX));
  assign('karyotypeWife', str(src.karyotypeWife));
  assign('papSmear', str(src.papSmear));
  assign('hpv', str(src.hpv));
  assign('semenAnalysis', semen(src.semenAnalysis));
  assign('maleBloodGroup', str(src.maleBloodGroup, 16));
  assign(
    'maleInvestigations',
    investigations(src.maleInvestigations, MALE_TEST_KEYS),
  );
  assign('usgPelvis', pick(src.usgPelvis, ['date', 'notes']));
  assign('afc', pick(src.afc, ['rt', 'lt']));

  assign('diagnosisAndPlan', str(src.diagnosisAndPlan, LONG_FIELD_MAX));

  return out;
}

/** True when a sanitized body carries nothing — nothing goes to a patient
 *  empty, the same rule the prescription's `assertIssuable` enforces. */
export function isIvfCaseSheetEmpty(data: IvfCaseSheetData): boolean {
  return Object.keys(data).length === 0;
}
