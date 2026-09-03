/**
 * Catching drug names that speech recognition got wrong.
 *
 * Dictation fails in a particular way: the name it returns *sounds* right and
 * reads as a real word. "Mounjaro" comes back as "Munger" — a plausible thing
 * to see in a list, and nothing about it looks like an error. Spelling
 * distance does not catch that pair (five edits apart), but a phonetic code
 * does: both are M526.
 *
 * So the check is: does this name appear in the clinic's own catalogue, and if
 * not, does something in the catalogue sound exactly like it?
 */

/** Letters that sound alike share a digit. Vowels and h/w carry none. */
const SOUNDEX_CODES: Record<string, string> = {
  b: '1', f: '1', p: '1', v: '1',
  c: '2', g: '2', j: '2', k: '2', q: '2', s: '2', x: '2', z: '2',
  d: '3', t: '3',
  l: '4',
  m: '5', n: '5',
  r: '6',
};

/**
 * Russell Soundex: first letter, then three digits for the consonants that
 * follow. Adjacent letters with the same code collapse to one — and a vowel
 * between them breaks that, while an h or w does not, which is the rule that
 * makes it forgiving of exactly the vowels dictation invents.
 */
export function soundex(input: string): string {
  const letters = input.toLowerCase().replace(/[^a-z]/g, '');
  if (!letters) return '';

  let result = letters[0].toUpperCase();
  let previous = SOUNDEX_CODES[letters[0]] ?? '';

  for (let i = 1; i < letters.length && result.length < 4; i++) {
    const letter = letters[i];
    const code = SOUNDEX_CODES[letter] ?? '';

    if (code && code !== previous) result += code;

    // 'h' and 'w' are transparent: the letters either side still count as
    // adjacent. Every other letter — vowels included — resets the run.
    if (letter !== 'h' && letter !== 'w') previous = code;
  }

  return result.padEnd(4, '0');
}

/** Case, spacing and punctuation are not differences worth reporting. */
export function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export interface MedicineIndex {
  /** The catalogue as displayed — ranked, deduplicated, for autocomplete. */
  names: string[];
  /** Every catalogue name, normalised, for the "do we know this?" test. */
  known: Set<string>;
  /** Phonetic code → the catalogue names that sound like it, most-used first. */
  bySound: Map<string, string[]>;
  /** False until the catalogue has loaded; nothing is judged before then. */
  ready: boolean;
}

export const emptyIndex: MedicineIndex = {
  names: [],
  known: new Set(),
  bySound: new Map(),
  ready: false,
};

/** `names` is expected in the catalogue's own order — most-prescribed first. */
export function buildMedicineIndex(names: string[]): MedicineIndex {
  const known = new Set<string>();
  const bySound = new Map<string, string[]>();

  for (const name of names) {
    const normalised = normaliseName(name);
    if (!normalised) continue;
    known.add(normalised);

    const code = soundex(normalised);
    if (!code) continue;
    const bucket = bySound.get(code);
    // Ranking is inherited from the catalogue, so first in wins.
    if (bucket) {
      if (!bucket.some((n) => normaliseName(n) === normalised)) bucket.push(name);
    } else {
      bySound.set(code, [name]);
    }
  }

  return { names, known, bySound, ready: true };
}

export interface MedicineCheck {
  /** The clinic has prescribed this name before. */
  known: boolean;
  /** Catalogue names that sound identical — "did you mean". */
  suggestions: string[];
}

const OK: MedicineCheck = { known: true, suggestions: [] };

/**
 * Two names sounding alike is only worth raising if they are also roughly the
 * same size. Soundex looks at four characters, so without this "Neo" would be
 * offered as a correction for a much longer name that happens to start the
 * same way.
 */
const MAX_LENGTH_GAP = 4;

/**
 * Autocomplete matches, from the catalogue already in memory.
 *
 * This used to be a request per row on mount and another on every keystroke.
 * The editor holds the whole catalogue anyway — it needs it to tell a real
 * medicine from a misheard one — so asking the server to filter a list the
 * client already has was only ever spending requests against the rate limit.
 */
export function suggestNames(query: string, index: MedicineIndex, limit = 20): string[] {
  const q = normaliseName(query);
  if (!q) return [];
  // The catalogue arrives ranked — the clinic's own most-prescribed first —
  // so filtering in order preserves that.
  const matches: string[] = [];
  for (const name of index.names) {
    if (normaliseName(name).includes(q)) matches.push(name);
    if (matches.length >= limit) break;
  }
  return matches;
}

export function checkMedicine(name: string, index: MedicineIndex): MedicineCheck {
  const normalised = normaliseName(name);
  // Nothing to say about an empty row, and nothing to say before the
  // catalogue has arrived — silence beats a warning that is merely early.
  if (!normalised || !index.ready) return OK;
  if (index.known.has(normalised)) return OK;

  const sameSound = index.bySound.get(soundex(normalised)) ?? [];
  const suggestions = sameSound
    .filter(
      (candidate) =>
        Math.abs(normaliseName(candidate).length - normalised.length) <= MAX_LENGTH_GAP,
    )
    .slice(0, 3);

  return { known: false, suggestions };
}
