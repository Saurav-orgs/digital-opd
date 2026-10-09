import { useEffect, useMemo, useState } from 'react';
import type { PrescriptionMedicine } from '../api/types';
import { formatDuration, parseDuration } from '../lib/duration';
import { checkMedicine, suggestNames, type MedicineIndex } from '../lib/medicineCheck';
import type { MedicineField } from '../lib/prescriptionValidation';

/**
 * One medicine line, shared by the prescription editor and the template
 * editor.
 *
 * Five columns — Medicine · Dose · Frequency · Duration · Remarks — matching
 * the design's own grid, with the labels in a header row above rather than
 * repeated on every line. Below 768px the grid collapses and each row becomes
 * a card, which is where the labels come back as placeholders.
 *
 * Name and dose are **separate fields**. An earlier round joined them into one
 * box ("Dolo 650mg") on the reasoning that it is how a doctor writes; the
 * design puts them in their own columns, and the stored shape was always two
 * fields, so this is now a straight mapping. `lib/medicineName.ts` still
 * splits a joined string for dictation and AI drafts, which do arrive as one
 * phrase.
 */
export type MedicineRowValue = PrescriptionMedicine & {
  /**
   * The duration as the doctor typed it, kept only by templates. A course of
   * "Continue" has no number to store, and a smallint cannot hold it.
   */
  duration_text?: string | null;
};

/** The column labels, above the rows rather than inside each one. */
export function MedicineHead() {
  return (
    <div className="med-head" aria-hidden>
      <div>Medicine</div>
      <div>Dose</div>
      <div>Frequency</div>
      <div>Duration</div>
      {/* "(if any)" because it is the one column a doctor can leave empty —
          the grid gave no hint of that, so it read as a field to fill. */}
      <div>Remarks (if any)</div>
      <div />
    </div>
  );
}

export function MedicineRow({
  row,
  listId,
  errors,
  medicineIndex,
  canEdit,
  freeDuration,
  onChange,
  onRemove,
}: {
  row: MedicineRowValue;
  /**
   * Stable for the life of the row. The datalist used to be keyed on the
   * medicine name, so it was a different element after every keystroke and
   * the browser closed the suggestions as fast as it opened them.
   */
  listId: string;
  errors?: Partial<Record<MedicineField, string>>;
  medicineIndex: MedicineIndex;
  canEdit: boolean;
  /**
   * Accept a duration that is not a number of days — "Continue", "As
   * needed". Templates allow it, prescriptions do not: a printed course
   * length has to be a period the patient can count.
   */
  freeDuration?: boolean;
  onChange: (patch: Partial<MedicineRowValue>) => void;
  onRemove: () => void;
}) {
  /*
   * Autocomplete comes from the catalogue the editor already holds, not from a
   * request per keystroke. The old version fired one search per row on mount
   * and another on every character typed, which on a four-medicine draft was
   * enough on its own to trip the API's rate limit.
   */
  const suggestions = useMemo(
    () =>
      (row.medicine_name ?? '').length >= 2
        ? suggestNames(row.medicine_name ?? '', medicineIndex)
        : [],
    [row.medicine_name, medicineIndex],
  );

  const fromAi = row.source === 'ai';

  /*
   * Dictation does not fail by producing gibberish — it produces a real word
   * that sounds right ("Mounjaro" heard as "Munger"), which reads as perfectly
   * plausible in a list of medicines. So the name is checked against what this
   * clinic actually prescribes before it can be issued.
   *
   * A name the doctor typed themselves is only questioned when something in
   * the catalogue sounds exactly like it. Nagging them for prescribing
   * something new would be wrong — and would train them to ignore the warning
   * that matters.
   */
  const check = checkMedicine(row.medicine_name, medicineIndex);
  const showWarning = !check.known && (fromAi || check.suggestions.length > 0);

  /*
   * Duration is typed as words — "5 days", "2 weeks" — and stored as days.
   * The text is the row's own while it is being typed; it is only rewritten
   * from the number when the number changes underneath it (an AI draft
   * landing, Clear all), never as the parsed echo of what was just typed.
   */
  const [durationText, setDurationText] = useState(
    row.duration_text ?? formatDuration(row.duration_days),
  );
  useEffect(() => {
    const typed = parseDuration(durationText);
    const held = row.duration_days ?? null;
    if (Number.isNaN(typed) && Number.isNaN(held)) return;
    if (typed !== held) setDurationText(row.duration_text ?? formatDuration(held));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.duration_days]);
  const durationUnreadable =
    !freeDuration && !!durationText.trim() && Number.isNaN(parseDuration(durationText));

  const invalid = errors?.medicine_name ?? errors?.strength ?? errors?.dosage ?? errors?.duration_days;

  return (
    <>
      <div className={`med ${fromAi ? 'from-ai' : ''} ${invalid ? 'has-error' : ''}`}>
        <input
          className="input"
          list={listId}
          placeholder="Medicine"
          aria-label="Medicine"
          disabled={!canEdit}
          value={row.medicine_name ?? ''}
          onChange={(e) => onChange({ medicine_name: e.target.value })}
        />
        <datalist id={listId}>
          {suggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>

        <input
          className="input"
          placeholder="650 mg"
          aria-label="Dose"
          disabled={!canEdit}
          value={row.strength ?? ''}
          onChange={(e) => onChange({ strength: e.target.value })}
        />

        <input
          className="input"
          placeholder="1-0-1"
          aria-label="Frequency"
          disabled={!canEdit}
          value={row.dosage ?? ''}
          onChange={(e) => onChange({ dosage: e.target.value })}
        />

        <input
          className="input"
          type="text"
          autoComplete="off"
          placeholder={freeDuration ? 'Continue' : '5 days'}
          aria-label="Duration"
          disabled={!canEdit}
          value={durationText}
          onChange={(e) => {
            const text = e.target.value;
            setDurationText(text);
            const days = parseDuration(text);
            // NaN marks text that is not a duration. A prescription refuses it
            // at validation; a template keeps the words and stores no number,
            // which is what `duration_text` is for.
            onChange(
              freeDuration
                ? {
                    duration_days: Number.isNaN(days) ? null : days,
                    duration_text: text.trim() || null,
                  }
                : { duration_days: days },
            );
          }}
          onBlur={() => {
            // "2 wk" → "2 weeks", the way it will print.
            const n = parseDuration(durationText);
            if (n != null && !Number.isNaN(n)) {
              const tidy = formatDuration(n);
              setDurationText(tidy);
              if (freeDuration) onChange({ duration_text: tidy });
            }
          }}
        />

        {/* Always present, not folded behind a link. It is a column in the
            design's grid, and "After food" is on most lines a doctor writes. */}
        <input
          className="input"
          placeholder="After food"
          aria-label="Remarks (if any)"
          disabled={!canEdit}
          value={row.instructions ?? ''}
          onChange={(e) => onChange({ instructions: e.target.value })}
        />

        {canEdit ? (
          <button
            type="button"
            className="med-rm"
            onClick={onRemove}
            title="Remove medicine"
            aria-label="Remove medicine"
          >
            <TrashGlyph />
          </button>
        ) : (
          <span />
        )}
      </div>

      {fromAi && <span className="med-ai-tag">AI suggested</span>}

      {(invalid || durationUnreadable) && (
        <div className="med-error">
          {invalid ?? 'Try "5 days" or "2 weeks"'}
        </div>
      )}

      {/*
        Dictation does not fail by producing gibberish — it produces a real
        word that sounds right, which reads as perfectly plausible in a list of
        medicines. The warning sits under the row rather than inside the name
        field, where the design has no room.
      */}
      {showWarning && (
        <div className="med-warning">
          {check.suggestions.length > 0 ? (
            <>
              <span>Sounds like a medicine you prescribe — did you mean:</span>
              {check.suggestions.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="med-suggest"
                  disabled={!canEdit}
                  onClick={() => onChange({ medicine_name: name })}
                >
                  {name}
                </button>
              ))}
            </>
          ) : (
            <span>Not in your medicine list — check the spelling before issuing.</span>
          )}
        </div>
      )}
    </>
  );
}

function TrashGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7h16M10 11v6M14 11v6M5 7l1 13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-13M9 7V4h6v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
