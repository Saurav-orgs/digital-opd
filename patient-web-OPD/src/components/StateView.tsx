import React from 'react';
import { AlertCircle } from 'lucide-react';

interface StateViewProps {
  loading?: boolean;
  error?: string | null;
  empty?: string | null;
  onRetry?: () => void;
}

export const StateView: React.FC<StateViewProps> = ({
  loading = false,
  error,
  empty,
  onRetry,
}) => {
  if (loading) {
    return (
      <div className="state-view">
        <div className="spinner" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="state-view">
        <AlertCircle size={40} color="var(--error)" style={{ marginBottom: '12px' }} />
        <p style={{ margin: '0 0 16px 0', color: 'var(--text-secondary)' }}>{error}</p>
        {onRetry && (
          <button className="btn-outlined" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="state-view">
      <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
        {empty || 'Nothing here yet.'}
      </p>
    </div>
  );
};
