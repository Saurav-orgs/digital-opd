import { useState } from 'react';
import { Cake } from 'lucide-react';
import { ageFromDob, todayIso } from '../lib/dob';

/**
 * What the record actually holds: a date of birth, or an age for someone who
 * does not know one.
 *
 * The patient's record has always stored a date — an age typed once is wrong
 * within a year, a birth date never is — but every patient-side form asked for
 * an age, so a returning patient's own record could not fill the field in and
 * they typed it again at every booking.
 *
 * Asking only for a date would be worse: plenty of patients, and most elderly
 * ones, genuinely do not know their birth date, and a required field they
 * cannot answer is where a booking is abandoned. So both are offered, as two
 * labelled choices rather than a link. The first version hid the age behind
 * "I only know the age", which asked the patient to understand the problem
 * before they could see the way out of it; two buttons say what is on offer
 * without anyone having to work it out.
 *
 * Either answer is stored as a date — the server keeps an age as an estimated
 * birth date — so these are two ways of saying the same thing, not two kinds
 * of record.
 */
export function DobField({
  dob,
  age,
  onChangeDob,
  onChangeAge,
  required,
  error,
}: {
  dob: string;
  age: string;
  onChangeDob: (value: string) => void;
  onChangeAge: (value: string) => void;
  required?: boolean;
  error?: string | null;
}) {
  /*
   * Null until the patient picks a side; the value decides until then.
   *
   * Held this way rather than initialised from the props, because the props
   * arrive late: on the booking form the patient is chosen *after* this is
   * mounted, so a mode captured at mount showed an empty date box over a
   * record that had an age — which is the "it does not fetch what I entered
   * last time" this was reported as.
   */
  const [picked, setPicked] = useState<'dob' | 'age' | null>(null);
  const mode = picked ?? (dob ? 'dob' : age ? 'age' : 'dob');
  const derived = mode === 'dob' && dob ? ageFromDob(dob) : null;

  const choose = (next: 'dob' | 'age') => {
    if (next === mode) return;
    setPicked(next);
    // Switching is a change of question, not of answer: an age already known
    // from a date carries across rather than making the patient retype it.
    if (next === 'age') {
      if (dob) onChangeAge(String(ageFromDob(dob) ?? ''));
      onChangeDob('');
    } else {
      onChangeAge('');
    }
  };

  return (
    <div className="form-field">
      <label className="form-label icon-label">
        <Cake size={14} color="var(--text-secondary)" />
        <span>Date of Birth{required ? ' *' : ''}</span>
      </label>

      {/* Both options on screen, so nobody has to guess that the other one
          exists. The one in use is lit; tapping the other swaps the field. */}
      <div className="dob-switch" role="group" aria-label="Give a date of birth or an age">
        <button
          type="button"
          className={mode === 'dob' ? 'is-on' : ''}
          aria-pressed={mode === 'dob'}
          onClick={() => choose('dob')}
        >
          Date of birth
        </button>
        <button
          type="button"
          className={mode === 'age' ? 'is-on' : ''}
          aria-pressed={mode === 'age'}
          onClick={() => choose('age')}
        >
          Age in years
        </button>
      </div>

      {mode === 'dob' ? (
        <input
          type="date"
          className={'form-input' + (error ? ' error' : '')}
          value={dob}
          max={todayIso()}
          aria-label="Date of birth"
          onChange={(e) => onChangeDob(e.target.value)}
        />
      ) : (
        <input
          type="text"
          inputMode="numeric"
          maxLength={3}
          className={'form-input' + (error ? ' error' : '')}
          placeholder="e.g. 32"
          aria-label="Age in years"
          value={age}
          onChange={(e) => onChangeAge(e.target.value.replace(/\D/g, '').slice(0, 3))}
        />
      )}

      {/* The derived age is the check that the date picked is the right one —
          a mis-tapped year is otherwise invisible until the prescription. */}
      {derived != null && <span className="dob-note">{derived} years old</span>}
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}
