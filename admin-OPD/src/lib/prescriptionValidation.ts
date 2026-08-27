import type { PrescriptionMedicine } from '../api/types';

/** Fields a medicine row can carry an error on. */
export type MedicineField =
  | 'medicine_name'
  | 'strength'
  | 'dosage'
  | 'timing'
  | 'duration_days'
  | 'instructions';

export type HeaderField = 'diagnosis' | 'advice' | 'follow_up_date';

export interface PrescriptionErrors {
  /** Errors on the diagnosis/advice/follow-up block. */
  header: Partial<Record<HeaderField, string>>;
  /** Errors per medicine row, keyed by its index in the editor. */
  rows: Record<number, Partial<Record<MedicineField, string>>>;
  /** What to show in the toast — names the field that needs attention. */
  summary?: string;
}

/** Labels exactly as they read on screen, so the toast matches the input. */
const MEDICINE_LABELS: Record<MedicineField, string> = {
  medicine_name: 'Medicine name',
  strength: 'Strength',
  // Field stays `dosage` on the wire (the AI returns that key); only the
  // label the client asked for changed.
  dosage: 'Frequency',
  timing: 'Timing',
  duration_days: 'Duration (days)',
  instructions: 'Special instructions',
};

const HEADER_LABELS: Record<HeaderField, string> = {
  diagnosis: 'Diagnosis',
  advice: 'Advice',
  follow_up_date: 'Follow-up date',
};

export const noErrors = (): PrescriptionErrors => ({ header: {}, rows: {} });

export const hasErrors = (e: PrescriptionErrors) =>
  !!e.summary ||
  Object.keys(e.header).length > 0 ||
  Object.values(e.rows).some((r) => Object.keys(r).length > 0);

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** A row the doctor has actually started filling in — blank rows are ignored. */
export function rowHasContent(r: PrescriptionMedicine): boolean {
  return (
    !!text(r.medicine_name) ||
    !!text(r.strength) ||
    !!text(r.dosage) ||
    !!text(r.timing) ||
    !!text(r.instructions) ||
    r.duration_days != null
  );
}

/** How the row is referred to in messages: "Medicine #2 (Paracetamol)". */
function rowLabel(r: PrescriptionMedicine, index: number): string {
  const name = text(r.medicine_name);
  return `Medicine #${index + 1}${name ? ` (${name})` : ''}`;
}

/**
 * Checks the draft the same way the API does, but *before* sending it, so a
 * missing frequency reads as "Please fill Frequency for Medicine #2" next to the
 * actual input instead of a generic failure toast after the round trip.
 *
 * `mode: 'save'` only enforces what blocks a draft from being stored;
 * `mode: 'issue'` also enforces everything the API requires to issue.
 */
export function validatePrescription(
  form: { diagnosis: string; advice: string; follow_up_date: string },
  rows: PrescriptionMedicine[],
  mode: 'save' | 'issue',
): PrescriptionErrors {
  const errors = noErrors();
  const filled = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => rowHasContent(row));

  const setRow = (index: number, field: MedicineField, message: string) => {
    errors.rows[index] = { ...errors.rows[index], [field]: message };
    if (!errors.summary) errors.summary = `${rowLabel(rows[index], index)} — ${message}`;
  };

  const setHeader = (field: HeaderField, message: string) => {
    errors.header[field] = message;
    if (!errors.summary) errors.summary = message;
  };

  for (const { row, index } of filled) {
    const name = text(row.medicine_name);
    if (!name) {
      setRow(index, 'medicine_name', 'Please enter the medicine name.');
    } else if (name.length < 2) {
      setRow(index, 'medicine_name', 'Medicine name needs at least 2 characters.');
    }

    if (mode === 'issue' && !text(row.dosage)) {
      setRow(index, 'dosage', 'Please fill the frequency, e.g. 1-0-1.');
    }

    const days = row.duration_days;
    if (days != null && (!Number.isInteger(days) || days < 1 || days > 365)) {
      setRow(index, 'duration_days', 'Duration must be a whole number of days between 1 and 365.');
    }
  }

  if (form.follow_up_date && !/^\d{4}-\d{2}-\d{2}$/.test(form.follow_up_date)) {
    setHeader('follow_up_date', 'Please pick a valid follow-up date.');
  }

  if (mode === 'issue' && filled.length === 0 && !text(form.advice)) {
    errors.summary =
      errors.summary ?? 'Add at least one medicine, or some advice, before issuing.';
    errors.header.advice = 'Add at least one medicine, or some advice, before issuing.';
  }

  return errors;
}

/**
 * Places a server-side validation failure on the field it belongs to.
 *
 * The API answers 422 with `details: [{ field: 'medicines.0.dosage', messages }]`,
 * so the same inline slot can carry it — otherwise it would surface only as a
 * toast with no indication of which row is wrong.
 */
export function errorsFromApiDetails(
  details: unknown,
  /** Payload row → editor row, since blank rows are dropped before sending. */
  sentRowIndexes?: number[],
): PrescriptionErrors {
  const errors = noErrors();
  if (!Array.isArray(details)) return errors;

  for (const entry of details) {
    const field = (entry as { field?: unknown })?.field;
    const messages = (entry as { messages?: unknown })?.messages;
    if (typeof field !== 'string' || !Array.isArray(messages) || !messages.length) continue;
    const message = String(messages[0]);

    const medicine = /^medicines\.(\d+)\.(\w+)$/.exec(field);
    if (medicine) {
      const sent = Number(medicine[1]);
      const index = sentRowIndexes?.[sent] ?? sent;
      const key = medicine[2] as MedicineField;
      if (key in MEDICINE_LABELS) {
        errors.rows[index] = { ...errors.rows[index], [key]: message };
        if (!errors.summary) {
          errors.summary = `Medicine #${index + 1} · ${MEDICINE_LABELS[key]} — ${message}`;
        }
      }
      continue;
    }

    if (field in HEADER_LABELS) {
      const key = field as HeaderField;
      errors.header[key] = message;
      if (!errors.summary) errors.summary = `${HEADER_LABELS[key]} — ${message}`;
    }
  }

  return errors;
}
