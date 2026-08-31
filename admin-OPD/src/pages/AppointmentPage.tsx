import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appointmentsApi, reportsApi } from '../api/endpoints';
import type { PatientReport, Slot } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Badge, Loading } from '../components/ui';
import { InlineSlotPicker } from '../components/InlineSlotPicker';
import { PrescriptionTabs } from '../components/PrescriptionTabs';
import { ProgressSummaryCard } from '../components/ProgressSummaryCard';
import { CombinedSummaryDetail } from '../components/CombinedSummaryDetail';
import { appointmentRefetchInterval, hasTrajectory } from '../lib/summaryPolling';

export default function AppointmentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canUpdate = can('appointments', 'update');

  const { data: a, isLoading } = useQuery({
    queryKey: ['appointment', id],
    queryFn: () => appointmentsApi.get(id!),
    enabled: !!id,
    // Report summaries finish in the background — keep polling until they do,
    // so "Summarising…" resolves on its own instead of needing a reload.
    refetchInterval: appointmentRefetchInterval,
  });

  const [notes, setNotes] = useState('');
  useEffect(() => { setNotes(a?.doctor_notes ?? ''); }, [a?.doctor_notes]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['appointment', id] });
    qc.invalidateQueries({ queryKey: ['appointments'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const saveNotes = useMutation({
    mutationFn: (v: string) => appointmentsApi.setNotes(id!, v),
    onSuccess: () => { invalidate(); toast.success('Note saved'); },
    onError: (e) => toast.error(e),
  });

  const consult = useMutation({
    mutationFn: (status: string) => appointmentsApi.setConsultation(id!, status),
    onSuccess: () => { invalidate(); toast.success('Consultation updated'); },
    onError: (e) => toast.error(e),
  });

  // ── Reschedule ────────────────────────────────────────────
  const [rescheduling, setRescheduling] = useState(false);
  const [rDate, setRDate] = useState<string | null>(null);
  const [rSlot, setRSlot] = useState<Slot | null>(null);
  const reschedule = useMutation({
    mutationFn: () => appointmentsApi.reschedule(id!, rDate!, rSlot!.start_time),
    onSuccess: () => {
      invalidate();
      toast.success('Appointment rescheduled');
      setRescheduling(false); setRDate(null); setRSlot(null);
    },
    onError: (e) => toast.error(e),
  });

  // ── History ───────────────────────────────────────────────
  const historyQ = useQuery({
    queryKey: ['appointment-history', a?.patient_profile_id, id],
    queryFn: () => appointmentsApi.history(a!.patient_profile_id!, id!),
    // Legacy visits carry no patient, and there is nothing to scope by then.
    enabled: !!a?.patient_profile_id,
  });

  // ── Reminder ──────────────────────────────────────────────
  const [addingReminder, setAddingReminder] = useState(false);
  const [reminderMsg, setReminderMsg] = useState('');
  const [reminderDate, setReminderDate] = useState('');
  const reminder = useMutation({
    mutationFn: () => appointmentsApi.addReminder(id!, reminderMsg.trim(), reminderDate || undefined),
    onSuccess: () => {
      invalidate(); toast.success('Reminder sent');
      setAddingReminder(false); setReminderMsg(''); setReminderDate('');
    },
    onError: (e) => toast.error(e),
  });

  if (isLoading || !id) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Loading />
      </div>
    );
  }

  const genderAge = [
    a?.patient_gender ? a.patient_gender[0].toUpperCase() + a.patient_gender.slice(1) : null,
    a?.patient_age != null ? `${a.patient_age} yrs` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div style={{ maxWidth: 1140, margin: '0 auto' }}>
      {/* ── Page header ─────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            className="btn btn-sm"
            onClick={() => navigate('/dashboard')}
            style={{ flexShrink: 0 }}
          >
            ← Back
          </button>
          <div>
            <h1 style={{ fontSize: 20, margin: 0, lineHeight: 1.2 }}>
              {a?.patient_name ?? 'Appointment'}
            </h1>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              {a?.appointment_date} · {a?.start_time?.slice(0, 5)}–{a?.end_time?.slice(0, 5)}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {a?.source === 'walk_in' && <Badge value="walk_in" label="Walk-in" />}
          {a && <Badge value={a.status} />}
          {a && <Badge value={a.consultation_status} />}
        </div>
      </div>

      {/* ── 1. Patient details card (Compact 3-4 items per row) ─── */}
      <div className="card" style={{ marginBottom: 16, padding: '16px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div className="card-title" style={{ margin: 0 }}>Patient details</div>
          {a?.doctor?.name && (
            <span className="muted" style={{ fontSize: 12.5 }}>Doctor: <strong style={{ color: 'var(--text)' }}>{a.doctor.name}</strong></span>
          )}
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: '12px 20px',
        }}>
          <Field label="Patient Name" value={a?.patient_name} />
          <Field label="Mobile Number" value={a?.patient_mobile} />
          {genderAge && <Field label="Gender & Age" value={genderAge} />}
          {a?.source && (
            <Field
              label="Booking Source"
              value={a.source === 'app' ? 'Mobile App' : a.source === 'walk_in' ? 'Walk-in' : 'Web Booking'}
            />
          )}
          {a?.appointment_date && (
            <Field label="Schedule" value={`${a.appointment_date} (${a.start_time?.slice(0, 5)}–${a.end_time?.slice(0, 5)})`} />
          )}
          {a?.patientProfile && (
            <Field
              label="Patient ID"
              value={`${a.patientProfile.patient_code}${
                a.patientProfile.relation ? ` · ${a.patientProfile.relation}` : ''
              }`}
            />
          )}
          {a?.patient_address && (
            <Field
              label="Address"
              value={[a.patient_address, a.patient_city, a.patient_state, a.patient_pincode]
                .filter(Boolean)
                .join(', ')}
            />
          )}
          {a?.description && <Field label="Reason for Visit" value={a.description} />}
        </div>

      </div>

      {/* ── 2-Column Clinical Layout ────────────────────────── */}
      <div className="grid cols-2-1" style={{ gap: 16, alignItems: 'start' }}>
        {/* Left / Primary Workspace: Summary then Prescription */}
        <div className="stack" style={{ gap: 16 }}>
          {/* Reports the patient uploaded for this visit */}
          {a && a.reports.length > 0 && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 12 }}>
                Reports ({a.reports.length})
              </div>

              {/*
                One combined card, not two. The across-visits comparison wins
                when it has something to say — it already folds this visit's
                reports into it. But a trajectory with nothing comparable in it
                is not worth the doctor's first glance, and showing it would
                bury this visit's own summary, so that case falls back too.
              */}
              <div className="stack" style={{ gap: 10, marginBottom: 12 }}>
                {a.progress_summary_status &&
                (a.progress_summary_status !== 'ready' ||
                  hasTrajectory(a.progress_summary)) ? (
                  <ProgressSummaryCard
                    appointmentId={a.id}
                    summary={a.progress_summary}
                    status={a.progress_summary_status}
                    error={a.progress_summary_error}
                    visitCount={a.progress_summary_visit_count}
                    onChanged={invalidate}
                  />
                ) : (
                  <VisitReportSummary
                    appointmentId={a.id}
                    summary={a.reports_summary}
                    status={a.reports_summary_status}
                    error={a.reports_summary_error}
                    count={a.reports_summary_count}
                    reportCount={a.reports.length}
                    reports={a.reports}
                    /* Explains why no trajectory is shown despite an earlier visit. */
                    noComparison={
                      a.progress_summary_status === 'ready' &&
                      !hasTrajectory(a.progress_summary)
                    }
                    onRetried={invalidate}
                  />
                )}
              </div>

              <div className="stack" style={{ gap: 10 }}>
                {a.reports.map((r) => (
                  <ReportWithSummary key={r.id} report={r} onRetried={invalidate} />
                ))}
              </div>
            </div>
          )}

          {/* Prescription Tabs (Handwrite, Voice, Type, Upload Rx) */}
          {a && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 10 }}>Prescription</div>
              <PrescriptionTabs
                appointmentId={id}
                canEdit={canUpdate}
                disabled={a.status === 'rejected'}
              />
            </div>
          )}
        </div>

        {/* Right / Secondary Panel: Notes, Reminders, Reschedule, History */}
        <div className="stack" style={{ gap: 16 }}>
          {/* Doctor's note */}
          {a && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 6 }}>Doctor's note</div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                Shown when this patient books their next OPD.
              </div>
              {canUpdate ? (
                <>
                  <textarea
                    className="input"
                    rows={3}
                    placeholder="Add a clinical note for patient's next visit…"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                  <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={saveNotes.isPending || notes === (a.doctor_notes ?? '')}
                      onClick={() => saveNotes.mutate(notes)}
                    >
                      {saveNotes.isPending ? 'Saving…' : 'Save note'}
                    </button>
                  </div>
                </>
              ) : a.doctor_notes ? (
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{a.doctor_notes}</div>
              ) : (
                <span className="muted" style={{ fontSize: 13 }}>No note yet.</span>
              )}
            </div>
          )}

          {/* Next-visit reminder */}
          {a && canUpdate && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 6 }}>Next-visit reminder</div>
              {a.next_visit_note && !addingReminder && (
                <div style={{ marginBottom: 8, background: 'var(--page)', padding: '8px 10px', borderRadius: 6 }}>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{a.next_visit_note}</div>
                  {a.next_visit_date && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>Suggested date: {a.next_visit_date}</div>
                  )}
                </div>
              )}
              {!addingReminder ? (
                <button className="btn btn-sm" onClick={() => setAddingReminder(true)}>
                  {a.next_visit_note ? 'Update reminder' : '+ Add reminder'}
                </button>
              ) : (
                <>
                  <textarea
                    className="input"
                    rows={2}
                    placeholder="e.g. Come back for a follow-up in 2 weeks."
                    value={reminderMsg}
                    onChange={(e) => setReminderMsg(e.target.value)}
                  />
                  <div className="row" style={{ marginTop: 8, alignItems: 'center' }}>
                    <input className="input" type="date" style={{ width: 160 }} value={reminderDate} onChange={(e) => setReminderDate(e.target.value)} />
                    <span className="muted" style={{ fontSize: 11.5 }}>Suggested date</span>
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={!reminderMsg.trim() || reminder.isPending}
                      onClick={() => reminder.mutate()}
                    >
                      {reminder.isPending ? 'Sending…' : 'Send reminder'}
                    </button>
                    <button className="btn btn-sm" onClick={() => setAddingReminder(false)}>Cancel</button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Reschedule */}
          {a && canUpdate && a.status !== 'rejected' && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 8 }}>Reschedule</div>
              {!rescheduling ? (
                <button className="btn btn-sm" onClick={() => setRescheduling(true)}>Reschedule slot</button>
              ) : (
                <>
                  <InlineSlotPicker
                    doctorId={a.doctor_id}
                    onChange={(date, slot) => { setRDate(date); setRSlot(slot); }}
                  />
                  <div className="row" style={{ marginTop: 12 }}>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={!rDate || !rSlot || reschedule.isPending}
                      onClick={() => reschedule.mutate()}
                    >
                      {reschedule.isPending ? 'Saving…' : 'Confirm new slot'}
                    </button>
                    <button className="btn btn-sm" onClick={() => { setRescheduling(false); setRDate(null); setRSlot(null); }}>
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Previous visits */}
          {a && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 8 }}>Previous visits</div>
              {historyQ.isLoading ? (
                <span className="muted" style={{ fontSize: 13 }}>Loading history…</span>
              ) : !historyQ.data?.length ? (
                <span className="muted" style={{ fontSize: 13 }}>No earlier visits for this patient.</span>
              ) : (
                <div className="stack" style={{ gap: 10 }}>
                  {historyQ.data.map((h) => (
                    <div key={h.id} style={{ borderBottom: 'var(--hairline)', paddingBottom: 8 }}>
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        {/* Opens that visit in full — its own reports and its
                            own summary, which the doctor often wants to read
                            rather than just the note. */}
                        <Link
                          to={`/appointments/${h.id}`}
                          style={{ fontWeight: 500, fontSize: 13 }}
                        >
                          {h.appointment_date} · {h.start_time?.slice(0, 5)}
                        </Link>
                        <Badge value={h.consultation_status} />
                      </div>
                      {h.description && (
                        <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>Reason: {h.description}</div>
                      )}
                      {h.doctor_notes && (
                        <div style={{ fontSize: 12.5, marginTop: 2 }}>Note: {h.doctor_notes}</div>
                      )}
                      {h.prescriptions.length > 0 && (
                        <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                          {h.prescriptions.map((p) => (
                            <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                              <img src={p.url} alt="Prescription" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6, border: 'var(--hairline)' }} />
                            </a>
                          ))}
                        </div>
                      )}
                      {h.reports.length > 0 && (
                        <div className="stack" style={{ gap: 3, marginTop: 6 }}>
                          {h.reports.map((r) => (
                            <a key={r.id} href={r.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                              📄 {r.title}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/*
        Closing the visit is the last thing the doctor does, so it sits at the
        end of the page and looks like one: full width, its own card, below the
        reports, the prescription and the notes.

        It used to be a row of small buttons tucked under the patient details
        at the very top — read as part of the patient's record rather than an
        action, and asked for before any of the work it is meant to conclude.
      */}
      {a && canUpdate && a.status !== 'rejected' && (
        <div
          className="card"
          style={{
            marginTop: 16,
            borderTop: '3px solid var(--primary)',
          }}
        >
          <div
            className="row"
            style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}
          >
            <div>
              <div
                className="muted"
                style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}
              >
                Final step
              </div>
              <div className="card-title" style={{ margin: '4px 0 4px' }}>
                Close this consultation
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                Record how the visit ended. Currently{' '}
                <Badge value={a.consultation_status} />
              </div>
            </div>

            <div className="row outcome-actions" style={{ gap: 8 }}>
              <button
                className="btn btn-primary"
                disabled={consult.isPending || a.consultation_status === 'done'}
                onClick={() => consult.mutate('done')}
              >
                <span className="lbl-full">
                  {a.consultation_status === 'done' ? '✓ Marked done' : '✓ Mark as done'}
                </span>
                <span className="lbl-short">
                  {a.consultation_status === 'done' ? '✓ Done' : 'Done'}
                </span>
              </button>
              <button
                className="btn"
                disabled={consult.isPending || a.consultation_status === 'on_hold'}
                onClick={() => consult.mutate('on_hold')}
              >
                <span className="lbl-full">Put on hold</span>
                <span className="lbl-short">On hold</span>
              </button>
              <button
                className="btn btn-danger"
                disabled={consult.isPending || a.consultation_status === 'rejected'}
                onClick={() => consult.mutate('rejected')}
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared sub-components ────────────────────────────────────

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

/**
 * The combined AI summary across every report on this visit.
 *
 * Currently hidden at the call site (see the Reports card above): the client
 * asked for it off for now, with the option to bring it back. Exported so it
 * stays compiled and ready rather than rotting behind a comment.
 */
export function VisitReportSummary({
  appointmentId, summary, status, error, count, reportCount, reports, noComparison, onRetried,
}: {
  appointmentId: string;
  summary?: import('../api/types').ReportAiSummary | null;
  status?: import('../api/types').AiJobStatus | null;
  error?: string | null;
  count?: number;
  reportCount: number;
  /** This visit's reports, for the multi-report breakdown below the summary. */
  reports?: import('../api/types').PatientReport[];
  /** True when an earlier visit exists but shares no comparable measurement. */
  noComparison?: boolean;
  onRetried: () => void;
}) {
  const toast = useToast();
  const retry = useMutation({
    mutationFn: () => reportsApi.retryVisitSummary(appointmentId),
    onSuccess: () => { onRetried(); toast.success('Combining report summaries…'); },
    onError: (e) => toast.error(e),
  });

  if (reportCount < 2 && status !== 'ready') return null;

  return (
    <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--primary-tint, #eef4ff)', border: '1px solid var(--primary, #cddffb)' }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <strong style={{ fontSize: 13 }}>
          Combined AI summary{count ? ` · ${count} report${count > 1 ? 's' : ''}` : ''}
        </strong>
        {status === 'ready' && (
          <button className="btn btn-sm btn-ghost" disabled={retry.isPending} onClick={() => retry.mutate()}>
            {retry.isPending ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>
      {status === 'processing' ? (
        <span className="muted" style={{ fontSize: 12.5 }}>Combining the report summaries…</span>
      ) : status === 'failed' ? (
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 12.5 }}>Couldn't combine{error ? `: ${error}` : '.'}</span>
          <button className="btn btn-sm btn-ghost" disabled={retry.isPending} onClick={() => retry.mutate()}>
            {retry.isPending ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      ) : summary ? (
        <>
          <SummaryBody summary={summary} />
          {noComparison && (
            <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
              The previous visit shares no comparable measurement with this one,
              so there is no trend to show.
            </div>
          )}
          {reports && <CombinedSummaryDetail reports={reports} />}
        </>
      ) : (
        <span className="muted" style={{ fontSize: 12.5 }}>Waiting for report summaries…</span>
      )}
    </div>
  );
}

function ReportWithSummary({ report, onRetried }: { report: PatientReport; onRetried: () => void }) {
  const toast = useToast();
  const retry = useMutation({
    mutationFn: () => reportsApi.retrySummary(report.id),
    onSuccess: () => { onRetried(); toast.success('Summarising again…'); },
    onError: (e) => toast.error(e),
  });

  const [open, setOpen] = useState(false);
  const { ai_summary_status: status, ai_summary: summary } = report;
  const ready = status === 'ready' && !!summary;

  return (
    <div style={{ border: 'var(--hairline)', borderRadius: 10, padding: '10px 12px' }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
        <a href={report.url} target="_blank" rel="noreferrer" style={{ fontSize: 13.5 }}>
          📄 {report.title}
        </a>
        <button
          className={`btn btn-sm ${open && ready ? 'btn-primary' : ''}`}
          onClick={() => setOpen((v) => !v)}
          style={{ padding: '4px 10px', fontSize: 12, borderRadius: 999 }}
          aria-expanded={open}
        >
          ✨ AI report
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 10 }}>
          {ready ? (
            <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--page)' }}>
              <SummaryBody summary={summary} />
            </div>
          ) : status === 'processing' ? (
            <span className="muted" style={{ fontSize: 12.5 }}>Summarising…</span>
          ) : status === 'pending' ? (
            // Queued but not running — usually the AI service isn't up yet.
            // Saying "summarising" would promise work that isn't happening.
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: 12.5 }}>Waiting to be summarised.</span>
              <button className="btn btn-sm btn-ghost" disabled={retry.isPending} onClick={() => retry.mutate()}>
                {retry.isPending ? 'Trying…' : 'Summarise now'}
              </button>
            </div>
          ) : status === 'failed' ? (
            <div className="stack" style={{ gap: 6 }}>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="muted" style={{ fontSize: 12.5 }}>Couldn't summarise this report.</span>
                <button className="btn btn-sm btn-ghost" disabled={retry.isPending} onClick={() => retry.mutate()}>
                  {retry.isPending ? 'Retrying…' : 'Retry'}
                </button>
              </div>
              {/* The actual reason, so a fixable cause isn't hidden behind a retry. */}
              {report.ai_summary_error && (
                <span className="muted" style={{ fontSize: 11.5 }}>{report.ai_summary_error}</span>
              )}
            </div>
          ) : (
            <span className="muted" style={{ fontSize: 12.5 }}>
              No AI summary for this report.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryBody({ summary }: { summary: import('../api/types').ReportAiSummary }) {
  return (
    <>
      {summary.report_type && <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{summary.report_type}</div>}
      <div style={{ fontSize: 13 }}>{summary.summary}</div>
      {summary.abnormal_values.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {summary.abnormal_values.map((v, i) => <AbnormalTag key={i} v={v} />)}
        </div>
      )}
      {summary.key_findings.length > 0 && (
        <ul style={{ margin: '8px 0 0 18px', fontSize: 12.5 }}>
          {summary.key_findings.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      )}
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        AI-generated — check the reports themselves before acting.
      </div>
    </>
  );
}

function AbnormalTag({ v }: { v: { label: string; value: string; reference?: string; direction: 'high' | 'low' | 'abnormal' } }) {
  const high = v.direction === 'high';
  return (
    <span style={{
      display: 'inline-block', maxWidth: '100%', padding: '3px 8px', borderRadius: 6,
      fontSize: 12, lineHeight: 1.35, whiteSpace: 'normal', overflowWrap: 'anywhere',
      background: high ? '#fdecec' : '#fbf1e0',
      color: high ? 'var(--state-error)' : 'var(--state-on-hold)',
    }}>
      {v.label}: {v.value}{v.reference ? ` (ref ${v.reference})` : ''}
    </span>
  );
}
