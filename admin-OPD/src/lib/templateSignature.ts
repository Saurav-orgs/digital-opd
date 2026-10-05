import type { PrescriptionTemplate, TemplateMedicine } from '../api/types';
import type { PrescriptionMedicine } from '../api/types';

/**
 * A comparable fingerprint of "what this prescription actually says", used to
 * decide whether `Save as template` is worth offering.
 *
 * The prototype signs a prescription by its sorted medicine names alone. That
 * has a bug worth not copying: a prescription with no medicines signs as the
 * empty string, which equals the signature of any other medicine-less
 * template, so the button disappears on exactly the advice-led prescriptions
 * this feature was asked for. Signing on medicines **and** normalised advice
 * keeps those distinguishable.
 *
 * Advice is normalised rather than compared raw — a trailing full stop or a
 * doubled space is not a different template, and offering to save one as new
 * would fill the list with near-duplicates.
 */
function normaliseAdvice(advice: string | null | undefined): string {
  return (advice ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.;,]+$/, '')
    .trim();
}

function names(medicines: { medicine_name?: string }[]): string {
  return medicines
    .map((m) => (m.medicine_name ?? '').trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('|');
}

export function signPrescription(
  medicines: PrescriptionMedicine[],
  advice: string | null | undefined,
): string {
  return names(medicines) + '~' + normaliseAdvice(advice);
}

export function signTemplate(t: {
  medicines: TemplateMedicine[];
  advice: string | null;
}): string {
  return names(t.medicines) + '~' + normaliseAdvice(t.advice);
}

/**
 * Whether there is anything here worth saving as a template.
 *
 * A prescription with neither a medicine nor advice is not a template someone
 * would want back, whatever the diagnosis says.
 */
export function worthSaving(
  medicines: PrescriptionMedicine[],
  advice: string | null | undefined,
): boolean {
  return (
    medicines.some((m) => m.medicine_name?.trim()) || !!normaliseAdvice(advice)
  );
}

/** True when an existing template already says the same thing. */
export function matchesExisting(
  medicines: PrescriptionMedicine[],
  advice: string | null | undefined,
  templates: PrescriptionTemplate[],
): boolean {
  const mine = signPrescription(medicines, advice);
  return templates.some((t) => signTemplate(t) === mine);
}
