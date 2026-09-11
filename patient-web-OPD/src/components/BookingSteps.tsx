import React from 'react';

/*
 * The booking journey as the patient sees it: pick a slot, register, attach
 * reports. It is deliberately coarser than the machinery underneath — the
 * "Register" stage still runs the existing mobile → password → who-is-this-for
 * → details sequence, and BookingForm still owns that. This only names the
 * three stages, so the stepper and the step machine can disagree in detail
 * without either having to change.
 */
export const BOOKING_STAGES = ['Slot', 'Register', 'Reports'] as const;

export type BookingStage = 1 | 2 | 3;

export const BookingSteps: React.FC<{
  /** Which stage the patient is on, 1-indexed. */
  current: BookingStage;
  /** Called when a completed stage is tapped; omit to make the strip inert. */
  onGoTo?: (stage: BookingStage) => void;
}> = ({ current, onGoTo }) => (
  <ol className="steps" aria-label="Booking progress">
    {BOOKING_STAGES.map((label, i) => {
      const stage = (i + 1) as BookingStage;
      const done = stage < current;
      const active = stage === current;
      const state = done ? 'done' : active ? 'active' : 'locked';
      // Only a stage already completed can be jumped back to; going forward is
      // the Continue button's job, because it is what validates.
      const clickable = done && !!onGoTo;

      return (
        <React.Fragment key={label}>
          {i > 0 && <li className={`step-track ${done || active ? 'done' : ''}`} aria-hidden />}
          <li
            className={`step ${state}`}
            aria-current={active ? 'step' : undefined}
            {...(clickable
              ? { role: 'button', tabIndex: 0, onClick: () => onGoTo(stage) }
              : {})}
          >
            <span className="step-dot" aria-hidden>
              {done ? '✓' : stage}
            </span>
            <span className="step-label">{label}</span>
          </li>
        </React.Fragment>
      );
    })}
  </ol>
);
