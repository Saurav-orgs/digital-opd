/**
 * Initials and a tint for a patient avatar.
 *
 * Shared by the appointment list and the consultation screen so the same
 * person is the same colour in both — a doctor scanning the list and then
 * opening a visit should not have the circle change under them.
 */

/** "Priya Verma" → "PV". Falls back to one letter, then to a dash. */
export function initials(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

/*
 * The tint is picked off the name rather than the row index, so a patient
 * keeps the same colour as the list is filtered and re-sorted. It is
 * decoration only — nothing about the record is encoded in it.
 */
export function avatarTone(name: string | null | undefined) {
  let h = 0;
  for (const ch of name ?? '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `av-${h % 4}`;
}
