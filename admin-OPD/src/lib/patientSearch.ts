/**
 * Name matching for the patient list's search and the new-patient duplicate
 * check. Deliberately simple — case, surrounding space and internal runs of
 * space are normalised, and a query matches if it appears anywhere in the
 * normalised name. Nothing cleverer: a phonetic match here would warn "possible
 * duplicate" on two genuinely different people often enough to be ignored.
 */
export function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** True when `query` appears in `name`, both normalised. Empty query matches. */
export function matchesName(name: string, query: string): boolean {
  const q = normalizeName(query);
  return !q || normalizeName(name).includes(q);
}

/** Comma-separated input → a trimmed, non-empty, de-duplicated list. */
export function splitList(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of input.split(',')) {
    const t = part.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
