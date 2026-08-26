import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appointmentsApi } from '../api/endpoints';
import type { Slot } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useToast } from './Toast';
import { Badge, Loading, Modal } from './ui';
import { InlineSlotPicker } from './InlineSlotPicker';
import { PrescriptionTabs } from './PrescriptionTabs';
import { reportsApi } from '../api/endpoints';
import type { PatientReport } from '../api/types';
import { appointmentRefetchInterval } from '../lib/summaryPolling';

/**
 * Full appointment detail — notes, consultation outcome, reschedule,
 * prescriptions and prior-visit history. The web equivalent of the Flutter
 * app's `AppointmentDetailScreen`, shared by the Dashboard's three tabs.
 */
export function AppointmentDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canUpdate = can('appointments', 'update');

  const { data: a, isLoading } = useQuery({
    queryKey: ['appointment', id],
    queryFn: () => appointmentsApi.get(id),
    // Report summaries finish in the background — keep polling until they do,
    // so "Summarising…" resolves on its own instead of needing a reload.
    refetchInterval: appointmentRefetchInterval,
  });

  // Local draft for the doctor's note, seeded from the loaded appointment.
  const [notes, setNotes] = useState('');
  useEffect(() => {
    setNotes(a?.doctor_notes ?? '');
  }, [a?.doctor_notes]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['appointment', id] });
    qc.invalidateQueries({ queryKey: ['appointments'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const saveNotes = useMutation({
    mutationFn: (value: string) => appointmentsApi.setNotes(id, value),
    onSuccess: () => { invalidate(); toast.success('Note saved'); },
    onError: (e) => toast.error(e),
  });

  const consult = useMutation({
    mutationFn: (status: string) => appointmentsApi.setConsultation(id, status),
    onSuccess: () => { invalidate(); toast.success('Consultation updated'); },
    onError: (e) => toast.error(e),
  });

  // ── Reschedule ─────────────────────────────────────────────
  const [rescheduling, setRescheduling] = useState(false);
  const [rDate, setRDate] = useState<string | null>(null);
  const [rSlot, setRSlot] = useState<Slot | null>(null);
  const reschedule = useMutation({
    mutationFn: () => appointmentsApi.reschedule(id, rDate!, rSlot!.start_time),
    onSuccess: () => {
      invalidate();
      toast.success('Appointment rescheduled');
      setRescheduling(false);
      setRDate(null);
      setRSlot(null);
    },
    onError: (e) => toast.error(e),
  });

  // ── Prior visits (matched by mobile) ────────────────────────
  const historyQ = useQuery({
    queryKey: ['appointment-history', a?.patient_mobile, id],
    queryFn: () => appointmentsApi.history(a!.patient_mobile, id),
    enabled: !!a?.patient_mobile,
  });

  // ── Next-visit reminder ──────────────────────────────────────
  const [addingReminder, setAddingReminder] = useState(false);
  const [reminderMsg, setReminderMsg] = useState('');
  const [reminderDate, setReminderDate] = useState('');
  const reminder = useMutation({
    mutationFn: () => appointmentsApi.addReminder(id, reminderMsg.trim(), reminderDate || undefined),
    onSuccess: () => {
      invalidate();
      toast.success('Reminder sent to the patient');
      setAddingReminder(false);
      setReminderMsg('');
      setReminderDate('');
    },
    onError: (e) => toast.error(e),
  });


  const genderAge = () => {
    const g = a?.patient_gender ? a.patient_gender[0].toUpperCase() + a.patient_gender.slice(1) : null;
    const age = a?.patient_age != null ? `${a.patient_age} yrs` : null;
    return [g, age].filter(Boolean).join(' · ');
  };

  return (
    <Modal title="Appointment detail" onClose={onClose} large>
      {isLoading || !a ? (
        <Loading />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px 18px', marginBottom: 14 }}>
          <Detail label="Patient" value={a.patient_name} />
          <Detail label="Mobile" value={a.patient_mobile} />
          {(a.patient_gender || a.patient_age != null) && (
            <Detail label="Gender & age" value={genderAge()} />
          )}
          <Detail label="Date & time" value={`${a.appointment_date} · ${a.start_time?.slice(0, 5)}–${a.end_time?.slice(0, 5)}`} />
          <Detail label="Doctor" value={a.doctor?.name ?? '—'} />
          {a.patient_address && <Detail label="Address" value={a.patient_address} />}
          {a.description && <Detail label="Reason" value={a.description} />}
          {a.source && (
            <Detail
              label="Booking source"
              value={a.source === 'app' ? 'Mobile App' : a.source === 'walk_in' ? 'Walk-in' : 'Web'}
            />
          )}
          <div className="row" style={{ gridColumn: '1 / -1', marginTop: 4 }}>
            {a.source === 'walk_in' && <Badge value="walk_in" label="Walk-in" />}
            <Badge value={a.status} />
            <Badge value={a.consultation_status} />
          </div>
        </div>
      )}

      {a && (
        <div style={{ marginTop: 14, borderTop: 'var(--hairline)', paddingTop: 14 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Doctor’s note · shown when this patient books their next OPD
          </div>
          {canUpdate ? (
            <>
              <textarea
                className="input"
                rows={3}
                placeholder="Add a note for this patient’s next visit…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
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
            <div style={{ whiteSpace: 'pre-wrap' }}>{a.doctor_notes}</div>
          ) : (
            <span className="muted">No note yet.</span>
          )}
        </div>
      )}

      {a && canUpdate && a.status !== 'rejected' && (
        <div style={{ marginTop: 20, borderTop: 'var(--hairline)', paddingTop: 16 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>Reschedule</div>
          {!rescheduling ? (
            <button className="btn btn-sm" onClick={() => setRescheduling(true)}>
              Reschedule slot
            </button>
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
                <button
                  className="btn btn-sm"
                  onClick={() => { setRescheduling(false); setRDate(null); setRSlot(null); }}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {a && (
        <div style={{ marginTop: 20, borderTop: 'var(--hairline)', paddingTop: 16 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>Previous visits</div>
          {historyQ.isLoading ? (
            <span className="muted">Loading history…</span>
          ) : !historyQ.data?.length ? (
            <span className="muted">No earlier visits for this patient.</span>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {historyQ.data.map((h) => (
                <div key={h.id} style={{ borderBottom: 'var(--hairline)', paddingBottom: 10 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <strong style={{ fontWeight: 500, fontSize: 14 }}>
                      {h.appointment_date} · {h.start_time?.slice(0, 5)}
                    </strong>
                    <Badge value={h.consultation_status} />
                  </div>
                  {h.description && (
                    <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>Reason: {h.description}</div>
                  )}
                  {h.doctor_notes && (
                    <div style={{ fontSize: 13, marginTop: 4 }}>Note: {h.doctor_notes}</div>
                  )}
                  {h.prescriptions.length > 0 && (
                    <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                      {h.prescriptions.map((p) => (
                        <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                          <img
                            src={p.url}
                            alt="Prescription"
                            style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: 'var(--hairline)' }}
                          />
                        </a>
                      ))}
                    </div>
                  )}
                  {h.reports.length > 0 && (
                    <div className="stack" style={{ gap: 4, marginTop: 8 }}>
                      {h.reports.map((r) => (
                        <a key={r.id} href={r.url} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
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

      {a && canUpdate && (
        <div style={{ marginTop: 20, borderTop: 'var(--hairline)', paddingTop: 16 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>Next-visit reminder</div>
          {a.next_visit_note && !addingReminder && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ whiteSpace: 'pre-wrap' }}>{a.next_visit_note}</div>
              {a.next_visit_date && (
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  Suggested date: {a.next_visit_date}
                </div>
              )}
            </div>
          )}
          {!addingReminder ? (
            <button className="btn btn-sm" onClick={() => setAddingReminder(true)}>
              {a.next_visit_note ? 'Update reminder' : 'Add reminder'}
            </button>
          ) : (
            <>
              <textarea
                className="input"
                rows={3}
                placeholder="e.g. Please come back for a follow-up in 2 weeks."
                value={reminderMsg}
                onChange={(e) => setReminderMsg(e.target.value)}
              />
              <div className="row" style={{ marginTop: 8, alignItems: 'center' }}>
                <input
                  className="input"
                  type="date"
                  style={{ width: 170 }}
                  value={reminderDate}
                  onChange={(e) => setReminderDate(e.target.value)}
                />
                <span className="muted" style={{ fontSize: 12 }}>Suggested date (optional)</span>
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

      {a && (
        <div style={{ marginTop: 20, borderTop: 'var(--hairline)', paddingTop: 16 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>
            Reports{a.reports.length > 0 ? ` (${a.reports.length})` : ''}
          </div>
          {/*
            The combined across-reports summary is deliberately not rendered for
            now — the client asked to hide it, not drop it. `VisitReportSummary`
            is kept (and exported) so bringing it back is a one-line change.
          */}
          {a.reports.length === 0 ? (
            <span className="muted">No reports uploaded for this appointment.</span>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {a.reports.map((r) => (
                <ReportWithSummary key={r.id} report={r} onRetried={invalidate} />
              ))}
            </div>
          )}
        </div>
      )}

      {a && (
        <div style={{ marginTop: 20, borderTop: 'var(--hairline)', paddingTop: 16 }}>
          <div className="card-title" style={{ marginBottom: 10 }}>
            Prescription
          </div>
          <PrescriptionTabs
            appointmentId={id}
            canEdit={canUpdate}
            disabled={a.status === 'rejected'}
          />
        </div>
      )}

      {a && canUpdate && (
        <div style={{ marginTop: 20, borderTop: 'var(--hairline)', paddingTop: 16 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Consultation outcome</div>
          <div className="row">
            <button className="btn btn-sm" disabled={consult.isPending} onClick={() => consult.mutate('done')}>Done</button>
            <button className="btn btn-sm" disabled={consult.isPending} onClick={() => consult.mutate('on_hold')}>On hold</button>
            <button className="btn btn-sm btn-danger" disabled={consult.isPending} onClick={() => consult.mutate('rejected')}>Reject</button>
          </div>
        </div>
      )}

      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

/**
 * The combined AI summary across every report the patient uploaded for this
 * visit — one clinical picture instead of opening each file.
 *
 * Currently hidden at the call site (see the Reports section above): the client
 * asked for it off for now, with the option to bring it back. Exported so it
 * stays compiled and ready rather than rotting behind a comment.
 */
export function VisitReportSummary({
  appointmentId,
  summary,
  status,
  error,
  count,
  reportCount,
  onRetried,
}: {
  appointmentId: string;
  summary?: import('../api/types').ReportAiSummary | null;
  status?: import('../api/types').AiJobStatus | null;
  error?: string | null;
  count?: number;
  reportCount: number;
  onRetried: () => void;
}) {
  const toast = useToast();
  const retry = useMutation({
    mutationFn: () => reportsApi.retryVisitSummary(appointmentId),
    onSuccess: () => { onRetried(); toast.success('Combining report summaries…'); },
    onError: (e) => toast.error(e),
  });

  // Only one report → the per-report card already says it all.
  if (reportCount < 2 && status !== 'ready') return null;

  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: 10,
        background: 'var(--primary-tint, #eef4ff)',
        border: '1px solid var(--primary, #cddffb)',
      }}
    >
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <strong style={{ fontSize: 13 }}>
          Combined summary{count ? ` · across ${count} report${count > 1 ? 's' : ''}` : ''}
        </strong>
        {status === 'ready' && (
          <button
            className="btn btn-sm btn-ghost"
            disabled={retry.isPending}
            onClick={() => retry.mutate()}
          >
            {retry.isPending ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>

      {status === 'processing' ? (
        <span className="muted" style={{ fontSize: 12.5 }}>Combining the report summaries…</span>
      ) : status === 'failed' ? (
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 12.5 }}>
            Couldn’t combine the summaries{error ? `: ${error}` : '.'}
          </span>
          <button className="btn btn-sm btn-ghost" disabled={retry.isPending} onClick={() => retry.mutate()}>
            {retry.isPending ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      ) : summary ? (
        <SummaryBody summary={summary} />
      ) : (
        <span className="muted" style={{ fontSize: 12.5 }}>Waiting for report summaries…</span>
      )}
    </div>
  );
}

/** A wrapping tag for one out-of-range value — stays inside the card even when
 * the model returns a long, sentence-like value. */
function AbnormalTag({
  v,
}: {
  v: { label: string; value: string; reference?: string; direction: 'high' | 'low' | 'abnormal' };
}) {
  const high = v.direction === 'high';
  return (
    <span
      style={{
        display: 'inline-block',
        maxWidth: '100%',
        padding: '3px 8px',
        borderRadius: 6,
        fontSize: 12,
        lineHeight: 1.35,
        whiteSpace: 'normal',
        overflowWrap: 'anywhere',
        background: high ? '#fdecec' : '#fbf1e0',
        color: high ? 'var(--state-error)' : 'var(--state-on-hold)',
      }}
    >
      {v.label}: {v.value}
      {v.reference ? ` (ref ${v.reference})` : ''}
    </span>
  );
}

/** Renders a ReportAiSummary body (shared by combined + per-report). */
function SummaryBody({ summary }: { summary: import('../api/types').ReportAiSummary }) {
  return (
    <>
      {summary.report_type && (
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{summary.report_type}</div>
      )}
      <div style={{ fontSize: 13 }}>{summary.summary}</div>
      {summary.abnormal_values.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {summary.abnormal_values.map((v, i) => (
            <AbnormalTag key={i} v={v} />
          ))}
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

/**
 * One uploaded report, with its AI summary behind an "AI report" tab.
 *
 * The summary is already generated in the background at upload time — this tab
 * only reveals it, so opening it is instant. It stays closed by default so the
 * doctor sees a short list of files rather than a wall of model output, and
 * still carries the "not ready yet" / "couldn't do it" states so nobody is left
 * wondering whether a summary is coming.
 */
function ReportWithSummary({
  report,
  onRetried,
}: {
  report: PatientReport;
  onRetried: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const retry = useMutation({
    mutationFn: () => reportsApi.retrySummary(report.id),
    onSuccess: () => {
      onRetried();
      toast.success('Summarising again…');
    },
    onError: (e) => toast.error(e),
  });

  const status = report.ai_summary_status;
  const summary = report.ai_summary;
  const ready = status === 'ready' && !!summary;

  return (
    <div
      style={{
        border: 'var(--hairline)',
        borderRadius: 10,
        padding: '10px 12px',
      }}
    >
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
              <button
                className="btn btn-sm btn-ghost"
                disabled={retry.isPending}
                onClick={() => retry.mutate()}
              >
                {retry.isPending ? 'Trying…' : 'Summarise now'}
              </button>
            </div>
          ) : status === 'failed' ? (
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: 12.5 }}>
                Couldn’t summarise this report.
              </span>
              <button
                className="btn btn-sm btn-ghost"
                disabled={retry.isPending}
                onClick={() => retry.mutate()}
              >
                {retry.isPending ? 'Retrying…' : 'Retry'}
              </button>
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div>{value}</div>
    </div>
  );
}
