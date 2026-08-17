import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appointmentsApi } from '../api/endpoints';
import type { Slot } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useToast } from './Toast';
import { Badge, Loading, Modal } from './ui';
import { InlineSlotPicker } from './InlineSlotPicker';

/**
 * Full appointment detail — notes, payment/consultation review, reschedule,
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
  const payment = useMutation({
    mutationFn: (status: string) => appointmentsApi.setPayment(id, status),
    onSuccess: () => { invalidate(); toast.success('Payment updated'); },
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

  // ── Prescriptions ──────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addRx = useMutation({
    mutationFn: (files: File[]) => appointmentsApi.addPrescriptions(id, files),
    onSuccess: (_data, files) => {
      invalidate();
      toast.success(`Prescription${files.length > 1 ? 's' : ''} uploaded`);
    },
    onError: (e) => toast.error(e),
  });
  const deleteRx = useMutation({
    mutationFn: (prescriptionId: string) => appointmentsApi.deletePrescription(id, prescriptionId),
    onSuccess: () => { invalidate(); toast.success('Prescription deleted'); },
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
        <div className="grid cols-1-1-2">
          <div className="stack">
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
            <div className="row">
              {a.source === 'walk_in' && <Badge value="walk_in" label="Walk-in" />}
              <Badge value={a.status} />
              <Badge value={a.payment_status} />
              <Badge value={a.consultation_status} />
            </div>
          </div>

          <div className="stack">
            <div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Payment screenshot</div>
              {a.screenshot_url ? (
                <a href={a.screenshot_url} target="_blank" rel="noreferrer">
                  <img
                    src={a.screenshot_url}
                    alt="Payment screenshot"
                    style={{ width: '100%', borderRadius: 8, border: 'var(--hairline)' }}
                  />
                </a>
              ) : (
                <span className="muted">No screenshot.</span>
              )}
            </div>
          </div>
        </div>
      )}

      {a && (
        <div style={{ marginTop: 20, borderTop: 'var(--hairline)', paddingTop: 16 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Doctor’s note · shown when this patient books their next OPD
          </div>
          {canUpdate ? (
            <>
              <textarea
                className="input"
                rows={4}
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

      {a && (
        <div style={{ marginTop: 20, borderTop: 'var(--hairline)', paddingTop: 16 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>Prescriptions</div>
          {a.prescriptions.length === 0 ? (
            <span className="muted">No prescriptions uploaded yet.</span>
          ) : (
            <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
              {a.prescriptions.map((p) => (
                <div key={p.id} style={{ position: 'relative' }}>
                  <a href={p.url} target="_blank" rel="noreferrer">
                    <img
                      src={p.url}
                      alt="Prescription"
                      style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 8, border: 'var(--hairline)' }}
                    />
                  </a>
                  {canUpdate && (
                    <button
                      type="button"
                      className="btn-dots"
                      title="Delete"
                      disabled={deleteRx.isPending}
                      onClick={() => deleteRx.mutate(p.id)}
                      style={{
                        position: 'absolute', top: -8, right: -8, width: 22, height: 22,
                        borderRadius: '50%', background: 'var(--state-error)', color: '#fff',
                        border: 'none', lineHeight: 1, fontSize: 13,
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {canUpdate && (
            <div style={{ marginTop: 10 }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                hidden
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length) addRx.mutate(files);
                  e.target.value = '';
                }}
              />
              <button
                className="btn btn-sm"
                disabled={addRx.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                {addRx.isPending ? 'Uploading…' : '+ Upload images'}
              </button>
            </div>
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
          <div className="card-title" style={{ marginBottom: 8 }}>Reports for this visit</div>
          {a.reports.length === 0 ? (
            <span className="muted">No reports uploaded for this appointment.</span>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {a.reports.map((r) => (
                <a key={r.id} href={r.url} target="_blank" rel="noreferrer">📄 {r.title}</a>
              ))}
            </div>
          )}
        </div>
      )}

      {a && canUpdate && (
        <div style={{ marginTop: 20, borderTop: 'var(--hairline)', paddingTop: 16 }}>
          <div className="grid cols-2" style={{ gap: 20 }}>
            <div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Payment review</div>
              <div className="row">
                <button className="btn btn-sm" disabled={payment.isPending} onClick={() => payment.mutate('verified')}>
                  Verify
                </button>
                <button className="btn btn-sm btn-danger" disabled={payment.isPending} onClick={() => payment.mutate('rejected')}>
                  Reject (frees slot)
                </button>
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Consultation outcome</div>
              <div className="row">
                <button className="btn btn-sm" disabled={consult.isPending} onClick={() => consult.mutate('done')}>Done</button>
                <button className="btn btn-sm" disabled={consult.isPending} onClick={() => consult.mutate('on_hold')}>On hold</button>
                <button className="btn btn-sm btn-danger" disabled={consult.isPending} onClick={() => consult.mutate('rejected')}>Reject</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </Modal>
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
