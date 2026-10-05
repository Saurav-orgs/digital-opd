import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  appointmentsApi,
  blockedNumbersApi,
  consultationApi,
  reportsApi,
} from '../api/endpoints';
import type { Appointment, ConsultationSession, EPrescription, PatientReport, Slot } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { ConfirmDialog, Loading, Modal } from '../components/ui';
import { InlineSlotPicker } from '../components/InlineSlotPicker';
import { PrescriptionTabs } from '../components/PrescriptionTabs';
import { PrescriptionPreviewModal } from '../components/PrescriptionPreview';
import { flushDraft } from '../lib/draftFlush';
import { ProgressSummaryCard } from '../components/ProgressSummaryCard';
import { CombinedSummaryDetail } from '../components/CombinedSummaryDetail';
import { CollapseToggle } from '../components/CollapseToggle';
import { ReportUpload } from '../components/ReportUpload';
import { FlashNotice } from '../components/FlashNotice';
import { downloadFile } from '../lib/shareFile';
import { useCollapsible } from '../lib/collapsePreference';
import { appointmentRefetchInterval, hasTrajectory } from '../lib/summaryPolling';
import { avatarTone, initials } from '../lib/avatar';
import { ReportViewerModal, SummaryModal } from '../components/ReportViewer';
import { Eye, History } from 'lucide-react';
import { formatDuration } from '../lib/duration';
import {
  CheckCircleIcon,
  DownloadIcon,
  SparkleIcon,
  TrashIcon,
} from '../components/icons';

/** "09:00" → "9:00 AM". Left alone if it is not an HH:mm string. */
function prettyTime(time: string | undefined) {
  if (!time) return '';
  const [h, m] = time.slice(0, 5).split(':').map(Number);
  if (Number.isNaN(h)) return time;
  const suffix = h < 12 ? 'AM' : 'PM';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m ?? 0).padStart(2, '0')} ${suffix}`;
}

/** "2026-09-04" → "Thu, 4 Sep". */
function prettyDate(date: string | undefined) {
  if (!date) return '';
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/*
 * The consultation used to be a three-step wizard — Reports, Prescription,
 * Preview — with Preview locked until the draft had been saved and the step
 * remembered per visit in localStorage.
 *
 * All of it is gone. The design puts the whole visit on one screen: reports
 * and previous visits on the left, the prescription on the right, and Preview
 * as a modal that is always reachable. The "Preview is earned by saving" rule
 * went with it, on the client's instruction — it was stopping a doctor looking
 * at a document that was sitting right there, and the thing it guarded against
 * (issuing a blank letterhead) is caught by the empty-prescription check on
 * Issue instead.
 *
 * The per-visit step key is not migrated: there is no step to restore, and a
 * stale entry does nothing.
 */

/**
 * Who this prescription is for, at the top of the panel it is being written
 * in — not in a card of its own down the page.
 *
 * It replaces the full patient card that used to head the left column. The
 * design is explicit about this: while writing, the only thing the doctor
 * needs on screen is who they are writing for. Everything else that card
 * carried — reschedule, cancel, the address and the reason for the visit —
 * moved to the overflow menu and the details disclosure, where it is one tap
 * away rather than occupying the column the reports need.
 *
 * Sticky at phone width, where the panel scrolls a long way under it.
 */
/**
 * The visit's own header card: who, when, and how often they have been.
 *
 * Removed in an earlier pass on the reading that the prescription panel's chip
 * made it redundant. The design has both, and they answer different questions:
 * this one is about the appointment — the time, the date, which visit this is —
 * while the chip is about who the prescription on screen is for.
 */
function VisitHeaderCard({
  appointment: a,
  visitNumber,
  lastSeen,
}: {
  appointment: Appointment;
  /** Which visit this is for this patient, 1 for a first. */
  visitNumber: number;
  /** The previous visit's date, when there is one. */
  lastSeen: string | null;
}) {
  const meta = [
    a.patient_gender ? a.patient_gender[0].toUpperCase() + a.patient_gender.slice(1) : null,
    a.patient_age != null ? `${a.patient_age} yrs` : null,
    a.patient_mobile,
    a.description?.trim() || null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="visit-header">
      <span className={`appt-avatar lg ${avatarTone(a.patient_name)}`} aria-hidden>
        {initials(a.patient_name)}
      </span>
      <div className="vh-who">
        <h1>{a.patient_name}</h1>
        <p>{meta}</p>
      </div>
      <div className="vh-when">
        <strong className={a.status === 'rejected' ? 'cancelled' : ''}>
          {a.status === 'rejected' ? 'Cancelled' : prettyTime(a.start_time)}
        </strong>
        <span>{prettyDate(a.appointment_date)}</span>
      </div>
      {/* "Visit 2 · last seen Thu, 24 Sept" — the one number that changes how
          a doctor reads everything else on the screen. */}
      <span className="vh-visit-chip">
        {visitNumber === 1
          ? 'First visit'
          : `Visit ${visitNumber}${lastSeen ? ` · last seen ${prettyDate(lastSeen)}` : ''}`}
      </span>
    </div>
  );
}

function RxPatient({ appointment: a }: { appointment: Appointment }) {
  const genderAge = [
    a.patient_gender ? a.patient_gender[0].toUpperCase() + a.patient_gender.slice(1) : null,
    a.patient_age != null ? `${a.patient_age} yrs` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="rx-patient">
      <span className={`appt-avatar ${avatarTone(a.patient_name)}`} aria-hidden>
        {initials(a.patient_name)}
      </span>
      <div className="rxp-who">
        <b>{a.patient_name}</b>
        <span>
          {[genderAge, a.patient_mobile].filter(Boolean).join(' · ')}
        </span>
      </div>
      {a.status === 'rejected' && (
        <div className="rxp-cond">
          <span className="chip-warn">Cancelled</span>
        </div>
      )}
    </div>
  );
}

/**
 * The visit's pinned actions: Preview the document, then issue it.
 *
 * Built from flex `order`, not from source order. On a phone the design puts
 * `Issue to patient` full width on its own line with Preview beneath it, and
 * on desktop they sit together at the right-hand end — the same three
 * elements in two different arrangements, which source order cannot give.
 */
function VisitFooter({
  onPreview,
  onIssue,
  issuing,
  alreadyIssued,
  blocked,
  blockedReason,
}: {
  onPreview: () => void;
  onIssue: () => void;
  issuing: boolean;
  alreadyIssued: boolean;
  /** A recording is still becoming a draft; issuing now would miss it. */
  blocked: boolean;
  blockedReason: string;
}) {
  return (
    <div className="vfoot">
      <button className="btn vfoot-preview" onClick={onPreview}>
        <Eye size={16} />
        Preview
      </button>
      {alreadyIssued ? (
        <span className="vfoot-issued">Issued to the patient</span>
      ) : (
        <button
          className="btn btn-primary vfoot-issue"
          onClick={onIssue}
          disabled={issuing || blocked}
          title={blocked ? blockedReason : undefined}
        >
          {issuing ? 'Issuing…' : 'Issue to patient'}
        </button>
      )}
    </div>
  );
}

/**
 * What happened last time, beside the prescription rather than under it.
 *
 * This card was removed from the bottom of the consultation in an earlier
 * round, and rightly: it is reference, not work, and sitting below the
 * prescription meant scrolling past the task to reach it. In two columns that
 * objection goes away — it is next to the task, where a doctor checks what
 * they prescribed last time before writing today's.
 *
 * Three visits, then a link. The full history is its own page and stays so.
 */
function PreviousVisits({ appointment }: { appointment: Appointment }) {
  const navigate = useNavigate();
  const profileId = appointment.patient_profile_id;

  const historyQ = useQuery({
    queryKey: ['appointment-history', profileId, appointment.id],
    queryFn: () => appointmentsApi.history(profileId!, appointment.id),
    enabled: !!profileId,
    staleTime: 60 * 1000,
  });

  // A first visit has no card at all rather than an empty one saying so —
  // the left column is reference, and reference nobody has is just noise.
  if (!profileId || !historyQ.data?.length) return null;

  const visits = historyQ.data.slice(0, 3);

  const total = historyQ.data.length;

  return (
    <div className="card visit-history">
      <div className="rx-lbl-row">
        <span className="section-label">Previous visits</span>
        <span className="vh-count">
          {total} visit{total === 1 ? '' : 's'}
        </span>
      </div>

      <ul className="vh-list">
        {visits.map((v) => {
          const rx = v.e_prescription;
          return (
            <li key={v.id}>
              <button
                type="button"
                className="vh-item"
                onClick={() => navigate(`/appointments/${v.id}`)}
              >
                <span className="vh-h">
                  <b>{prettyDate(v.appointment_date)}</b>
                  {v.description?.trim() && <span>{v.description.trim()}</span>}
                </span>
                <span className="vh-dx">
                  {rx?.diagnosis?.trim() || 'No diagnosis recorded'}
                </span>
                {/*
                  What was prescribed, not just what it was called. This is the
                  question the card is open for — "what did I give them last
                  time" — and a diagnosis alone does not answer it.
                */}
                {rx?.medicines?.length ? (
                  <span className="vh-meds">
                    {rx.medicines.slice(0, 3).map((m, i) => (
                      <span key={i}>
                        {[
                          [m.medicine_name, m.strength].filter(Boolean).join(' '),
                          m.dosage,
                          formatDuration(m.duration_days),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    ))}
                    {rx.medicines.length > 3 && (
                      <span>+{rx.medicines.length - 3} more</span>
                    )}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className="btn btn-sm vh-all"
        onClick={() => navigate(`/appointments/${appointment.id}/history`)}
      >
        <History size={15} />
        {total > visits.length ? `View all ${total} visits` : 'View full history'}
      </button>
    </div>
  );
}

export default function AppointmentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canUpdate = can('appointments', 'update');
  /*
   * Filing a report is gated on `reports`, not on `appointments`, since the
   * upload moved inside the visit — the server flipped the same way. Keeping
   * the button on `appointments:update` would offer a desk an upload the API
   * then refuses, which reads as a broken screen rather than as a permission
   * they do not have. `DELETE /reports/:id` has always been `reports:create`,
   * so the bin follows the same flag.
   */
  const canFileReports = can('reports', 'create');

  const { data: a, isLoading } = useQuery({
    queryKey: ['appointment', id],
    queryFn: () => appointmentsApi.get(id!),
    enabled: !!id,
    // Report summaries finish in the background — keep polling until they do,
    // so "Summarising…" resolves on its own instead of needing a reload.
    refetchInterval: appointmentRefetchInterval,
  });

  const [previewOpen, setPreviewOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  /*
   * How many times this patient has been. The header card leads with it, and
   * `PreviousVisits` in the left column reads the same query — one request,
   * two readers.
   */
  const historyQ = useQuery({
    queryKey: ['appointment-history', a?.patient_profile_id, id],
    queryFn: () => appointmentsApi.history(a!.patient_profile_id!, id),
    enabled: !!a?.patient_profile_id,
    staleTime: 60 * 1000,
  });
  const pastVisits = historyQ.data?.length ?? 0;
  const [optsOpen, setOptsOpen] = useState(false);
  const flushRef = useRef<(() => Promise<void>) | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['appointment', id] });
    qc.invalidateQueries({ queryKey: ['appointments'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  /*
   * The draft's status, which decides whether this visit can still be worked
   * on. An issued prescription is frozen server-side — saving one throws —
   * so a doctor reopening a finished visit must not be sent through "Save
   * prescription" to reach the document they only want to reprint.
   */
  const prescriptionQ = useQuery({
    queryKey: ['prescription', id],
    queryFn: () => consultationApi.prescription(id!),
    enabled: !!id,
  });
  const alreadyIssued = prescriptionQ.data?.status === 'issued';

  /*
   * Is a dictation still being turned into a draft?
   *
   * The recorder reports the parts only it can see — the mic is open, the
   * audio is uploading — and the session says whether the server is still
   * transcribing or drafting. While any of that is true the draft is about
   * to change under the doctor, so "Save prescription" waits: saving a
   * half-written prescription, or the one from before the recording, is the
   * mistake this prevents. Polled here as well as in the recorder, because
   * the recorder is only mounted on its own tab.
   */
  const [recorderBusy, setRecorderBusy] = useState(false);
  const sessionQ = useQuery({
    queryKey: ['consultation', id],
    queryFn: () => consultationApi.session(id!),
    enabled: !!id,
    refetchInterval: (q) => {
      const st = (q.state.data as ConsultationSession | null | undefined)?.status;
      return st === 'recording' || st === 'transcribing' || st === 'drafting' ? 2000 : false;
    },
  });
  const aiDrafting =
    sessionQ.data?.status === 'recording' ||
    sessionQ.data?.status === 'transcribing' ||
    sessionQ.data?.status === 'drafting';
  const draftInFlight = recorderBusy || aiDrafting;

  const consult = useMutation({
    mutationFn: (status: string) => appointmentsApi.setConsultation(id!, status),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e),
  });

  /**
   * Mark the visit finished.
   *
   * Sharing, printing and issuing all end the consultation — the client's
   * decision, and it matches what actually happens in the room: once the
   * patient has the prescription in some form, the visit is over. There is no
   * separate "Complete" button any more.
   *
   * Idempotent on purpose. A doctor may print, notice a wrong dosage, go back,
   * fix it and print again; re-marking a visit that is already done is not an
   * error and must not look like one.
   */
  const markComplete = () => {
    if (!a || a.consultation_status === 'done') return;
    consult.mutate('done');
  };


  /*
   * Is there anything to preview?
   *
   * Four ways a prescription can carry content, and any one of them counts: a
   * diagnosis or advice line, at least one medicine, a handwritten page, or an
   * uploaded scan. Previewing with none of them renders an empty letterhead,
   * which the doctor then issues by reflex — so the CTA refuses instead.
   */
  const hasContent = (draft: EPrescription | undefined) =>
    !!draft?.diagnosis?.trim() ||
    !!draft?.previous_history?.trim() ||
    !!draft?.advice?.trim() ||
    (draft?.medicines?.length ?? 0) > 0 ||
    !!draft?.handwriting_image_url ||
    (a?.prescriptions?.length ?? 0) > 0;

  /*
   * Some visits end without one. A reassurance, a referral, "come back if it
   * gets worse" — the doctor still has to be able to close the appointment,
   * and refusing to move on until something is typed would have them writing
   * a prescription to get past a button.
   */
  const [confirmingNoRx, setConfirmingNoRx] = useState(false);
  const [finishedWithoutRx, setFinishedWithoutRx] = useState(false);

  // ── Cancel ────────────────────────────────────────────────
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  // ── Reschedule ────────────────────────────────────────────
  const [rescheduling, setRescheduling] = useState(false);
  const [rDate, setRDate] = useState<string | null>(null);
  const [rSlot, setRSlot] = useState<Slot | null>(null);
  const closeReschedule = () => {
    setRescheduling(false);
    setRDate(null);
    setRSlot(null);
  };
  // What the doctor sees for a moment after the move: from when, to when.
  const [rescheduledNotice, setRescheduledNotice] = useState<string | null>(null);
  const reschedule = useMutation({
    mutationFn: async () => {
      // Read the old slot before the server overwrites it — the message is
      // about the change, and the change is gone from `a` once it succeeds.
      const was = a ? `${prettyDate(a.appointment_date)} at ${prettyTime(a.start_time)}` : '';
      await appointmentsApi.reschedule(id!, rDate!, rSlot!.start_time);
      return was;
    },
    onSuccess: (was) => {
      invalidate();
      setRescheduledNotice(
        `${a?.patient_name ?? 'The appointment'}'s appointment has been rescheduled from ${was} to ${prettyDate(rDate!)} at ${prettyTime(rSlot!.start_time)}.`,
      );
      closeReschedule();
    },
    onError: (e) => toast.error(e),
  });

  // ── Block this patient's number ───────────────────────────
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  const block = useMutation({
    mutationFn: () =>
      blockedNumbersApi.block(a!.patient_mobile, 'Blocked from a consultation'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blocked-numbers'] });
      toast.success(
        `${a?.patient_name} blocked`,
        'They can no longer book with this clinic.',
      );
      setConfirmingBlock(false);
    },
    onError: (e) => {
      toast.error(e);
      setConfirmingBlock(false);
    },
  });

  const issue = useMutation({
    mutationFn: () => consultationApi.issuePrescription(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prescription', id] });
      invalidate();
      setPreviewOpen(false);
      toast.success(
        `Prescription issued to ${a?.patient_name ?? 'the patient'}`,
        'It is now in their myDigitalOPD account.',
      );
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

  const closed = !a || a.status === 'rejected';
  const canAct = !!a && canUpdate && !closed;

  /**
   * Pushes whatever mode is showing to the server, then reports whether there
   * is anything on the prescription.
   *
   * The order matters and always has: the cached draft is whatever the server
   * last saw, and what the doctor has just typed has not reached it yet, so
   * checking first refuses a prescription that is sitting on screen.
   */
  const flushAndRead = async (): Promise<EPrescription | undefined> => {
    // Nothing to push on a frozen prescription — saving one is refused
    // server-side, and there is nothing unsaved to push anyway.
    if (!alreadyIssued) await flushDraft(flushRef);
    try {
      const draft = await consultationApi.prescription(id!);
      qc.setQueryData(['prescription', id], draft);
      return draft;
    } catch {
      // A draft that cannot be read is not a reason to block the doctor; the
      // request that follows surfaces the real failure.
      return undefined;
    }
  };

  const openPreview = async () => {
    try {
      await flushAndRead();
    } catch (e) {
      // The mode could not save — a duration it could not read, a request
      // that failed. It has marked the field; the toast names it.
      toast.error(e);
      return;
    }
    setPreviewOpen(true);
  };

  /**
   * Issue, or — when there is nothing written — offer to finish without one.
   *
   * An empty prescription is a real outcome the client asked for explicitly,
   * so this asks rather than refuses.
   */
  const onIssue = async () => {
    let draft: EPrescription | undefined;
    try {
      draft = await flushAndRead();
    } catch (e) {
      toast.error(e);
      return;
    }
    if (!hasContent(draft)) {
      setConfirmingNoRx(true);
      return;
    }
    issue.mutate();
  };

  const finishWithoutPrescription = () => {
    setConfirmingNoRx(false);
    setFinishedWithoutRx(true);
    markComplete();
  };

  return (
    <div className="visit-page">
      {/* ── Back, and the two things that are not part of the flow ──── */}
      <div className="visit-topbar">
        <button className="btn btn-sm btn-ghost" onClick={() => navigate('/dashboard')}>
          ← Appointments
        </button>
        <div className="visit-topbar-right">
          {/*
            No status badges here. The design's header is a back link and the
            overflow menu, and "Walk-in pending" was saying two things the
            screen already answers — the patient card shows the booking, and
            the step strip shows how far the consultation has got.
          */}
          {canAct && (
            <div className="opts-wrap">
              <button
                className="opts-btn"
                aria-label="More actions"
                aria-expanded={optsOpen}
                onClick={() => setOptsOpen((v) => !v)}
              >
                ⋮
              </button>
              {optsOpen && (
                <>
                  <div className="opts-backdrop" onClick={() => setOptsOpen(false)} />
                  <div className="opts-menu" role="menu">
                    {/*
                      The actions that used to sit as buttons under the patient
                      card. The design's card is a slim chip inside the
                      prescription panel with no room for them, and they are
                      things a doctor does occasionally rather than while
                      writing — which is what an overflow menu is for.
                    */}
                    {/*
                      Where the rest of the record lives now. The design's
                      left column is reference about the *visit* — previous
                      visits and this visit's reports — and carries no patient
                      card, so the patient's own details (ID, address, the
                      reason they booked) are one tap away on their profile
                      rather than a disclosure taking space in that column.
                    */}
                    {a.patient_profile_id && (
                      <button
                        className="opts-item"
                        role="menuitem"
                        onClick={() => {
                          setOptsOpen(false);
                          navigate(`/patients/${a.patient_profile_id}`);
                        }}
                      >
                        Open patient profile
                      </button>
                    )}
                    <button
                      className="opts-item"
                      role="menuitem"
                      onClick={() => {
                        setOptsOpen(false);
                        navigate(`/appointments/${id}/history`);
                      }}
                    >
                      Patient history
                    </button>
                    <button
                      className="opts-item"
                      role="menuitem"
                      onClick={() => {
                        setOptsOpen(false);
                        setRescheduling(true);
                      }}
                    >
                      Reschedule
                    </button>
                    {/* Plain, not red: a no-show records what happened, it
                        does not act against the patient the way blocking or
                        cancelling does — the client wanted it in black. */}
                    <button
                      className="opts-item"
                      role="menuitem"
                      disabled={consult.isPending || a.consultation_status === 'no_show'}
                      onClick={() => {
                        setOptsOpen(false);
                        consult.mutate('no_show');
                        toast.success(`${a.patient_name} marked as a no-show`);
                      }}
                    >
                      Mark as no-show
                    </button>
                    <button
                      className="opts-item danger"
                      role="menuitem"
                      disabled={consult.isPending || a.consultation_status === 'rejected'}
                      onClick={() => {
                        setOptsOpen(false);
                        setConfirmingCancel(true);
                      }}
                    >
                      Cancel appointment
                    </button>
                    <button
                      className="opts-item danger"
                      role="menuitem"
                      onClick={() => {
                        setOptsOpen(false);
                        setConfirmingBlock(true);
                      }}
                    >
                      Block patient
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/*
        ── Who and when, with the things you do about it ──
        The patient sits at the top of the consultation the way they sit at the
        top of a row in the list: same avatar, same colour, so opening a visit
        is continuous with the list you opened it from.
      */}
      {/*
        ── The visit, on one screen ──────────────────────────
        Reference on the left — what this patient has been through — and the
        work on the right. The stepper is gone: reading a report and writing
        the prescription are the same task, and paging between them meant the
        doctor could not see the report they were prescribing against.
      */}
      {a && (
        <VisitHeaderCard
          appointment={a}
          visitNumber={pastVisits + 1}
          lastSeen={historyQ.data?.[0]?.appointment_date ?? null}
        />
      )}

      <div className={`visit-cols ${finishedWithoutRx ? 'is-finished' : ''}`}>
        <aside className="visit-aside">
          {a && !finishedWithoutRx && <PreviousVisits appointment={a} />}

          {/* This visit's reports — the patient's uploads and the clinic's. */}
          {a && !finishedWithoutRx && (
          <div className="card">
            <div className="rx-lbl-row">
              <span className="section-label">
                Reports{a.reports.length > 0 ? ` (${a.reports.length})` : ''}
              </span>
              {/* The design puts Add on the heading line. It used to be a
                  labelled uploader at the foot of the card, which moved
                  further down the page with every report filed. */}
              {canFileReports && (
                <button
                  type="button"
                  className="link-btn"
                  aria-expanded={uploadOpen}
                  onClick={() => setUploadOpen((v) => !v)}
                >
                  {uploadOpen ? '− Close' : '+ Add'}
                </button>
              )}
            </div>

            {a.reports.length === 0 ? (
              <span className="muted" style={{ fontSize: 13 }}>
                No reports for this visit yet.
              </span>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {a.reports.map((r) => (
                  <ReportCard
                    key={r.id}
                    report={r}
                    canDelete={canFileReports}
                    onRetried={invalidate}
                    onDeleted={invalidate}
                  />
                ))}
              </div>
            )}

            {/*
              One combined summary across every report on the visit, under the
              list rather than over it: the doctor looks at what was actually
              uploaded first, and reads the model's picture of it after — each
              report's own summary sits behind the sparkle button on its row.
            */}
            {a.reports.length > 0 && (
              <div className="stack" style={{ gap: 10, marginTop: 16 }}>
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
            )}

            {/* Filed here rather than on a separate screen: this is the visit
                the report belongs to, and the doctor is already on it. It is
                the last thing on the card — a doctor reads the reports and
                the summary of them before reaching for another upload. */}
            {canFileReports && uploadOpen && (
              <ReportUpload
                appointmentId={a.id}
                onUploaded={() => {
                  invalidate();
                  setUploadOpen(false);
                }}
              />
            )}
          </div>
        )}
        </aside>

        {/* Prescription: record, type, handwrite or upload. */}
        {a && !finishedWithoutRx && (
          <div className="card visit-main">
            <PrescriptionTabs
              appointmentId={id}
              canEdit={canUpdate}
              disabled={closed}
              flushRef={flushRef}
              onRecorderBusy={setRecorderBusy}
              patientChip={<RxPatient appointment={a} />}
              footer={
                canAct ? (
                  <VisitFooter
                    onPreview={openPreview}
                    onIssue={onIssue}
                    issuing={issue.isPending}
                    alreadyIssued={alreadyIssued}
                    blocked={!alreadyIssued && draftInFlight}
                    blockedReason={
                      recorderBusy
                        ? 'Stop the recording first'
                        : 'Wait for the recording to become a draft'
                    }
                  />
                ) : null
              }
            />
          </div>
        )}

        {a && finishedWithoutRx && (
          <div className="success-panel">
            <div className="success-icon" aria-hidden>
              <CheckCircleIcon size={30} />
            </div>
            <div className="success-title">Appointment finished</div>
            <div className="success-sub">
              Closed without a prescription. Nothing was sent to {a.patient_name}.
            </div>
            <div className="success-ctas">
              <button
                className="success-cta primary"
                onClick={() => navigate('/dashboard')}
              >
                Back to appointments
              </button>
              <button
                className="success-cta secondary"
                onClick={() => setFinishedWithoutRx(false)}
              >
                Write a prescription after all
              </button>
            </div>
          </div>
        )}

      </div>

      {/*
        Preview is a modal on the current draft, not a step of its own. It was
        the third step and locked until the prescription had been saved; the
        client dropped both. The document is rendered from whatever is on
        screen — `openPreview` pushes the draft first — so it is always the
        truth rather than the last thing that happened to be saved.
      */}
      {previewOpen && a && (
        <PrescriptionPreviewModal
          onClose={() => setPreviewOpen(false)}
          onIssue={canAct && !alreadyIssued ? onIssue : undefined}
          issuing={issue.isPending}
          load={() => consultationApi.prescriptionPreview(id!)}
        />
      )}

      {/* ── No prescription ──────────────────────────────────── */}
      {confirmingNoRx && a && (
        <ConfirmDialog
          title="Finish without a prescription?"
          message={
            <>
              There is nothing written for this visit — no diagnosis, no
              medicine, no handwritten page and no uploaded scan. You can close
              the appointment as it is, and {a.patient_name} receives nothing.
            </>
          }
          confirmLabel="Finish without one"
          cancelLabel="Keep writing"
          busy={consult.isPending}
          onCancel={() => setConfirmingNoRx(false)}
          onConfirm={finishWithoutPrescription}
        />
      )}

      {/* ── Cancel confirmation ──────────────────────────────── */}
      {confirmingCancel && a && (
        <ConfirmDialog
          title="Cancel this appointment?"
          message={
            <>
              {a.patient_name}'s appointment on {prettyDate(a.appointment_date)} at{' '}
              {prettyTime(a.start_time)} will be cancelled. This can't be undone.
            </>
          }
          confirmLabel="Yes, cancel"
          cancelLabel="Keep appointment"
          destructive
          busy={consult.isPending}
          onCancel={() => setConfirmingCancel(false)}
          onConfirm={() => {
            consult.mutate('rejected', {
              onSuccess: () => {
                toast.success('Appointment cancelled');
                setConfirmingCancel(false);
              },
            });
          }}
        />
      )}

      {/* ── Block confirmation ───────────────────────────────── */}
      {confirmingBlock && a && (
        <ConfirmDialog
          title="Block this patient?"
          message={
            <>
              {a.patient_mobile} will no longer be able to book with this clinic.
              Existing appointments are left alone, and the number can be
              unblocked from the Blocked screen.
            </>
          }
          confirmLabel="Block"
          destructive
          busy={block.isPending}
          onCancel={() => setConfirmingBlock(false)}
          onConfirm={() => block.mutate()}
        />
      )}

      {rescheduledNotice && (
        <FlashNotice
          title="Appointment rescheduled"
          message={rescheduledNotice}
          onDone={() => setRescheduledNotice(null)}
        />
      )}

      {/* ── Reschedule ───────────────────────────────────────── */}
      {rescheduling && a && (
        <Modal
          title="Reschedule appointment"
          onClose={closeReschedule}
          large
          footer={
            <div className="modal-actions">
              <button className="btn" onClick={closeReschedule}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={!rDate || !rSlot || reschedule.isPending}
                onClick={() => reschedule.mutate()}
              >
                {reschedule.isPending ? 'Saving…' : 'Confirm new slot'}
              </button>
            </div>
          }
        >
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
            {a.patient_name} · currently {prettyDate(a.appointment_date)} at{' '}
            {prettyTime(a.start_time)}
          </div>
          <InlineSlotPicker
            doctorId={a.doctor_id}
            onChange={(date, slot) => {
              setRDate(date);
              setRSlot(slot);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

/**
 * One report, with the four things a doctor does to it.
 *
 * Print and download act on the file itself and say nothing about the visit —
 * they deliberately do not close the consultation, which only the prescription
 * does. Both go through the API for the bytes: the report's own URL is a
 * presigned link on another origin, which a browser will open in a tab but
 * will neither save under a `download` attribute nor print from script. The
 * sparkle opens this report's own AI summary, which is the detail behind the
 * combined box at the top of the step. Delete is for the wrong file on the
 * wrong visit — it asks first, because the file goes with it.
 */
function ReportCard({
  report,
  canDelete,
  onRetried,
  onDeleted,
}: {
  report: PatientReport;
  canDelete: boolean;
  onRetried: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'print' | 'download' | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const retry = useMutation({
    mutationFn: () => reportsApi.retrySummary(report.id),
    onSuccess: () => {
      onRetried();
      toast.success('Summarising again…');
    },
    onError: (e) => toast.error(e),
  });

  const remove = useMutation({
    mutationFn: () => reportsApi.remove(report.id),
    onSuccess: () => {
      setConfirmingDelete(false);
      onDeleted();
      toast.success('Report deleted');
    },
    onError: (e) => {
      setConfirmingDelete(false);
      toast.error(e);
    },
  });

  const download = async () => {
    setBusy('download');
    try {
      const { blob, filename } = await reportsApi.file(report.id);
      downloadFile(new File([blob], filename, { type: blob.type }));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const [viewing, setViewing] = useState(false);
  const [fullSummary, setFullSummary] = useState(false);

  const { ai_summary_status: status, ai_summary: summary } = report;
  const ready = status === 'ready' && !!summary;
  const summarising = status === 'pending' || status === 'processing';

  return (
    <div className="report-card">
      <div className="report-top">
        <div className="report-info">
          {/* The name is the control: it opens the file over the visit
              rather than in a browser tab the doctor has to come back from. */}
          <button
            type="button"
            className="report-name"
            onClick={() => setViewing(true)}
            title={`Open ${report.title}`}
          >
            {report.title}
          </button>
          <div className="report-date">
            {report.createdAt &&
              new Date(report.createdAt).toLocaleString(undefined, {
                day: 'numeric',
                month: 'short',
                hour: 'numeric',
                minute: '2-digit',
              })}
            {/* The summary's state, on the row rather than behind the sparkle,
                so "is it done yet?" is answered without opening anything. The
                appointment is re-fetched while this runs, so it clears itself. */}
            {summarising && (
              <span className="report-state summarising">
                <span className="report-state-dot" aria-hidden />
                Summarising…
              </span>
            )}
            {status === 'failed' && (
              <span className="report-state failed">Summary failed</span>
            )}
          </div>
        </div>
        {/*
          View and Print are gone. The row is the control now — clicking the
          report opens it — so a "View" button beside it was a second way to
          do the same thing, and printing a report is something the doctor
          does from the opened file or the letterhead, not from a list row.
        */}
        <div className="report-actions">
          <button
            className="ra-icon-btn"
            onClick={download}
            disabled={busy !== null}
            title="Download"
            aria-label="Download"
          >
            <DownloadIcon size={14} />
          </button>
          <button
            className={`ra-icon-btn ${open ? 'summary-active' : ''} ${summarising ? 'is-busy' : ''}`}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            title={summarising ? 'Summarising…' : 'AI summary'}
            aria-label="AI summary"
          >
            <SparkleIcon size={14} />
          </button>
          {canDelete && (
            <button
              className="ra-icon-btn danger"
              onClick={() => setConfirmingDelete(true)}
              disabled={remove.isPending}
              title="Delete report"
              aria-label="Delete report"
            >
              <TrashIcon size={14} />
            </button>
          )}
        </div>
      </div>

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete this report?"
          message={
            <>
              "{report.title}" and its file will be removed from this visit. The
              summary above is redone without it. This can't be undone.
            </>
          }
          confirmLabel="Delete"
          cancelLabel="Keep it"
          destructive
          busy={remove.isPending}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => remove.mutate()}
        />
      )}

      {viewing && (
        <ReportViewerModal
          title={report.title}
          url={report.url}
          onClose={() => setViewing(false)}
        />
      )}

      {fullSummary && summary && (
        <SummaryModal title={`AI summary · ${report.title}`} onClose={() => setFullSummary(false)}>
          <SummaryBody summary={summary} />
        </SummaryModal>
      )}

      {open && (
        <div className="report-summary">
          {ready ? (
            /*
              Three lines, then an ellipsis and a way in. A report summary runs
              to a paragraph or more and four of them stacked pushed the
              prescription off the screen entirely — which is the wrong thing
              to lose to reference material.
            */
            <>
              <div className="report-summary-clamp">
                <SummaryBody summary={summary} />
              </div>
              <button
                type="button"
                className="link-btn report-readmore"
                onClick={() => setFullSummary(true)}
              >
                Read full report
              </button>
            </>
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
            <div className="stack" style={{ gap: 6 }}>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="muted" style={{ fontSize: 12.5 }}>
                  Couldn't summarise this report.
                </span>
                <button
                  className="btn btn-sm btn-ghost"
                  disabled={retry.isPending}
                  onClick={() => retry.mutate()}
                >
                  {retry.isPending ? 'Retrying…' : 'Retry'}
                </button>
              </div>
              {/* The actual reason, so a fixable cause isn't hidden behind a retry. */}
              {report.ai_summary_error && (
                <span className="muted" style={{ fontSize: 11.5 }}>
                  {report.ai_summary_error}
                </span>
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

// ── Shared sub-components ────────────────────────────────────

/**
 * The combined AI summary across every report on this visit.
 *
 * Currently hidden at the call site (see the Reports card above): the client
 * asked for it off for now, with the option to bring it back. Exported so it
 * stays compiled and ready rather than rotting behind a comment.
 */
export function VisitReportSummary({
  appointmentId, summary, status, error, reportCount, reports, noComparison, onRetried,
}: {
  appointmentId: string;
  summary?: import('../api/types').ReportAiSummary | null;
  status?: import('../api/types').AiJobStatus | null;
  error?: string | null;
  reportCount: number;
  /** This visit's reports, for the multi-report breakdown below the summary. */
  reports?: import('../api/types').PatientReport[];
  /** True when an earlier visit exists but shares no comparable measurement. */
  noComparison?: boolean;
  onRetried: () => void;
}) {
  const toast = useToast();
  const [collapsed, toggleCollapsed] = useCollapsible('visit-summary-v2');
  // Above the early returns below — CLAUDE.md, and the lint rule that caught
  // it when this sat next to the branch that uses it.
  const [fullOpen, setFullOpen] = useState(false);
  const retry = useMutation({
    mutationFn: () => reportsApi.retryVisitSummary(appointmentId),
    onSuccess: () => { onRetried(); toast.success('Combining report summaries…'); },
    onError: (e) => toast.error(e),
  });

  // One report is enough: generation is now the doctor's to ask for, and this
  // card carries the only button that does it. Hiding it below two reports (as
  // it was when summaries generated themselves on upload) left a single-report
  // visit with no way to summarise anything at all.
  if (reportCount < 1 && status !== 'ready') return null;

  const idle = !status || status === 'idle';

  /*
   * Before anything is generated the card is one button and a sentence saying
   * what it will do — no "AI summary" heading, no collapse control, because
   * there is nothing yet to head or fold. The design draws it this way and it
   * is also the honest shape: the doctor is being offered an action, not shown
   * an empty result.
   */
  if (idle) {
    return (
      <div className="ai-offer">
        <button
          type="button"
          className="ai-offer-btn"
          disabled={retry.isPending}
          onClick={() => retry.mutate()}
        >
          <SparkleIcon size={16} />
          {retry.isPending ? 'Generating…' : 'Generate summary with AI'}
        </button>
        <p className="ai-offer-note">
          Reads the attached reports and summarises the findings.
        </p>
      </div>
    );
  }

  return (
    <div className="ai-box">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: collapsed ? 0 : 6 }}>
        <CollapseToggle
          collapsed={collapsed}
          onToggle={toggleCollapsed}
          label="the combined summary"
        >
          <span className="ai-box-title">
            <SparkleIcon size={15} />
            AI summary
          </span>
        </CollapseToggle>
        {/*
          Regenerate and Read full share the header line with the title, as
          the design has them. They were a full `btn` each, which at the left
          column's 340px wrapped onto rows of their own and pushed the summary
          itself down the card — link buttons fit.
        */}
        {status === 'ready' && !collapsed && (
          <span className="ai-box-actions">
            <button className="link-btn" disabled={retry.isPending} onClick={() => retry.mutate()}>
              {retry.isPending ? 'Regenerating…' : 'Regenerate'}
            </button>
            <button className="link-btn" onClick={() => setFullOpen(true)}>
              Read full
            </button>
          </span>
        )}
      </div>
      {collapsed ? null : status === 'pending' || status === 'processing' ? (
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
          {/*
            Three lines, then a way in. A combined summary runs to a paragraph
            and a column of out-of-range values; at full length it pushed the
            prescription off the screen, which is the wrong thing to lose to
            reference material.
          */}
          <div className="report-summary-clamp">
            <SummaryBody summary={summary} />
          </div>
          {noComparison && (
            <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
              The previous visit shares no comparable measurement with this one,
              so there is no trend to show.
            </div>
          )}

          {fullOpen && (
            <SummaryModal title="AI summary" onClose={() => setFullOpen(false)}>
              <SummaryBody summary={summary} />
              {reports && <CombinedSummaryDetail reports={reports} />}
            </SummaryModal>
          )}
        </>
      ) : (
        <span className="muted" style={{ fontSize: 12.5 }}>Waiting for report summaries…</span>
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
