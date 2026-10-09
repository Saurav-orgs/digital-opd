import { useState } from 'react';
import { Copy, Pencil, Plus, X } from 'lucide-react';

/** One session on one day. */
export interface DaySlot {
  start_time: string;
  end_time: string;
}

/**
 * A day's opening hours. `saved` is what separates "I have set this day up"
 * from "I have not touched it": an untouched day is a day off, and the editor
 * must not treat a half-typed row as one.
 */
export interface DayAvailability {
  slots: DaySlot[];
  saved: boolean;
}

/** Keyed by `day_of_week`: 0 = Sunday … 6 = Saturday, matching opd_schedules. */
export type DayTimings = Record<number, DayAvailability>;

/** Monday first — a working week reads that way, even though Sunday is 0. */
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const DAY_LABEL: Record<number, string> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
};

const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/** "09:00" → "9:00 AM". */
export function prettyTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h)) return t;
  const suffix = h < 12 ? 'AM' : 'PM';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/**
 * One entry per session: "10:00 AM – 2:00 PM", "5:00 PM – 7:00 PM".
 *
 * The row head joins them with a comma, as the design has it. They were
 * stacked one per line for a while; the design team's own screen puts a split
 * day on a single line, and the rows are tighter for it.
 */
export function summariseSlots(slots: DaySlot[]): string[] {
  return slots.map((s) => `${prettyTime(s.start_time)} – ${prettyTime(s.end_time)}`);
}

/** An error message, or null when the day is fit to save. */
export function validateDay(slots: DaySlot[]): string | null {
  if (!slots.length) return 'Add at least one time slot.';
  for (const s of slots) {
    if (!s.start_time || !s.end_time) {
      return 'Every slot needs both an opening and a closing time.';
    }
    if (toMinutes(s.end_time) <= toMinutes(s.start_time)) {
      return 'A slot must close later than it opens.';
    }
  }
  const sorted = [...slots].sort((a, b) => a.start_time.localeCompare(b.start_time));
  for (let i = 1; i < sorted.length; i++) {
    if (toMinutes(sorted[i].start_time) < toMinutes(sorted[i - 1].end_time)) {
      return 'Two slots on this day overlap.';
    }
  }
  return null;
}

/** Days that have been set up. Everything else is a day off. */
export function workingDays(timings: DayTimings): number[] {
  return DAY_ORDER.filter((d) => timings[d]?.saved && timings[d].slots.length > 0);
}

function blankDay(): DayAvailability {
  // The client's usual morning OPD, so most days need no typing at all.
  return { slots: [{ start_time: '10:00', end_time: '14:00' }], saved: false };
}

/**
 * Opening hours, one day at a time.
 *
 * The old form asked for a set of weekdays and one window to apply to all of
 * them, which is not how a practice runs: Monday may be 10:00–14:00 and
 * 17:00–19:00 while Saturday is a single morning. Each day owns its own list of
 * sessions here, and "apply to all days" is offered for the common case rather
 * than assumed for every case.
 *
 * A day is only a working day once it is **saved**, so a day left alone is a
 * day off and nothing has to be un-ticked to make it one. `opd_schedules`
 * already allowed several rows per weekday, so this needed no schema change.
 */
export function DayAvailabilityEditor({
  timings,
  onChange,
  onNotify,
}: {
  timings: DayTimings;
  onChange: (next: DayTimings) => void;
  /** Confirms a save or a bulk apply — a toast at the call site. */
  onNotify?: (message: string) => void;
}) {
  // One day open at a time, so the list stays scannable.
  const [openDay, setOpenDay] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});

  const entry = (day: number) => timings[day] ?? blankDay();

  const patch = (day: number, next: DayAvailability) => {
    onChange({ ...timings, [day]: next });
  };

  const setSlot = (day: number, idx: number, field: keyof DaySlot, value: string) => {
    const e = entry(day);
    patch(day, {
      // Editing re-opens the question of whether the day is right, so it stops
      // counting as saved until it is saved again.
      saved: false,
      slots: e.slots.map((s, i) => (i === idx ? { ...s, [field]: value } : s)),
    });
    setErrors((p) => ({ ...p, [day]: '' }));
  };

  const addSlot = (day: number) => {
    const e = entry(day);
    patch(day, { saved: false, slots: [...e.slots, { start_time: '17:00', end_time: '19:00' }] });
  };

  const removeSlot = (day: number, idx: number) => {
    const e = entry(day);
    patch(day, { saved: false, slots: e.slots.filter((_, i) => i !== idx) });
  };

  const saveDay = (day: number) => {
    const e = entry(day);
    const err = validateDay(e.slots);
    if (err) {
      setErrors((p) => ({ ...p, [day]: err }));
      return;
    }
    patch(day, { ...e, saved: true });
    setErrors((p) => ({ ...p, [day]: '' }));
    setOpenDay(null);
    onNotify?.(`${DAY_LABEL[day]} timings saved`);
  };

  const applyToAll = (day: number) => {
    const e = entry(day);
    const err = validateDay(e.slots);
    if (err) {
      setErrors((p) => ({ ...p, [day]: err }));
      return;
    }
    const next: DayTimings = {};
    for (const d of DAY_ORDER) {
      // Copied, never shared: editing Tuesday later must not rewrite Monday.
      next[d] = { saved: true, slots: e.slots.map((s) => ({ ...s })) };
    }
    onChange(next);
    setOpenDay(null);
    onNotify?.(`${DAY_LABEL[day]}'s timings applied to every day`);
  };

  const clearDay = (day: number) => {
    const next = { ...timings };
    delete next[day];
    onChange(next);
    setOpenDay(null);
    onNotify?.(`${DAY_LABEL[day]} set as a day off`);
  };

  return (
    <div className="day-rows">
      {DAY_ORDER.map((day) => {
        const e = entry(day);
        const isOpen = openDay === day;
        const isSet = !!timings[day]?.saved;
        return (
          <div key={day} className={`day-row ${isOpen ? 'open' : ''}`}>
            {/*
              The whole head opens the day, with the Edit button drawn inside
              it rather than beside it — a button inside a button is invalid
              markup, and splitting them would leave the row's own 44px of
              target doing nothing. It reads and behaves as the design's Edit
              button; the row around it is a larger target for the same thing.
            */}
            <button
              type="button"
              className="day-row-head"
              onClick={() => setOpenDay(isOpen ? null : day)}
              aria-expanded={isOpen}
            >
              <span className="dr-day">{DAY_LABEL[day]}</span>
              {/*
                While a day is open its own draft is the summary, even before
                it is saved — editing a saved day flips it to unsaved, and the
                head then read "Day off" over a form full of times. Only the
                colour distinguishes the two: a day that is really set is in
                full ink, a draft stays muted until Save.
              */}
              <span className={`dr-summary ${isSet ? 'set' : ''}`}>
                {isSet || isOpen
                  ? summariseSlots(e.slots).join(', ')
                  : 'Day off — no timings set'}
              </span>
              <span className="dr-edit">
                <Pencil size={13} aria-hidden /> Edit
              </span>
            </button>

            {isOpen && (
              <div className="day-row-body">
                {e.slots.map((slot, i) => (
                  <div key={i} className="tg-slot">
                    <div className="tg-field">
                      <label className="form-label">Opens</label>
                      <input
                        className="input"
                        type="time"
                        value={slot.start_time}
                        onChange={(ev) => setSlot(day, i, 'start_time', ev.target.value)}
                      />
                    </div>
                    <div className="tg-field">
                      <label className="form-label">Closes</label>
                      <input
                        className="input"
                        type="time"
                        value={slot.end_time}
                        onChange={(ev) => setSlot(day, i, 'end_time', ev.target.value)}
                      />
                    </div>
                    {/* Rendered even when there is only one session, disabled:
                        the column has to hold its width or the two time fields
                        jump sideways as sessions come and go. */}
                    <button
                      type="button"
                      className="tg-rm"
                      disabled={e.slots.length < 2}
                      title="Remove this time slot"
                      aria-label={`Remove time slot ${i + 1} on ${DAY_LABEL[day]}`}
                      onClick={() => removeSlot(day, i)}
                    >
                      <X size={16} aria-hidden />
                    </button>
                  </div>
                ))}

                {errors[day] && <div className="field-err">{errors[day]}</div>}

                <div className="tg-acts">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => saveDay(day)}
                  >
                    Save {DAY_LABEL[day]}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => applyToAll(day)}>
                    <Copy size={14} aria-hidden /> Apply to all days
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => addSlot(day)}>
                    <Plus size={14} aria-hidden /> Add another time slot
                  </button>
                  <span className="tg-acts-gap" />
                  {isSet && (
                    <button type="button" className="dr-clear" onClick={() => clearDay(day)}>
                      Clear {DAY_LABEL[day]}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
