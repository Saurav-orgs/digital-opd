import { useEffect } from 'react';
import { CheckCircleIcon } from './icons';

/**
 * A confirmation that shows itself in the middle of the screen for a moment
 * and goes away on its own.
 *
 * Different from a toast on purpose. The toast stack sits in a corner for
 * several seconds and is meant to be ignorable; this is for the one change a
 * clinic will be asked about later — "when did you move my appointment to?"
 * — where the client wanted the answer put in front of the doctor for a
 * beat, not tucked away. Tapping it dismisses it early.
 */
export function FlashNotice({
  title,
  message,
  onDone,
  ms = 1600,
}: {
  title: string;
  message?: string;
  onDone: () => void;
  ms?: number;
}) {
  useEffect(() => {
    const t = setTimeout(onDone, ms);
    return () => clearTimeout(t);
  }, [onDone, ms]);

  return (
    <div className="flash-backdrop" onClick={onDone} role="status" aria-live="polite">
      <div className="flash-notice">
        <span className="flash-icon" aria-hidden>
          <CheckCircleIcon size={26} />
        </span>
        <div className="flash-title">{title}</div>
        {message && <div className="flash-msg">{message}</div>}
      </div>
    </div>
  );
}
