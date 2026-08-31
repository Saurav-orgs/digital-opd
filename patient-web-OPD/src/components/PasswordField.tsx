import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * A password box with a show/hide toggle.
 *
 * Every one of these on the patient side either sets a password or confirms
 * one, and a typo in a field you cannot read is only discovered at the next
 * sign-in — by which point the patient has no way to recover it, since this
 * deployment sends no email or SMS.
 */
export const PasswordField: React.FC<{
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
}> = ({ value, onChange, placeholder, autoComplete = 'new-password', autoFocus }) => {
  const [shown, setShown] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <input
        type={shown ? 'text' : 'password'}
        className="form-input"
        placeholder={placeholder}
        value={value}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        style={{ paddingRight: 42 }}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        tabIndex={-1}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          width: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: 'var(--text-secondary)',
        }}
      >
        {shown ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
};
