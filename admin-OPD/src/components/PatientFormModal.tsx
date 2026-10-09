import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  blockedNumbersApi,
  patientProfilesApi,
  type StaffPatientInput,
} from '../api/endpoints';
import type { ClinicPatient } from '../api/types';
import { ApiError } from '../api/client';
import { useToast } from './Toast';
import { Field, Modal } from './ui';
import { matchesName, normalizeName, splitList } from '../lib/patientSearch';

/** The 8 groups a dropdown offers; mirrors the server's `BLOOD_GROUPS`. */
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/** How many people one number may register — mirrors the server's cap. */
const MAX_PER_NUMBER = 5;

/** Today as YYYY-MM-DD, so a birth date cannot be set in the future. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Age in whole years from YYYY-MM-DD, for the duplicate hint only. */
function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const born = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const md = now.getMonth() - born.getMonth();
  if (md < 0 || (md === 0 && now.getDate() < born.getDate())) age--;
  return age >= 0 && age <= 120 ? age : null;
}

/**
 * Register a patient from the clinic desk, or edit one — without booking an
 * appointment. The number is the family unit: typing one shows who is already
 * on it, warns when it is full or blocked, and a probable duplicate on a
 * *different* number is flagged before saving so two records of one person do
 * not quietly pile up. Clinical fields (blood group, conditions, long-term
 * medicines) are the summary the clinic keeps by hand.
 *
 * The number cannot be changed on an existing patient — that would move them to
 * a different family — so it is read-only when editing.
 */
export function PatientFormModal({
  editing,
  presetMobile,
  allPatients,
  onClose,
  onSaved,
}: {
  editing?: ClinicPatient | null;
  presetMobile?: string;
  /** The clinic's whole list, for the cross-number duplicate check. */
  allPatients: ClinicPatient[];
  onClose: () => void;
  /** `mobile` carried alongside the id, since the create response omits it. */
  onSaved: (patient: { id: string; mobile: string }, alsoBook: boolean) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const isEdit = !!editing;

  const [mobile, setMobile] = useState(editing?.mobile ?? presetMobile ?? '');
  const [name, setName] = useState(editing?.name ?? '');
  const [dob, setDob] = useState(editing?.dob ?? '');
  const [gender, setGender] = useState((editing?.gender ?? 'female').toLowerCase());
  const [bloodGroup, setBloodGroup] = useState(editing?.blood_group ?? '');
  const [conditions, setConditions] = useState((editing?.conditions ?? []).join(', '));
  const [longMeds, setLongMeds] = useState(
    (editing?.long_term_medicines ?? []).join(', '),
  );
  const [error, setError] = useState<string | null>(null);
  // Which button started the save — "Save" vs "Save & book visit". Held in a
  // ref so onSuccess reads the latest without re-creating the mutation.
  const alsoBookRef = useRef(false);

  const mobileOk = /^[6-9]\d{9}$/.test(mobile.trim());

  // Who is already on this number, so the desk sees the family and the cap.
  const familyQ = useQuery({
    queryKey: ['patients-by-mobile', mobile.trim()],
    queryFn: () => patientProfilesApi.byMobile(mobile.trim()),
    enabled: mobileOk && !isEdit,
  });
  const family = familyQ.data ?? [];
  const atCap = !isEdit && family.length >= MAX_PER_NUMBER;

  const blockedQ = useQuery({
    queryKey: ['blocked-numbers'],
    queryFn: blockedNumbersApi.list,
  });
  const blocked = useMemo(
    () => (blockedQ.data ?? []).some((b) => b.mobile === mobile.trim()),
    [blockedQ.data, mobile],
  );

  // A probable duplicate: the same name (and DOB, when given) on a different
  // number. Not a hard stop — the desk may genuinely have two people — but
  // worth showing before another record is created.
  const dupe = useMemo(() => {
    if (isEdit || !name.trim()) return null;
    const here = mobile.trim();
    return (
      allPatients.find(
        (p) =>
          matchesName(p.name, name) &&
          (dob ? p.dob === dob : true) &&
          normalizeName(p.name) === normalizeName(name) &&
          p.mobile !== here,
      ) ?? null
    );
  }, [isEdit, name, dob, mobile, allPatients]);

  const canSave = (isEdit || (mobileOk && !atCap)) && name.trim().length >= 2;

  const save = useMutation({
    mutationFn: () => {
      const body: StaffPatientInput = {
        mobile: mobile.trim(),
        name: name.trim(),
        gender,
        dob: dob || undefined,
        blood_group: bloodGroup || undefined,
        conditions: splitList(conditions),
        long_term_medicines: splitList(longMeds),
      };
      return isEdit
        ? patientProfilesApi.update(editing!.id, body)
        : patientProfilesApi.create(body);
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['patients'] });
      qc.invalidateQueries({ queryKey: ['patient-overview', saved.id] });
      // The family picker on the booking modal and the family card on the
      // profile both read this, and this is the call that changed who is on
      // the number — without it the patient just registered is missing from
      // the booking the desk goes on to make.
      qc.invalidateQueries({ queryKey: ['patients-by-mobile'] });
      toast.success(
        isEdit ? `${saved.name} updated` : `${saved.name} registered`,
        isEdit ? undefined : 'No appointment booked.',
      );
      onSaved({ id: saved.id, mobile: mobile.trim() }, alsoBookRef.current);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save the patient.'),
  });

  const submit = (alsoBook: boolean) => {
    setError(null);
    alsoBookRef.current = alsoBook;
    save.mutate();
  };

  const phoneNote = (() => {
    if (isEdit || !mobile.trim()) return null;
    if (!mobileOk) return <span className="muted">Enter a valid 10-digit number.</span>;
    if (atCap)
      return (
        <span className="err">
          This number already has {MAX_PER_NUMBER} patients, the maximum allowed.
        </span>
      );
    if (blocked)
      return (
        <span style={{ color: 'var(--state-error)' }}>
          This number is blocked from online booking — walk-ins are still allowed.
          {family.length ? ` ${family.length} registered.` : ''}
        </span>
      );
    if (family.length)
      return (
        <span className="muted">
          {family.length} of {MAX_PER_NUMBER} on this number:{' '}
          {family.map((p) => p.name).join(', ')}
        </span>
      );
    return <span className="muted">No patients on this number yet.</span>;
  })();

  return (
    <Modal
      title={isEdit ? 'Edit patient' : 'New patient'}
      onClose={onClose}
      persistent
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={save.isPending}>
            Cancel
          </button>
          {!isEdit && (
            <button
              className="btn"
              disabled={!canSave || save.isPending}
              onClick={() => submit(true)}
            >
              Save &amp; book visit
            </button>
          )}
          <button
            className="btn btn-primary"
            disabled={!canSave || save.isPending}
            onClick={() => submit(false)}
          >
            {save.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Save patient'}
          </button>
        </>
      }
    >
      <Field label="Mobile number">
        <input
          className="input"
          inputMode="numeric"
          maxLength={10}
          placeholder="98xxxxxxxx"
          value={mobile}
          disabled={isEdit}
          autoFocus={!isEdit}
          onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
        />
        {phoneNote && <div style={{ marginTop: 6, fontSize: 12.5 }}>{phoneNote}</div>}
      </Field>

      <div className="form-row-2">
        <Field label="Full name">
          <input
            className="input"
            placeholder="e.g. Priya Verma"
            value={name}
            autoFocus={isEdit}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Date of birth">
          <input
            className="input"
            type="date"
            value={dob ?? ''}
            max={todayIso()}
            onChange={(e) => setDob(e.target.value)}
          />
        </Field>
      </div>

      <div className="form-row-2">
        <Field label="Gender">
          <div className="seg" role="group" aria-label="Gender">
            {[
              ['female', 'Female'],
              ['male', 'Male'],
              ['other', 'Other'],
            ].map(([v, label]) => (
              <button
                key={v}
                type="button"
                className={gender === v ? 'selected' : ''}
                onClick={() => setGender(v)}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Blood group (optional)">
          <select
            className="select"
            value={bloodGroup}
            onChange={(e) => setBloodGroup(e.target.value)}
          >
            <option value="">Not known</option>
            {BLOOD_GROUPS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {dupe && (
        <div className="dupe-warn" role="status">
          <div>
            <strong>Possible duplicate.</strong> {dupe.name}
            {ageFromDob(dupe.dob ?? null) != null ? ` · ${ageFromDob(dupe.dob ?? null)} yrs` : ''}{' '}
            already exists on {dupe.mobile}.
          </div>
          <button
            className="btn btn-sm"
            onClick={() => onSaved({ id: dupe.id, mobile: dupe.mobile }, false)}
          >
            Open
          </button>
        </div>
      )}

      <div className="form-row-2">
        <Field label="Ongoing conditions (comma separated)">
          <input
            className="input"
            placeholder="e.g. Hypertension, Asthma"
            value={conditions}
            onChange={(e) => setConditions(e.target.value)}
          />
        </Field>
        <Field label="Long-term medicines (comma separated)">
          <input
            className="input"
            placeholder="e.g. Amlodipine 5 mg · 1-0-0"
            value={longMeds}
            onChange={(e) => setLongMeds(e.target.value)}
          />
        </Field>
      </div>

      {error && (
        <div className="form-error" role="alert" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}
