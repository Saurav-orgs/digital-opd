import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { reportsApi } from '../api/endpoints';
import { useToast } from '../components/Toast';
import type {
  AiJobStatus,
  ProgressStatus,
  ProgressSummary,
  ProgressTrend,
} from '../api/types';

const STATUS_STYLE: Record<ProgressStatus, { label: string; bg: string; fg: string }> = {
  improving: { label: 'Improving', bg: '#dcfce7', fg: '#166534' },
  stable: { label: 'Stable', bg: '#e5edff', fg: '#1d4ed8' },
  worsening: { label: 'Worsening', bg: '#fdecec', fg: '#b91c1c' },
  unclear: { label: 'Not comparable', bg: '#f1f1f1', fg: '#525252' },
};

/**
 * How this patient has moved since their last visit.
 *
 * This is the card the doctor reads first at a follow-up, so it leads with the
 * one-word verdict and the value-by-value table, and keeps the narrative
 * underneath. Editing is not a nicety: the saved correction becomes the
 * training pair that teaches the model this clinic's judgement.
 */
export function ProgressSummaryCard({
  appointmentId,
  summary,
  status,
  error,
  visitCount,
  onChanged,
}: {
  appointmentId: string;
  summary?: ProgressSummary | null;
  status?: AiJobStatus | null;
  error?: string | null;
  visitCount?: number;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);

  const retry = useMutation({
    mutationFn: () => reportsApi.retryProgress(appointmentId),
    onSuccess: () => {
      onChanged();
      toast.success('Rebuilding the comparison…');
    },
    onError: (e) => toast.error(e),
  });

  // status null = no earlier visit to compare against (a first visit).
  if (!status) return null;

  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: 10,
        background: 'var(--primary-tint, #eef4ff)',
        border: '1px solid var(--primary, #cddffb)',
      }}
    >
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <strong style={{ fontSize: 13 }}>Since the last visit</strong>
          {status === 'ready' && summary && (
            <span
              style={{
                padding: '2px 9px',
                borderRadius: 999,
                fontSize: 11.5,
                fontWeight: 700,
                background: STATUS_STYLE[summary.status].bg,
                color: STATUS_STYLE[summary.status].fg,
              }}
            >
              {STATUS_STYLE[summary.status].label}
            </span>
          )}
          {!!visitCount && visitCount > 1 && (
            <span className="muted" style={{ fontSize: 11.5 }}>
              across {visitCount} visits
            </span>
          )}
        </div>

        {status === 'ready' && !editing && (
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm btn-ghost" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              className="btn btn-sm btn-ghost"
              disabled={retry.isPending}
              onClick={() => retry.mutate()}
            >
              {retry.isPending ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        )}
      </div>

      {status === 'processing' || status === 'pending' ? (
        <span className="muted" style={{ fontSize: 12.5 }}>
          Comparing against the previous visit…
        </span>
      ) : status === 'failed' ? (
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 12.5 }}>
            Couldn't compare{error ? `: ${error}` : '.'}
          </span>
          <button
            className="btn btn-sm btn-ghost"
            disabled={retry.isPending}
            onClick={() => retry.mutate()}
          >
            {retry.isPending ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      ) : !summary ? (
        <span className="muted" style={{ fontSize: 12.5 }}>
          Waiting for this visit's report summaries…
        </span>
      ) : editing ? (
        <ProgressEditor
          appointmentId={appointmentId}
          summary={summary}
          onDone={() => {
            setEditing(false);
            onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <ProgressBody summary={summary} />
      )}
    </div>
  );
}

function ProgressBody({ summary }: { summary: ProgressSummary }) {
  return (
    <>
      <div style={{ fontSize: 13 }}>{summary.summary}</div>

      {summary.trends.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12.5, minWidth: 340 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--muted, #666)' }}>
                <th style={{ padding: '2px 10px 4px 0', fontWeight: 600 }}>Measure</th>
                <th style={{ padding: '2px 10px 4px 0', fontWeight: 600 }}>Previous</th>
                <th style={{ padding: '2px 10px 4px 0', fontWeight: 600 }}>Now</th>
                <th style={{ padding: '2px 0 4px 0', fontWeight: 600 }}></th>
              </tr>
            </thead>
            <tbody>
              {summary.trends.map((t, i) => (
                <TrendRow key={i} t={t} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TwoLists
        left={{ title: 'Improved', items: summary.improvements, tone: '#166534' }}
        right={{ title: 'Worse', items: summary.deteriorations, tone: '#b91c1c' }}
      />

      {summary.current_status && (
        <div style={{ fontSize: 12.5, marginTop: 8 }}>
          <strong style={{ fontWeight: 600 }}>Where they stand: </strong>
          {summary.current_status}
        </div>
      )}

      {summary.watch_points.length > 0 && (
        <>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 8 }}>Watch</div>
          <ul style={{ margin: '2px 0 0 18px', fontSize: 12.5 }}>
            {summary.watch_points.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </>
      )}

      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        AI-generated from the report summaries — check the reports themselves before
        acting. Only measurements recorded at both visits are compared.
      </div>
    </>
  );
}

function TrendRow({ t }: { t: ProgressTrend }) {
  const arrow = t.direction === 'up' ? '↑' : t.direction === 'down' ? '↓' : '→';
  const tone =
    t.interpretation === 'better'
      ? '#166534'
      : t.interpretation === 'worse'
        ? '#b91c1c'
        : 'var(--muted, #666)';
  return (
    <tr>
      <td style={{ padding: '3px 10px 3px 0' }}>{t.label}</td>
      <td style={{ padding: '3px 10px 3px 0', color: 'var(--muted, #666)' }}>
        {t.previous_value}
      </td>
      <td style={{ padding: '3px 10px 3px 0', fontWeight: 600 }}>{t.current_value}</td>
      <td style={{ padding: '3px 0', color: tone, whiteSpace: 'nowrap' }}>
        {arrow} {t.interpretation === 'unclear' ? '' : t.interpretation}
      </td>
    </tr>
  );
}

function TwoLists({
  left,
  right,
}: {
  left: { title: string; items: string[]; tone: string };
  right: { title: string; items: string[]; tone: string };
}) {
  if (!left.items.length && !right.items.length) return null;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 12,
        marginTop: 10,
      }}
    >
      {[left, right].map(
        (col) =>
          col.items.length > 0 && (
            <div key={col.title}>
              <div style={{ fontSize: 12, fontWeight: 700, color: col.tone }}>
                {col.title}
              </div>
              <ul style={{ margin: '3px 0 0 16px', fontSize: 12.5 }}>
                {col.items.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          ),
      )}
    </div>
  );
}

/**
 * The doctor's correction. Saving stores their version *and* the pair
 * (model output, doctor output) as a training sample — an unchanged save is
 * kept too, since confirming the model was right is also signal.
 */
function ProgressEditor({
  appointmentId,
  summary,
  onDone,
  onCancel,
}: {
  appointmentId: string;
  summary: ProgressSummary;
  onDone: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<ProgressSummary>(summary);

  useEffect(() => setDraft(summary), [summary]);

  const save = useMutation({
    mutationFn: () => reportsApi.saveProgress(appointmentId, draft),
    onSuccess: () => {
      toast.success('Summary saved.');
      onDone();
    },
    onError: (e) => toast.error(e),
  });

  const lines = (v: string) =>
    v
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <label style={{ fontSize: 12, fontWeight: 600 }}>Overall</label>
      <select
        className="input"
        value={draft.status}
        onChange={(e) =>
          setDraft({ ...draft, status: e.target.value as ProgressStatus })
        }
      >
        <option value="improving">Improving</option>
        <option value="stable">Stable</option>
        <option value="worsening">Worsening</option>
        <option value="unclear">Not comparable</option>
      </select>

      <label style={{ fontSize: 12, fontWeight: 600 }}>Summary</label>
      <textarea
        className="input"
        rows={4}
        value={draft.summary}
        onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
      />

      <label style={{ fontSize: 12, fontWeight: 600 }}>
        Where they stand today
      </label>
      <textarea
        className="input"
        rows={2}
        value={draft.current_status}
        onChange={(e) => setDraft({ ...draft, current_status: e.target.value })}
      />

      <label style={{ fontSize: 12, fontWeight: 600 }}>Watch (one per line)</label>
      <textarea
        className="input"
        rows={2}
        value={draft.watch_points.join('\n')}
        onChange={(e) => setDraft({ ...draft, watch_points: lines(e.target.value) })}
      />

      {draft.trends.length > 0 && (
        <>
          <label style={{ fontSize: 12, fontWeight: 600 }}>
            Is each change better or worse?
          </label>
          {draft.trends.map((t, i) => (
            <div key={i} className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12.5, flex: 1 }}>
                {t.label}: {t.previous_value} → {t.current_value}
              </span>
              <select
                className="input"
                style={{ width: 120 }}
                value={t.interpretation}
                onChange={(e) => {
                  const trends = [...draft.trends];
                  trends[i] = {
                    ...t,
                    interpretation: e.target
                      .value as ProgressTrend['interpretation'],
                  };
                  setDraft({ ...draft, trends });
                }}
              >
                <option value="better">Better</option>
                <option value="worse">Worse</option>
                <option value="unclear">Unclear</option>
              </select>
            </div>
          ))}
        </>
      )}

      <div className="row" style={{ gap: 8, marginTop: 4 }}>
        <button
          className="btn btn-sm"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <span className="muted" style={{ fontSize: 11 }}>
        Your version replaces the AI's, and is kept to train the model on this
        clinic's judgement.
      </span>
    </div>
  );
}
