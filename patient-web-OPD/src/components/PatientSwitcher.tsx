import React from 'react';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import { usePatientAuth } from '../auth/PatientAuthContext';
import { StateView } from './StateView';

/**
 * Picks which person on this number the page is about.
 *
 * There is no default patient by design, so a number with several people on it
 * cannot show anything until one is chosen — hence `RequirePatient` below,
 * which renders the picker instead of the page in that case. A number with only
 * one patient never sees any of this: the context auto-selects them.
 */
export const PatientSwitcher: React.FC = () => {
  const { profiles, selected, selectProfile } = usePatientAuth();
  if (profiles.length < 2) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        margin: '0 0 18px',
        flexWrap: 'wrap',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 13,
          color: 'var(--text-secondary)',
        }}
      >
        <Users size={14} />
        Viewing
      </span>
      <select
        className="form-input"
        style={{ width: 'auto', minWidth: 180, padding: '6px 10px' }}
        value={selected?.id ?? ''}
        onChange={(e) => selectProfile(e.target.value)}
      >
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {p.patient_code}
          </option>
        ))}
      </select>
      <Link to="/patients" style={{ fontSize: 13 }}>
        Manage patients
      </Link>
    </div>
  );
};

/**
 * Gate for any page that shows one patient's records. Blocks rendering until a
 * patient is chosen, so a query can never run without a `profile_id`.
 */
export const RequirePatient: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { profiles, selected, selectProfile } = usePatientAuth();

  if (!selected) {
    if (profiles.length === 0) {
      return (
        <StateView empty="No patients are registered on this number yet. Book an appointment to add one." />
      );
    }
    return (
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>
          Whose records would you like to see?
        </h3>
        <p
          style={{
            margin: '0 0 16px',
            fontSize: 13.5,
            color: 'var(--text-secondary)',
          }}
        >
          This number has more than one patient registered on it.
        </p>
        <div style={{ display: 'grid', gap: 10 }}>
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              className="patient-pick-card"
              onClick={() => selectProfile(p.id)}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{p.name}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  {[
                    p.last_age != null ? `${p.last_age} yrs` : null,
                    p.gender,
                    p.patient_code,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
