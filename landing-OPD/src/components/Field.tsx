import { useId, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string | null;
}

/**
 * A labelled input. The label is always visible — a placeholder disappears
 * the moment someone types, which is exactly when they need to know what the
 * box was for.
 */
export function Field({ label, hint, error, id, required, ...props }: FieldProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  const hintId = `${fieldId}-hint`;
  return (
    <div className="field">
      <label htmlFor={fieldId}>
        {label}
        {required && <span className="req" aria-hidden="true">*</span>}
      </label>
      <input
        id={fieldId}
        className={`input ${error ? 'is-error' : ''}`}
        // aria-required, not the native attribute: the form validates itself
        // and shows its own inline errors, which the browser bubble would
        // jump in front of.
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? hintId : undefined}
        {...props}
      />
      {(error || hint) && (
        <span id={hintId} className={error ? 'field-error' : 'field-hint'}>
          {error || hint}
        </span>
      )}
    </div>
  );
}

/** Same, with a show/hide toggle — typing a password blind is how they get mistyped. */
export function PasswordField({ label, hint, error, id, required, ...props }: FieldProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  const hintId = `${fieldId}-hint`;
  const [shown, setShown] = useState(false);
  return (
    <div className="field">
      <label htmlFor={fieldId}>
        {label}
        {required && <span className="req" aria-hidden="true">*</span>}
      </label>
      <div className="field-with-btn">
        <input
          id={fieldId}
          type={shown ? 'text' : 'password'}
          className={`input ${error ? 'is-error' : ''}`}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? hintId : undefined}
          {...props}
        />
        <button
          type="button"
          className="field-btn"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? 'Hide password' : 'Show password'}
        >
          {shown ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {(error || hint) && (
        <span id={hintId} className={error ? 'field-error' : 'field-hint'}>
          {error || hint}
        </span>
      )}
    </div>
  );
}
