import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Sparkles, Upload, X } from 'lucide-react';
import { doctorRegistrationApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { LoginResponse } from '../api/types';
import { LogoFull } from '../components/Brand';
import { Field } from '../components/ui';
import { HEADER_BEST_W, LetterheadHeaderPicker, LetterheadPreview } from '../components/Letterhead';

/**
 * First sign-in for a doctor whose account was created and paid for on the
 * landing site.
 *
 * Its own component rather than a fourth stage variant inside
 * `DoctorRegister.tsx`. That file is ~840 lines serving public registration,
 * where the first thing that happens is proving an email address and choosing
 * a password — none of which applies here, because the account already exists
 * and the doctor is signed into it. Every `setup ? … : …` branch in there was
 * a reader having to hold two flows in their head at once, and the design now
 * gives this one four steps of its own.
 *
 * Availability is deliberately **not** here. It was the old setup's third
 * stage; the redesign moves opening hours to `My time slots`, which is a
 * screen the doctor returns to as the clinic's hours change rather than a
 * thing to get right once under pressure on day one.
 */
const STEPS = ['About you', 'Contact', 'Address', 'Review'] as const;
type Step = 0 | 1 | 2 | 3;

/** A short title + line of guidance shown above each step's fields. */
const STEP_HEAD: [string, string][] = [
  ['About you', 'As it should read on your prescriptions.'],
  ['How patients reach you', 'Used for booking confirmations and your prescription footer.'],
  ['Clinic address', 'Printed on the letterhead and shown on your booking page.'],
  ['Check and finish', 'This is what goes on your prescriptions.'],
];

const SPECIALISATIONS = [
  'General Medicine',
  'General Physician',
  'Paediatrics',
  'Gynaecology & Obstetrics',
  'IVF & Fertility',
  'Dermatology',
  'Orthopaedics',
  'Cardiology',
  'ENT',
  'Ophthalmology',
  'Neurology',
  'Nephrology',
  'Gastroenterology',
  'Pulmonology',
  'Endocrinology',
  'Urology',
  'Oncology',
  'Psychiatry',
  'Dentistry',
  'Ayurveda',
  'Homeopathy',
  'Physiotherapy',
];

/**
 * The common qualifications. A doctor usually holds more than one and the
 * column is a comma-joined string, so these feed a picker whose choices become
 * removable chips — `Other…` keeps anything not on the list typeable.
 */
const QUALIFICATIONS = [
  'MBBS',
  'MD',
  'MS',
  'DNB',
  'DM',
  'MCh',
  'BDS',
  'MDS',
  'BAMS',
  'BHMS',
  'DGO',
  'DCH',
];

/** The states and union territories a clinic can sit in. */
const STATES = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman & Nicobar Islands',
  'Chandigarh',
  'Dadra & Nagar Haveli and Daman & Diu',
  'Jammu & Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
];

/** The state councils a registration number can belong to. */
const COUNCILS = [
  'Andhra Pradesh Medical Council',
  'Bihar Medical Council',
  'Delhi Medical Council',
  'Gujarat Medical Council',
  'Karnataka Medical Council',
  'Kerala State Medical Council',
  'Madhya Pradesh Medical Council',
  'Maharashtra Medical Council',
  'Punjab Medical Council',
  'Rajasthan Medical Council',
  'Tamil Nadu Medical Council',
  'Telangana State Medical Council',
  'Uttar Pradesh Medical Council',
  'West Bengal Medical Council',
  'National Medical Commission',
];

const OTHER = '\u0000other';

export default function DoctorSetupPage() {
  const navigate = useNavigate();
  const { user, setSession } = useAuth();
  const headerRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>(0);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: user?.name ?? '',
    license_number: '',
    medical_council: '',
    specialization: '',
    contact_mobile: '',
    clinic_name: '',
    clinic_phone: '',
    clinic_address: '',
    clinic_address_line2: '',
    clinic_city: '',
    clinic_pincode: '',
    clinic_state: '',
    clinic_country: 'India',
  });

  const [councilChoice, setCouncilChoice] = useState('');
  const [specChoice, setSpecChoice] = useState('');

  // Qualifications are picked one at a time and shown as removable chips; the
  // comma-joined string is what the backend stores.
  const [quals, setQuals] = useState<string[]>([]);
  const [qualPick, setQualPick] = useState('');
  const [qualOther, setQualOther] = useState('');

  // Review offers our composed letterhead or the doctor's own pad header. The
  // uploaded file only counts when `custom` is chosen, so switching back to
  // `default` ignores it without throwing it away.
  const [lhMode, setLhMode] = useState<'default' | 'custom'>('default');

  // The pad header is optional here — the Letterhead screen takes it just as
  // well — but a doctor who has the file to hand should not come back for it.
  const [header, setHeader] = useState<File | null>(null);
  // Width ÷ height of the strip the picker handed back, so the preview below
  // is the shape that will print rather than a fixed box.
  const [headerRatio, setHeaderRatio] = useState<number | null>(null);
  const [headerPreview, setHeaderPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!header) return setHeaderPreview(null);
    const url = URL.createObjectURL(header);
    setHeaderPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [header]);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const qualifications = useMemo(() => quals.join(', '), [quals]);

  /** Add the picked (or typed) qualification as a chip, skipping duplicates. */
  const addQual = () => {
    const v = (qualPick === OTHER ? qualOther : qualPick).trim();
    if (!v) return;
    setQuals((list) => (list.includes(v) ? list : [...list, v]));
    setQualPick('');
    setQualOther('');
  };

  const pinOk = !form.clinic_pincode || /^\d{6}$/.test(form.clinic_pincode);
  const mobileOk = /^[6-9]\d{9}$/.test(form.contact_mobile.trim());

  /*
   * What each step needs before Continue lights up. Only the first three
   * gate — Review has nothing of its own to fill in.
   */
  const stepValid: boolean[] = [
    !!form.name.trim() &&
      !!form.license_number.trim() &&
      !!qualifications &&
      !!form.specialization.trim(),
    mobileOk && !!form.clinic_name.trim(),
    !!form.clinic_address.trim() && !!form.clinic_city.trim() && pinOk,
    true,
  ];
  const canSubmit = stepValid[0] && stepValid[1] && stepValid[2];

  const save = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      const payload = { ...form, qualifications };
      for (const [k, v] of Object.entries(payload)) {
        if (v && v.trim()) fd.append(k, v.trim());
      }
      if (lhMode === 'custom' && header) fd.append('letterhead_header', header);
      return doctorRegistrationApi.setup(fd);
    },
    onSuccess: (res) => {
      /*
       * Setup returns a fresh session: the account gains a doctor id and the
       * `needsSetup` flag clears, and the token in hand still says otherwise.
       * Without taking the new one the guard would send the doctor straight
       * back here.
       */
      if (res.accessToken && res.user) setSession(res as LoginResponse);
      navigate('/dashboard', { replace: true });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save your profile.'),
  });

  /** Steps are reachable once everything before them holds up. */
  const goTo = (n: Step) => {
    for (let i = 0; i < n; i++) if (!stepValid[i]) return;
    setError(null);
    setStep(n);
  };

  return (
    <div className="setup-screen">
      <div className="setup-wrap">
        <header className="setup-head">
          <LogoFull />
          <p>Let’s set up your practice. This takes a minute, and you can change any of it later.</p>
        </header>

        {/* Clickable, but only backwards and to steps already satisfied —
            jumping to Review from a blank form would show a letterhead with
            nothing on it. */}
        <ol className="setup-steps" aria-label="Setup progress">
          {STEPS.map((label, i) => {
            const n = i as Step;
            const reachable = i === 0 || stepValid.slice(0, i).every(Boolean);
            return (
              <li key={label}>
                <button
                  type="button"
                  className={`setup-step ${step === n ? 'active' : ''} ${step > n ? 'done' : ''}`}
                  aria-current={step === n ? 'step' : undefined}
                  disabled={!reachable}
                  onClick={() => goTo(n)}
                >
                  <span className="setup-step-n" aria-hidden>
                    {step > n ? '✓' : i + 1}
                  </span>
                  <span className="setup-step-label">{label}</span>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="card setup-card">
          <div className="setup-step-head">
            <h2>{STEP_HEAD[step][0]}</h2>
            <p>{STEP_HEAD[step][1]}</p>
          </div>

          {step === 0 && (
            <>
              <Field label="Full name" required>
                <input
                  className="input"
                  autoFocus
                  placeholder="Dr Priya Verma"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                />
              </Field>

              <div className="form-row-2">
                <Field label="Registration number" required>
                  <input
                    className="input"
                    placeholder="e.g. KMC/12345"
                    value={form.license_number}
                    onChange={(e) => set('license_number', e.target.value)}
                  />
                </Field>
                <Field label="Medical council">
                  <select
                    className="select"
                    value={councilChoice}
                    onChange={(e) => {
                      setCouncilChoice(e.target.value);
                      set('medical_council', e.target.value === OTHER ? '' : e.target.value);
                    }}
                  >
                    <option value="">Choose a council…</option>
                    {COUNCILS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                    <option value={OTHER}>Other…</option>
                  </select>
                </Field>
              </div>

              {councilChoice === OTHER && (
                <Field label="Council name">
                  <input
                    className="input"
                    autoFocus
                    value={form.medical_council}
                    onChange={(e) => set('medical_council', e.target.value)}
                  />
                </Field>
              )}

              <Field label="Qualifications" required>
                {quals.length > 0 && (
                  <div className="chip-pick" style={{ marginBottom: 8 }}>
                    {quals.map((q) => (
                      <button
                        key={q}
                        type="button"
                        className="qual-chip"
                        aria-label={`Remove ${q}`}
                        onClick={() => setQuals((v) => v.filter((x) => x !== q))}
                      >
                        {q}
                        <X size={13} className="x" aria-hidden />
                      </button>
                    ))}
                  </div>
                )}
                <div className="qual-add">
                  <select
                    className="select"
                    value={qualPick}
                    onChange={(e) => {
                      setQualPick(e.target.value);
                      if (e.target.value && e.target.value !== OTHER) {
                        setQuals((v) => (v.includes(e.target.value) ? v : [...v, e.target.value]));
                        setQualPick('');
                      }
                    }}
                  >
                    <option value="">Choose a qualification…</option>
                    {QUALIFICATIONS.map((q) => (
                      <option key={q} value={q} disabled={quals.includes(q)}>
                        {q}
                      </option>
                    ))}
                    <option value={OTHER}>Other…</option>
                  </select>
                  {qualPick === OTHER && (
                    <button type="button" className="btn" onClick={addQual}>
                      Add
                    </button>
                  )}
                </div>
                {qualPick === OTHER && (
                  <input
                    className="input"
                    autoFocus
                    placeholder="Enter qualification"
                    value={qualOther}
                    style={{ marginTop: 8 }}
                    onChange={(e) => setQualOther(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addQual();
                      }
                    }}
                  />
                )}
              </Field>

              <Field label="Specialisation" required>
                <select
                  className="select"
                  value={specChoice}
                  onChange={(e) => {
                    setSpecChoice(e.target.value);
                    set('specialization', e.target.value === OTHER ? '' : e.target.value);
                  }}
                >
                  <option value="">Choose a specialisation…</option>
                  {SPECIALISATIONS.map((sp) => (
                    <option key={sp} value={sp}>
                      {sp}
                    </option>
                  ))}
                  <option value={OTHER}>Other…</option>
                </select>
              </Field>
              {specChoice === OTHER && (
                <Field label="Your specialisation">
                  <input
                    className="input"
                    autoFocus
                    value={form.specialization}
                    onChange={(e) => set('specialization', e.target.value)}
                  />
                </Field>
              )}
            </>
          )}

          {step === 1 && (
            <>
              {/* The email is the one they signed in with and is not editable
                  here — changing the address an account is keyed on is a
                  different, verified flow. */}
              <Field label="Email">
                <input className="input" value={user?.email ?? ''} disabled />
              </Field>
              <Field
                label="Mobile"
                required
                error={
                  form.contact_mobile && !mobileOk ? 'A 10-digit Indian mobile number.' : undefined
                }
              >
                <input
                  className="input"
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="98765 43210"
                  value={form.contact_mobile}
                  onChange={(e) =>
                    set('contact_mobile', e.target.value.replace(/\D/g, '').slice(0, 10))
                  }
                />
              </Field>
              <Field label="Clinic name" required>
                <input
                  className="input"
                  placeholder="Sunrise Family Clinic"
                  value={form.clinic_name}
                  onChange={(e) => set('clinic_name', e.target.value)}
                />
              </Field>
              <Field label="Clinic phone">
                <input
                  className="input"
                  placeholder="+91 80 4123 4567"
                  value={form.clinic_phone}
                  onChange={(e) => set('clinic_phone', e.target.value)}
                />
              </Field>
            </>
          )}

          {step === 2 && (
            <>
              <Field label="Address line 1" required>
                <input
                  className="input"
                  autoFocus
                  placeholder="2nd Floor, MG Road"
                  value={form.clinic_address}
                  onChange={(e) => set('clinic_address', e.target.value)}
                />
              </Field>
              <Field label="Address line 2">
                <input
                  className="input"
                  placeholder="Near Trinity Metro"
                  value={form.clinic_address_line2}
                  onChange={(e) => set('clinic_address_line2', e.target.value)}
                />
              </Field>
              <div className="form-row-2">
                <Field label="City" required>
                  <input
                    className="input"
                    placeholder="Bengaluru"
                    value={form.clinic_city}
                    onChange={(e) => set('clinic_city', e.target.value)}
                  />
                </Field>
                <Field label="PIN code" error={pinOk ? undefined : 'A PIN code is 6 digits.'}>
                  <input
                    className="input"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="560001"
                    value={form.clinic_pincode}
                    onChange={(e) =>
                      set('clinic_pincode', e.target.value.replace(/\D/g, '').slice(0, 6))
                    }
                  />
                </Field>
              </div>
              <div className="form-row-2">
                <Field label="State">
                  <select
                    className="select"
                    value={form.clinic_state}
                    onChange={(e) => set('clinic_state', e.target.value)}
                  >
                    <option value="">Choose a state…</option>
                    {STATES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </Field>
                {/*
                  Fixed, not chosen. myDigitalOPD is an Indian product — the
                  State list above is the Indian states, the councils are the
                  Indian councils, pincodes are six digits and the plans are
                  priced in rupees on a GST invoice. The dropdown that used to
                  be here offered ten other countries, every one of which made
                  the rest of this form wrong. Shown rather than hidden because
                  it is still part of the clinic's address, and the letterhead
                  reads it.
                */}
                <Field label="Country">
                  <input className="input" value={form.clinic_country} disabled readOnly />
                </Field>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              {/*
                Two ways to head a prescription: the block we compose from the
                answers above, or the doctor's own printed pad. Picking "Upload
                my own" opens the file dialog straight away; the preview below
                then shows whichever one is chosen, as it will print.

                The shared picker, not a file input of its own. This screen
                used to take `image/*` and send the file as it came, so a
                doctor holding the printer's PDF of their pad — which is what
                a printer hands over — had nothing to upload, and a photo of
                the whole sheet was sent as the header. The picker accepts a
                PDF, draws page 1, and lets the doctor mark where the header
                ends; `/register` and the Letterhead screen have worked this
                way since the cropper landed.
              */}
              <LetterheadHeaderPicker
                inputRef={headerRef}
                onPick={(file, ratio) => {
                  setHeader(file);
                  setHeaderRatio(ratio);
                  setLhMode('custom');
                  setError(null);
                }}
                onReject={(problem) => setError(problem)}
              />
              <div className="lh-choice">
                <button
                  type="button"
                  className={`lh-opt ${lhMode === 'default' ? 'on' : ''}`}
                  aria-pressed={lhMode === 'default'}
                  onClick={() => setLhMode('default')}
                >
                  <Sparkles size={18} aria-hidden />
                  <div>
                    <b>Use our letterhead</b>
                    <span>Built from the details you just entered</span>
                  </div>
                </button>
                <button
                  type="button"
                  className={`lh-opt ${lhMode === 'custom' ? 'on' : ''}`}
                  aria-pressed={lhMode === 'custom'}
                  onClick={() => {
                    setLhMode('custom');
                    if (!header) headerRef.current?.click();
                  }}
                >
                  <Upload size={18} aria-hidden />
                  <div>
                    <b>
                      Upload my own <small>· optional</small>
                    </b>
                    <span>A scan, photo or the printer's PDF</span>
                  </div>
                </button>
              </div>

              {lhMode === 'custom' && header && (
                <div className="lh-file">
                  <span className="n">{header.name}</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      setHeader(null);
                      setHeaderRatio(null);
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}

              {lhMode === 'custom' && !header && (
                <p className="muted" style={{ fontSize: 12.5, margin: '10px 0 0' }}>
                  Upload your pad — a scan, a photo or the printer's PDF — and mark
                  where the header ends. At least {HEADER_BEST_W} px wide prints best.
                </p>
              )}

              <LetterheadPreview
                headerUrl={lhMode === 'custom' ? headerPreview : null}
                headerRatio={headerRatio}
                doctorName={form.name || 'Your name'}
                qualifications={qualifications || 'Qualifications'}
                specialization={form.specialization || form.clinic_name || ''}
                address={joinAddress(form) || 'Clinic address'}
                phone={form.clinic_phone}
              />

              <dl className="kv">
                <dt>Council</dt>
                <dd>{form.medical_council || '—'}</dd>
                <dt>Email</dt>
                <dd>{user?.email || '—'}</dd>
                <dt>Mobile</dt>
                <dd>{form.contact_mobile ? `+91 ${form.contact_mobile}` : '—'}</dd>
                <dt>Address</dt>
                <dd>{summaryAddress(form) || '—'}</dd>
              </dl>
            </>
          )}

          {error && (
            <div className="form-error" role="alert" style={{ marginTop: 12 }}>
              {error}
            </div>
          )}
        </div>

        <div className="setup-foot">
          <button
            className="btn"
            disabled={step === 0 || save.isPending}
            onClick={() => goTo((step - 1) as Step)}
          >
            Back
          </button>
          {step < 3 ? (
            <button
              className="btn btn-primary"
              disabled={!stepValid[step]}
              onClick={() => goTo((step + 1) as Step)}
            >
              Continue
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={!canSubmit || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Saving…' : 'Finish setup'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The address as one line — the same join the letterhead screen uses. */
function joinAddress(f: {
  clinic_address: string;
  clinic_address_line2: string;
  clinic_city: string;
  clinic_pincode: string;
  clinic_state: string;
  clinic_country: string;
}): string {
  return [
    f.clinic_address,
    f.clinic_address_line2,
    [f.clinic_city, f.clinic_pincode].filter(Boolean).join(' '),
    f.clinic_state,
    f.clinic_country && f.clinic_country.trim().toLowerCase() !== 'india' ? f.clinic_country : '',
  ]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

/**
 * The address for the Review summary — like `joinAddress`, but the country is
 * always shown. The letterhead drops "India" as noise; the summary spells out
 * exactly what was entered, so a doctor can confirm it.
 */
function summaryAddress(f: Parameters<typeof joinAddress>[0]): string {
  const base = joinAddress(f);
  if (!base) return '';
  const isIndia = f.clinic_country.trim().toLowerCase() === 'india';
  return isIndia ? `${base}, India` : base;
}
