import { useState } from 'react';
import { Cake } from 'lucide-react';
import { ageFromDob, dobFromAge, todayIso } from '../lib/dob';

/**
 * A patient's age, asked for either way round.
 *
 * The record keeps a date of birth — an age typed once is wrong within a year,
 * a birth date never is — but plenty of patients, and most elderly ones, do
 * not know theirs. So both are offered, as two labelled choices rather than a
 * link: the first version hid the age behind "I only know the age", which
 * asked the patient to understand the problem before they could see the way
 * out of it.
 *
 * **There is one value underneath**, the date. The age box is a second way of
 * typing it: 32 means "born 32 years ago today", which is exactly what the
 * server would store for an age anyway. Switching therefore cannot lose
 * anything, which it could when this held a date and an age separately and
 * cleared whichever one you turned away from.
 */
export function DobField({
  value,
  onChange,
  required,
  error,
}: {
  /** The date of birth, YYYY-MM-DD, or '' when nothing has been given. */
  value: string;
  onChange: (dob: string) => void;
  required?: boolean;
  error?: string | null;
}) {
  /*
   * Null until the patient picks a side; the value decides until then.
   *
   * Not initialised from the value, because the value arrives late: on the
   * booking form the patient is chosen *after* this is mounted, so a mode
   * captured at mount showed an empty box over a record that had an answer.
   */
  const [picked, setPicked] = useState<'dob' | 'age' | null>(null);
  const mode = picked ?? 'dob';
  const age = ageFromDob(value);

  return (
    <div className="form-field">
      <label className="form-label icon-label">
        <Cake size={14} color="var(--text-secondary)" />
        <span>Date of Birth{required ? ' *' : ''}</span>
      </label>

      {/* Both options on screen, so nobody has to guess the other exists. */}
      <div className="dob-switch" role="group" aria-label="Give a date of birth or an age">
        <button
          type="button"
          className={mode === 'dob' ? 'is-on' : ''}
          aria-pressed={mode === 'dob'}
          onClick={() => setPicked('dob')}
        >
          Date of birth
        </button>
        <button
          type="button"
          className={mode === 'age' ? 'is-on' : ''}
          aria-pressed={mode === 'age'}
          onClick={() => setPicked('age')}
        >
          Age in years
        </button>
      </div>

      {mode === 'dob' ? (
        <input
          type="date"
          className={'form-input' + (error ? ' error' : '')}
          value={value}
          max={todayIso()}
          aria-label="Date of birth"
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          type="text"
          inputMode="numeric"
          maxLength={3}
          className={'form-input' + (error ? ' error' : '')}
          placeholder="e.g. 32"
          aria-label="Age in years"
          // Shown from the date, written back as a date: the box edits the
          // same value the picker does, so neither can go stale.
          value={age == null ? '' : String(age)}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '').slice(0, 3);
            onChange(digits === '' ? '' : (dobFromAge(Number(digits)) ?? ''));
          }}
        />
      )}

      {/* In date mode, the age it works out to is the check that the year was
          not mis-tapped — invisible otherwise until it reaches a prescription. */}
      {mode === 'dob' && age != null && (
        <span className="dob-note">{age} years old</span>
      )}
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}
