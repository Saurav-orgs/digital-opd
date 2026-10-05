/**
 * A medicine's name and its strength, as one field and as two.
 *
 * A doctor writes "Dolo 650mg", not a name in one box and a strength in
 * another. The stored shape keeps the two apart — the prescription PDF, the
 * medicine catalogue and the AI draft all read `strength` on its own — so the
 * single field is presentation only: joined for display, split again on every
 * keystroke.
 *
 * Lifted out of `PrescriptionEditor.tsx` when the template editor needed the
 * same field. Two copies of this split would eventually disagree about where
 * a name ends, and the templates exist to be copied into prescriptions.
 */

/** A trailing dose: a number and a unit, plus anything after it ("weekly"). */
const DOSE_SUFFIX = /\s+(\d+(?:\.\d+)?\s*(?:(?:mcg|mg|g|ml|iu|units?)\b|%).*)$/i;

export function joinMedicine(name: string, strength?: string | null): string {
  return [name, strength].map((p) => (p ?? '').trim()).filter(Boolean).join(' ');
}

export function splitMedicine(value: string): { medicine_name: string; strength: string } {
  const match = DOSE_SUFFIX.exec(value);
  // No recognisable dose yet — mid-typing "Dolo 65" is all name, and becomes
  // name + strength the moment the unit lands. What is displayed never changes
  // under the doctor either way, because display is the two joined back up.
  if (!match) return { medicine_name: value, strength: '' };
  return {
    medicine_name: value.slice(0, match.index).trim(),
    strength: match[1].trim(),
  };
}
