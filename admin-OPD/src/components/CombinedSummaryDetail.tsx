import { useState } from 'react';
import type { PatientReport, ReportAiSummary } from '../api/types';

type Abnormal = ReportAiSummary['abnormal_values'][number];

/** An abnormal value plus which report it came from. */
interface SourcedAbnormal extends Abnormal {
  source: string;
}

/**
 * The extra detail shown on the Combined AI summary when a visit carries more
 * than one report.
 *
 * Everything here is derived from data already on the page — each report's own
 * summary rides along in the appointment payload — so nothing is asked of the
 * model a second time. That matters: the flat list the AI returns loses track
 * of which document a value came from, and with eight reports a doctor cannot
 * tell whether a low haemoglobin was on today's CBC or an old scan. Deriving
 * the breakdown deterministically restores that without adding a place for the
 * model to invent something.
 */
export function CombinedSummaryDetail({ reports }: { reports: PatientReport[] }) {
  const [expanded, setExpanded] = useState(false);

  const summarised = reports.filter((r) => r.ai_summary_status === 'ready');
  if (summarised.length < 2) return null;

  // Reports the AI could not read at all. Easy to miss in a pile of eight, and
  // the doctor needs to know the summary simply does not cover them.
  const unreadable = summarised.filter(
    (r) =>
      !r.ai_summary ||
      /could not be read/i.test(r.ai_summary.report_type ?? '') ||
      ((r.ai_summary.abnormal_values?.length ?? 0) === 0 &&
        (r.ai_summary.key_findings?.length ?? 0) === 0),
  );

  // Every abnormal value, tagged with the report it came from.
  const sourced: SourcedAbnormal[] = summarised.flatMap((r) =>
    (r.ai_summary?.abnormal_values ?? []).map((v) => ({ ...v, source: r.title })),
  );

  // Group by the panel the lab itself assigned, so 40 values read as 5 panels.
  const groups = new Map<string, SourcedAbnormal[]>();
  for (const v of sourced) {
    const key = v.category?.trim() || 'Other findings';
    groups.set(key, [...(groups.get(key) ?? []), v]);
  }
  const grouped = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

  const highs = sourced.filter((v) => v.direction === 'high').length;
  const lows = sourced.filter((v) => v.direction === 'low').length;

  return (
    <div style={{ marginTop: 10, borderTop: '1px solid var(--primary, #cddffb)', paddingTop: 10 }}>
      {/* One line the doctor can read without expanding anything. */}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <Stat label="reports" value={summarised.length} />
        {sourced.length > 0 && <Stat label="abnormal" value={sourced.length} />}
        {highs > 0 && <Stat label="high" value={highs} tone="high" />}
        {lows > 0 && <Stat label="low" value={lows} tone="low" />}
        {unreadable.length > 0 && (
          <Stat label="not readable" value={unreadable.length} tone="warn" />
        )}
      </div>

      <button
        className="btn btn-sm btn-ghost"
        style={{ marginTop: 8, paddingLeft: 0 }}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? '▾ Hide breakdown' : '▸ Show per-report breakdown'}
      </button>

      {expanded && (
        <div style={{ marginTop: 8 }}>
          {/* What is actually in the pile, and what each contributed. */}
          <SectionLabel>Reports in this visit</SectionLabel>
          <div className="stack" style={{ gap: 4, marginBottom: 12 }}>
            {summarised.map((r) => {
              const count = r.ai_summary?.abnormal_values?.length ?? 0;
              const unread = unreadable.some((u) => u.id === r.id);
              return (
                <div
                  key={r.id}
                  className="row"
                  style={{ justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}
                >
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <strong style={{ fontWeight: 600 }}>{r.title}</strong>
                    {r.ai_summary?.report_type && (
                      <span className="muted"> · {r.ai_summary.report_type}</span>
                    )}
                  </span>
                  <span className="muted" style={{ flexShrink: 0 }}>
                    {unread
                      ? 'nothing extracted'
                      : count > 0
                        ? `${count} abnormal`
                        : 'no abnormal values'}
                  </span>
                </div>
              );
            })}
          </div>

          {grouped.length > 0 && (
            <>
              <SectionLabel>Abnormal values by panel</SectionLabel>
              <div className="stack" style={{ gap: 10 }}>
                {grouped.map(([category, values]) => (
                  <div key={category}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                      {category}{' '}
                      <span className="muted" style={{ fontWeight: 400 }}>
                        ({values.length})
                      </span>
                    </div>
                    <div className="stack" style={{ gap: 3 }}>
                      {values.map((v, i) => (
                        <div
                          key={`${v.label}-${i}`}
                          className="row"
                          style={{ justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}
                        >
                          <span>
                            <span
                              style={{
                                fontWeight: 600,
                                color:
                                  v.direction === 'high'
                                    ? 'var(--danger, #b91c1c)'
                                    : v.direction === 'low'
                                      ? 'var(--warning-ink, #92400e)'
                                      : 'inherit',
                              }}
                            >
                              {v.label}
                            </span>{' '}
                            {v.value}
                            {v.reference && (
                              <span className="muted"> (ref {v.reference})</span>
                            )}
                          </span>
                          <span className="muted" style={{ flexShrink: 0, fontSize: 11.5 }}>
                            {v.source}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {unreadable.length > 0 && (
            <div
              className="muted"
              style={{ fontSize: 12, marginTop: 12, lineHeight: 1.5 }}
            >
              <strong>Not covered by this summary:</strong>{' '}
              {unreadable.map((r) => r.title).join(', ')} — no values could be
              extracted, so open {unreadable.length > 1 ? 'them' : 'it'} directly.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="muted"
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        marginBottom: 5,
      }}
    >
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'high' | 'low' | 'warn';
}) {
  const palette =
    tone === 'high'
      ? { bg: '#FEE2E2', fg: '#B91C1C' }
      : tone === 'low'
        ? { bg: '#FEF3C7', fg: '#92400E' }
        : tone === 'warn'
          ? { bg: '#F3F4F6', fg: '#4B5563' }
          : { bg: '#FFFFFF', fg: 'var(--text, #111827)' };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 4,
        background: palette.bg,
        color: palette.fg,
        border: '1px solid rgba(0,0,0,0.06)',
        borderRadius: 999,
        padding: '2px 9px',
        fontSize: 12,
      }}
    >
      <strong style={{ fontSize: 13 }}>{value}</strong>
      <span style={{ opacity: 0.85 }}>{label}</span>
    </span>
  );
}
