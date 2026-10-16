import { useEffect, useRef } from 'react';

/**
 * Three scrolling columns instead of a native date box.
 *
 * The desk types a birth date for nearly every walk-in, and a native
 * `type="date"` makes that four interactions: open the calendar, page back
 * through 300-odd months, find the day, confirm. For an 80-year-old patient it
 * is 700 pages. Typing into it is worse — the segmented field wants the
 * browser's own order and silently rejects a year typed before a month.
 *
 * So: day, month and year as separate wheels, each one flick from anywhere in
 * its range, with the committed value always being exactly the three rows
 * under the band. There is no draft state to get out of step.
 */

/**
 * Row height, and the only number shared with the stylesheet: the column's
 * height and padding are five rows and two rows of it, so `--dob-row` in
 * index.css has to change with it or the band stops lining up with a row.
 */
const ROW_H = 34;
/** Oldest birth year offered. Beyond this it is a typo, not a patient. */
const MAX_AGE = 120;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

type Parts = { year: number; month: number; day: number };

/** Day 0 of the next month is the last day of this one. */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toIso({ year, month, day }: Parts): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parseIso(iso: string): Parts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

function todayParts(): Parts {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/**
 * Keep the three wheels on a date that can actually be a birth date: a real
 * day of that month, and not in the future.
 *
 * Clamping rather than refusing, because every wheel position has to mean
 * something — a column parked on 31 while the month wheel moves to February
 * has to land on the 28th, not on nothing.
 */
function legal(p: Parts, max: Parts): Parts {
  const year = clamp(p.year, max.year - MAX_AGE, max.year);
  const month = clamp(p.month, 1, 12);
  const day = clamp(p.day, 1, daysInMonth(year, month));
  if (year === max.year) {
    if (month > max.month) return { year, month: max.month, day: clamp(day, 1, max.day) };
    if (month === max.month && day > max.day) return { year, month, day: max.day };
  }
  return { year, month, day };
}

function ageIn(dob: Parts, today: Parts): number {
  let age = today.year - dob.year;
  if (today.month < dob.month || (today.month === dob.month && today.day < dob.day)) age--;
  return age;
}

export function DobWheel({
  value,
  onChange,
}: {
  /** The date of birth, YYYY-MM-DD, or '' when nothing has been given yet. */
  value: string;
  onChange: (dob: string) => void;
}) {
  const today = todayParts();
  const given = parseIso(value);
  /*
   * Unset still has to show something, so the wheels park on a middle-aged
   * date and the field stays empty until a column is actually moved. The note
   * under the wheels says which of the two states this is; the step's footer
   * button stays disabled meanwhile, as it did with the date box.
   */
  const parts = given ?? legal({ year: today.year - 30, month: 1, day: 1 }, today);

  const years: number[] = [];
  for (let y = today.year - MAX_AGE; y <= today.year; y++) years.push(y);

  /*
   * The columns stop where the calendar does, rather than offering a row that
   * would only be clamped back: in this year there is no December yet, and in
   * this month no tomorrow. A wheel that springs back from a row you just
   * scrolled to reads as a bug, so the row is simply not there.
   */
  const thisYear = parts.year === today.year;
  const months = thisYear ? MONTHS.slice(0, today.month) : MONTHS;
  const lastDay =
    thisYear && parts.month === today.month ? today.day : daysInMonth(parts.year, parts.month);
  const days: number[] = [];
  for (let d = 1; d <= lastDay; d++) days.push(d);

  const pick = (next: Parts) => onChange(toIso(legal(next, today)));
  const age = given ? ageIn(given, today) : null;

  return (
    <>
      <div className={`dob-wheel${given ? '' : ' is-unset'}`}>
        <div className="dob-wheel-heads" aria-hidden="true">
          <span>Day</span>
          <span>Month</span>
          <span>Year</span>
        </div>
        <div className="dob-wheel-body">
          {/* The band is the answer: whatever sits inside it is the value. */}
          <div className="dob-wheel-band" aria-hidden="true" />
          <Column
            label="Day"
            index={parts.day - 1}
            options={days.map(String)}
            onPick={(i) => pick({ ...parts, day: i + 1 })}
          />
          <Column
            label="Month"
            index={parts.month - 1}
            options={months}
            onPick={(i) => pick({ ...parts, month: i + 1 })}
          />
          <Column
            label="Year"
            index={years.indexOf(parts.year)}
            options={years.map(String)}
            onPick={(i) => pick({ ...parts, year: years[i] })}
          />
        </div>
      </div>
      <span className="hint">
        {age == null
          ? 'Scroll a column to set the date of birth'
          : `${parts.day} ${MONTHS[parts.month - 1]} ${parts.year} · ${age} ${
              age === 1 ? 'year' : 'years'
            } old`}
      </span>
    </>
  );
}

/**
 * One wheel.
 *
 * Native overflow scrolling with CSS snap rather than a drag handler: it gets
 * touch momentum, the trackpad, the mouse wheel and the scrollbar keys for
 * free, and on a phone the browser's own fling physics are better than
 * anything re-implemented on top of pointer events.
 */
function Column({
  label,
  options,
  index,
  onPick,
}: {
  label: string;
  options: string[];
  /** Which row is under the band. */
  index: number;
  onPick: (index: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settling = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Park the column on the selected row. Skipped when it is already on that
  // row — otherwise the scroll a flick has just finished would be yanked back
  // to the top of the row it landed on, which reads as a stutter.
  useEffect(() => {
    const el = ref.current;
    if (!el || index < 0) return;
    const top = index * ROW_H;
    if (Math.abs(el.scrollTop - top) < ROW_H / 2) return;
    el.scrollTop = top;
  }, [index]);

  // Committed when the scrolling stops, not on every frame: a flick past 40
  // years would otherwise fire 40 changes, each one re-rendering the parent
  // and re-clamping the day.
  const onScroll = () => {
    if (settling.current) clearTimeout(settling.current);
    settling.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const landed = clamp(Math.round(el.scrollTop / ROW_H), 0, options.length - 1);
      if (landed !== index) onPick(landed);
    }, 110);
  };

  useEffect(
    () => () => {
      if (settling.current) clearTimeout(settling.current);
    },
    [],
  );

  const step = (delta: number) => onPick(clamp(index + delta, 0, options.length - 1));

  return (
    <div
      ref={ref}
      className="dob-wheel-col"
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={(e) => {
        const by =
          e.key === 'ArrowDown'
            ? 1
            : e.key === 'ArrowUp'
              ? -1
              : e.key === 'PageDown'
                ? 10
                : e.key === 'PageUp'
                  ? -10
                  : 0;
        if (by) {
          // The column scrolls itself; letting the page scroll too would move
          // the wheel out from under the hand.
          e.preventDefault();
          step(by);
        } else if (e.key === 'Home') {
          e.preventDefault();
          onPick(0);
        } else if (e.key === 'End') {
          e.preventDefault();
          onPick(options.length - 1);
        }
      }}
    >
      {options.map((option, i) => (
        <div
          key={option}
          role="option"
          aria-selected={i === index}
          className={`dob-wheel-opt${i === index ? ' is-on' : ''}`}
          // A tap on a visible row is faster than scrolling it into the band.
          onClick={() => onPick(i)}
        >
          {option}
        </div>
      ))}
    </div>
  );
}
