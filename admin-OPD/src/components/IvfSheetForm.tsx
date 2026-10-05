import { ReactNode } from 'react';
import type { IvfCaseSheetData } from '../api/types';
import { FEMALE_TESTS, MALE_TESTS, SEMEN_COLUMNS } from '../lib/ivfCaseSheet';

/**
 * The IVF prescription form itself — every field, no actions and no fetching.
 *
 * It is a plain controlled component so the same form serves both places the
 * doctor meets it: the visit, where it is bound to that appointment's
 * prescription, and My templates, where it is bound to a saved one. Before
 * this split the fields lived inside the visit editor and a template could
 * only ever be saved, never opened or changed.
 */
export function IvfSheetForm({
  value,
  onChange,
  readOnly,
}: {
  value: IvfCaseSheetData;
  onChange: (next: IvfCaseSheetData) => void;
  readOnly: boolean;
}) {
  const data = value;
  const set = (path: string, v: string) => onChange(setPath(data, path, v));
  const val = (path: string): string => (getPath(data, path) as string) ?? '';

  const tf = (path: string, label: string, opts?: { wide?: boolean; placeholder?: string }) => (
    <label className={`ivf-field ${opts?.wide ? 'ivf-field-wide' : ''}`.trim()}>
      <span>{label}</span>
      <input
        className="input"
        value={val(path)}
        placeholder={opts?.placeholder}
        disabled={readOnly}
        onChange={(e) => set(path, e.target.value)}
      />
    </label>
  );

  const ta = (path: string, label: string) => (
    <label className="ivf-field ivf-field-wide">
      <span>{label}</span>
      <textarea
        className="input"
        rows={2}
        value={val(path)}
        disabled={readOnly}
        onChange={(e) => set(path, e.target.value)}
      />
    </label>
  );

  // Semen rows are a fixed three; blank ones simply carry nothing.
  const semen = data.semenAnalysis ?? [];
  const setSemen = (i: number, key: string, v: string) => {
    const rows = [...(data.semenAnalysis ?? [])];
    while (rows.length <= i) rows.push({});
    rows[i] = { ...rows[i], [key]: v };
    onChange({ ...data, semenAnalysis: rows });
  };

  return (
    <>
    <Section title="Couple">
      <div className="ivf-grid">
        {tf('wife.name', 'Wife — name')}
        {tf('wife.age', 'Age')}
        {tf('wife.occupation', 'Occupation')}
        {tf('husband.name', 'Husband — name')}
        {tf('husband.age', 'Age')}
        {tf('husband.occupation', 'Occupation')}
        {tf('vitals.weight', 'Weight')}
        {tf('vitals.height', 'Height')}
        {tf('vitals.bmi', 'BMI')}
        {tf('vitals.bp', 'B.P.')}
        {tf('vitals.date', 'Dated')}
      </div>
    </Section>

    <Section title="History">
      <div className="ivf-grid">
        {tf('marriedSinceYrs', 'Married since (yrs)')}
        {tf('durationOfInfertility', 'Duration of infertility')}
        {tf('menstrualCycle', 'Menstrual history / cycle')}
        {tf('lmp', 'LMP')}
      </div>
      {ta('obstetricHistory', 'Obstetric history (O/H)')}
      <div className="ivf-grid">
        {tf('medicalHistory.dm', 'Medical — DM')}
        {tf('medicalHistory.ht', 'HT')}
        {tf('medicalHistory.thyroid', 'Thyroid')}
        {tf('medicalHistory.tb', 'TB')}
        {tf('medicalHistory.others', 'Others')}
        {tf('coitalDifficulty', 'Coital difficulty')}
        {tf('contraception', 'Contraception')}
        {tf('drugAllergy', 'Drug allergy')}
        {tf('smoking', 'Smoking')}
        {tf('substanceAbuse', 'Substance abuse')}
      </div>
      {ta('surgicalHistory', 'Surgical history')}
      {ta('familyHistory', 'Family history')}
      {ta('ovulationInduction', 'Ovulation induction')}
      <div className="ivf-grid">
        {tf('previousIUI', 'Previous IUI')}
        {tf('stimulation', 'Stimulation')}
      </div>
      {ta('previousIVFDetails', 'Previous IVF details')}
      <div className="ivf-grid">
        {tf('hsg.date', 'HSG — date')}
        {tf('hsg.uterus', 'Uterus')}
        {tf('hsg.tubes', 'Tubes')}
        {tf('laparoscopy.date', 'Laparoscopy — date')}
        {tf('laparoscopy.notes', 'Laparoscopy — findings', { wide: true })}
        {tf('hysteroscopy.date', 'Hysteroscopy — date')}
        {tf('hysteroscopy.notes', 'Hysteroscopy — findings', { wide: true })}
      </div>
      <div className="ivf-grid">
        {tf('clinicalExam.thyroid', 'Clinical exam — thyroid')}
        {tf('clinicalExam.galactorrhoea', 'Galactorrhoea')}
        {tf('clinicalExam.hirsutism', 'Hirsutism')}
        {tf('clinicalExam.psppv', 'P/S/P/V')}
        {tf('partnerHistory.medical', "Partner's history — medical")}
        {tf('partnerHistory.surgical', "Partner's history — surgical")}
      </div>
    </Section>

    <Section title="Investigations — female partner">
      <div className="ivf-grid">
        {tf('femaleBloodGroup', 'Blood group')}
        {tf('thrombophilias', 'Thrombophilias')}
        {tf('karyotypeWife', 'Karyotype (wife)')}
        {tf('papSmear', 'PAP smear (LBC)')}
        {tf('hpv', 'HPV')}
      </div>
      <InvestigationTable
        tests={FEMALE_TESTS}
        group="femaleInvestigations"
        val={val}
        set={set}
        readOnly={readOnly}
      />
    </Section>

    <Section title="Semen analysis">
      <div className="ivf-semen">
        <div className="ivf-semen-row ivf-semen-head">
          <span>#</span>
          {SEMEN_COLUMNS.map((c) => (
            <span key={c.key}>{c.label}</span>
          ))}
        </div>
        {[0, 1, 2].map((i) => (
          <div className="ivf-semen-row" key={i}>
            <span className="ivf-semen-n">{i + 1}</span>
            {SEMEN_COLUMNS.map((c) => (
              <input
                key={c.key}
                className="input"
                value={(semen[i]?.[c.key as keyof (typeof semen)[number]] as string) ?? ''}
                disabled={readOnly}
                onChange={(e) => setSemen(i, c.key, e.target.value)}
              />
            ))}
          </div>
        ))}
      </div>
    </Section>

    <Section title="Investigations — male partner">
      <div className="ivf-grid">{tf('maleBloodGroup', 'Blood group')}</div>
      <InvestigationTable
        tests={MALE_TESTS}
        group="maleInvestigations"
        val={val}
        set={set}
        readOnly={readOnly}
      />
    </Section>

    <Section title="USG (pelvis) / AFC">
      <div className="ivf-grid">
        {tf('usgPelvis.date', 'USG (pelvis) — date')}
        {tf('afc.rt', 'AFC — Rt')}
        {tf('afc.lt', 'AFC — Lt')}
      </div>
      {ta('usgPelvis.notes', 'USG findings')}
    </Section>

    <Section title="Diagnosis & plan">
      <label className="ivf-field ivf-field-wide">
        <span>Diagnosis & plan</span>
        <textarea
          className="input"
          rows={4}
          value={val('diagnosisAndPlan')}
          disabled={readOnly}
          onChange={(e) => set('diagnosisAndPlan', e.target.value)}
        />
      </label>
    </Section>
    </>
  );
}

// ── Section wrapper ──────────────────────────────────────────
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ivf-section">
      <h4 className="ivf-section-title">{title}</h4>
      {children}
    </section>
  );
}

// ── Investigation table (test · date · report) ───────────────
function InvestigationTable({
  tests,
  group,
  val,
  set,
  readOnly,
}: {
  tests: { key: string; label: string }[];
  group: string;
  val: (path: string) => string;
  set: (path: string, value: string) => void;
  readOnly: boolean;
}) {
  return (
    <div className="ivf-inv">
      <div className="ivf-inv-row ivf-inv-head">
        <span>Test</span>
        <span>Date</span>
        <span>Report</span>
      </div>
      {tests.map((t) => (
        <div className="ivf-inv-row" key={t.key}>
          <span className="ivf-inv-label">{t.label}</span>
          <input
            className="input"
            value={val(`${group}.${t.key}.date`)}
            disabled={readOnly}
            onChange={(e) => set(`${group}.${t.key}.date`, e.target.value)}
          />
          <input
            className="input"
            value={val(`${group}.${t.key}.report`)}
            disabled={readOnly}
            onChange={(e) => set(`${group}.${t.key}.report`, e.target.value)}
          />
        </div>
      ))}
    </div>
  );
}

// ── Immutable dot-path get/set ───────────────────────────────
function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function setPath<T extends object>(obj: T, path: string, value: string): T {
  const keys = path.split('.');
  const clone: any = Array.isArray(obj) ? [...obj] : { ...obj };
  let node = clone;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    node[k] = node[k] && typeof node[k] === 'object' ? { ...node[k] } : {};
    node = node[k];
  }
  node[keys[keys.length - 1]] = value;
  return clone as T;
}
