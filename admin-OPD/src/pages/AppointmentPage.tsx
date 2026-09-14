import { Fragment, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  appointmentsApi,
  blockedNumbersApi,
  consultationApi,
  reportsApi,
} from '../api/endpoints';
import type { ConsultationSession, EPrescription, PatientReport, Slot } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { ConfirmDialog, Loading, Modal } from '../components/ui';
import { InlineSlotPicker } from '../components/InlineSlotPicker';
import { PrescriptionTabs } from '../components/PrescriptionTabs';
import { PrescriptionPreviewPanel } from '../components/PrescriptionPreview';
import { flushDraft } from '../lib/draftFlush';
import { ProgressSummaryCard } from '../components/ProgressSummaryCard';
import { CombinedSummaryDetail } from '../components/CombinedSummaryDetail';
import { CollapseToggle } from '../components/CollapseToggle';
import { ReportUpload } from '../components/ReportUpload';
import { printBlob } from '../lib/printBlob';
import { downloadFile } from '../lib/shareFile';
import { useCollapsible } from '../lib/collapsePreference';
import { appointmentRefetchInterval, hasTrajectory } from '../lib/summaryPolling';
import { avatarTone, initials } from '../lib/avatar';
import {
  CheckCircleIcon,
  DownloadIcon,
  PhoneIcon,
  PrinterIcon,
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

/** The consultation, in the order it is worked through. */
const VISIT_STEPS = ['Reports', 'Prescription', 'Preview'] as const;
type VisitStep = 1 | 2 | 3;

/*
 * Where the doctor was, per visit.
 *
 * On a phone the page does not survive a trip to another app: take a call,
 * share the prescription on WhatsApp, come back, and Chrome has thrown the
 * tab away and reloads it from scratch — on step 1. The step, and whether
 * Preview has been earned, are kept per appointment so the reload lands
 * where the doctor left. Storage can be absent or throw; then the visit
 * simply starts at Reports as it always did.
 */
const STEP_KEY = 'opd_admin_visit_step:';

function readVisitState(appointmentId: string): { step: VisitStep; savedOnce: boolean } | null {
  try {
    const raw = localStorage.getItem(STEP_KEY + appointmentId);
    if (!raw) return null;
    const v = JSON.parse(raw) as { step?: number; savedOnce?: boolean };
    const step = v.step === 2 || v.step === 3 ? v.step : 1;
    return { step, savedOnce: v.savedOnce === true };
  } catch {
    return null;
  }
}

function writeVisitState(appointmentId: string, state: { step: VisitStep; savedOnce: boolean }) {
  try {
    localStorage.setItem(STEP_KEY + appointmentId, JSON.stringify(state));
  } catch {
    // A position that cannot be remembered still applies for the session.
  }
}

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

  /*
   * Which of the three steps is showing. Reports first: it is what the doctor
   * reads before they write anything.
   */
  const [step, setStep] = useState<VisitStep>(() => (id && readVisitState(id)?.step) || 1);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [optsOpen, setOptsOpen] = useState(false);
  const flushRef = useRef<(() => Promise<void>) | null>(null);

  /*
   * Preview is reached by saving, not by clicking.
   *
   * The client asked for the later steps to be earned: the doctor presses
   * "Save prescription", the draft goes to the server, and only then does the
   * document that would be issued become something to look at. Once unlocked
   * it stays unlocked — going back to fix a dosage should not re-lock the page
   * you were just on.
   */
  const [savedOnce, setSavedOnce] = useState(() => (id ? readVisitState(id)?.savedOnce : false) ?? false);

  // Re-render the document each time the Preview step is opened.
  useEffect(() => {
    if (step === 3) setPreviewNonce((n) => n + 1);
  }, [step]);

  useEffect(() => {
    if (id) writeVisitState(id, { step, savedOnce });
  }, [id, step, savedOnce]);

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
      return st === 'transcribing' || st === 'drafting' ? 2000 : false;
    },
  });
  const aiDrafting =
    sessionQ.data?.status === 'transcribing' || sessionQ.data?.status === 'drafting';
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
  const reschedule = useMutation({
    mutationFn: () => appointmentsApi.reschedule(id!, rDate!, rSlot!.start_time),
    onSuccess: () => {
      invalidate();
      toast.success('Appointment rescheduled');
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

  const closed = !a || a.status === 'rejected';
  const canAct = !!a && canUpdate && !closed;

  // Preview is earned by saving — unless the prescription is already issued,
  // in which case there is nothing left to save and the document exists.
  const previewUnlocked = savedOnce || alreadyIssued;

  const goStep = (n: VisitStep) => {
    if (n === 3 && !previewUnlocked) return;
    setStep(n);
  };

  const onCta = async () => {
    if (step === 1) {
      setStep(2);
      return;
    }

    // Nothing to save on a frozen prescription; go straight to the document.
    if (alreadyIssued) {
      setStep(3);
      return;
    }

    /*
     * Step 2: save whatever mode is showing, *then* decide whether there is
     * anything to preview.
     *
     * The order matters. The cached draft is whatever the server last saw, and
     * what the doctor has just typed has not reached it yet — checking first
     * would refuse a prescription that is sitting right there on screen.
     */
    try {
      await flushDraft(flushRef);
    } catch (e) {
      // The mode could not save — a duration it could not read, a request
      // that failed. It has marked the field; the toast names it.
      toast.error(e);
      return;
    }
    let draft: EPrescription | undefined;
    try {
      draft = await consultationApi.prescription(id);
      qc.setQueryData(['prescription', id], draft);
    } catch {
      // A draft that cannot be read is not a reason to block the doctor; the
      // preview request that follows will surface the real failure.
    }

    if (!hasContent(draft)) {
      // Not an error: an empty prescription is a real outcome, so this asks
      // rather than refuses.
      setConfirmingNoRx(true);
      return;
    }

    setSavedOnce(true);
    setStep(3);
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
                    <button
                      className="opts-item danger"
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
      <div className="visit-patient-col">
      {a && (
        <div className="patient-card">
          <div className="pc-row">
            <span className={`appt-avatar ${avatarTone(a.patient_name)}`} aria-hidden>
              {initials(a.patient_name)}
            </span>
            <div className="pc-info">
              <h1 className="pc-name">{a.patient_name}</h1>
              <div className="pc-meta">
                {genderAge}
                {genderAge && a.patient_mobile ? ' · ' : ''}
                {a.patient_mobile && (
                  <>
                    <PhoneIcon />
                    <span className="pc-mobile">{a.patient_mobile}</span>
                  </>
                )}
              </div>
            </div>
            <div className="pc-time">
              <div className={`pc-time-val ${a.status === 'rejected' ? 'cancelled' : ''}`}>
                {a.status === 'rejected' ? 'Cancelled' : prettyTime(a.start_time)}
              </div>
              <div className="pc-time-date">{prettyDate(a.appointment_date)}</div>
            </div>
          </div>

          {canAct && (
            <div className="patient-actions">
              <button
                className="pa-btn history"
                onClick={() => navigate(`/appointments/${id}/history`)}
              >
                Patient history
              </button>
              <button
                className="pa-btn cancel"
                disabled={consult.isPending || a.consultation_status === 'rejected'}
                onClick={() => setConfirmingCancel(true)}
              >
                Cancel
              </button>
              <button className="pa-btn reschedule" onClick={() => setRescheduling(true)}>
                Reschedule
              </button>
            </div>
          )}
        </div>
      )}

      {/*
        The design's card carries only name, age and number. The rest of the
        record — the patient's ID on this account, where they live, what they
        came in for — is still needed occasionally and would be a regression to
        drop, so it folds away here instead of taking a card of its own.
      */}
      {a && (
        <details className="patient-more">
          <summary>Patient details</summary>
          <div className="patient-more-grid">
            {a.patientProfile && (
              <Field
                label="Patient ID"
                value={`${a.patientProfile.patient_code}${
                  a.patientProfile.relation ? ` · ${a.patientProfile.relation}` : ''
                }`}
              />
            )}
            {a.doctor?.name && <Field label="Doctor" value={a.doctor.name} />}
            {a.patient_address && (
              <Field
                wide
                label="Address"
                value={[a.patient_address, a.patient_city, a.patient_state, a.patient_pincode]
                  .filter(Boolean)
                  .join(', ')}
              />
            )}
            {a.description && <Field wide label="Reason" value={a.description} />}
          </div>
        </details>
      )}
      </div>

      {/*
        ── The consultation as three steps ───────────────────
        Reports, then the prescription, then the document you are about to
        issue. Preview is locked until the prescription has been saved — the
        client's call, and it stops a doctor previewing a blank letterhead and
        issuing it.
      */}
      <ol className="steps2" aria-label="Consultation progress">
        {VISIT_STEPS.map((label, i) => {
          const n = (i + 1) as VisitStep;
          const locked = n === 3 && !previewUnlocked;
          return (
            <Fragment key={label}>
              {i > 0 && <li className={`step2-track ${step > i ? 'done' : ''}`} aria-hidden />}
              <li className="step2-item">
                <button
                  type="button"
                  className={`step2 ${step === n ? 'active' : step > n ? 'done' : ''} ${
                    locked ? 'locked' : ''
                  }`}
                  aria-current={step === n ? 'step' : undefined}
                  disabled={locked}
                  title={locked ? 'Save the prescription first' : undefined}
                  onClick={() => goStep(n)}
                >
                  <span className="step2-dot" aria-hidden>{step > n ? '✓' : n}</span>
                  <span className="step2-label">{label}</span>
                </button>
              </li>
            </Fragment>
          );
        })}
      </ol>

      {/* ── The step being worked on ─────────────────────────── */}
      <div className="visit-panel">
        {/* This visit's reports — the patient's uploads and the clinic's. */}
        {a && step === 1 && !finishedWithoutRx && (
          <div className="card">
            {/*
              One combined summary, which is what the design shows: the box at
              the top is the picture across every report on the visit, and each
              report's own summary sits behind the sparkle button on its row.
            */}
            {a.reports.length > 0 && (
              <div className="stack" style={{ gap: 10, marginBottom: 14 }}>
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
            )}

            <div className="section-label">
              Reports{a.reports.length > 0 ? ` (${a.reports.length})` : ''}
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
                    canDelete={canUpdate}
                    onRetried={invalidate}
                    onDeleted={invalidate}
                  />
                ))}
              </div>
            )}

            {/* Filed here rather than on a separate screen: this is the visit
                the report belongs to, and the doctor is already on it. */}
            {canUpdate && (
              <>
                <div className="section-label">Add more reports</div>
                <ReportUpload appointmentId={a.id} onUploaded={invalidate} />
              </>
            )}
          </div>
        )}

        {/* Prescription: record, type, handwrite or upload. */}
        {a && step === 2 && !finishedWithoutRx && (
          <div className="card">
            <PrescriptionTabs
              appointmentId={id}
              canEdit={canUpdate}
              disabled={closed}
              flushRef={flushRef}
              onRecorderBusy={setRecorderBusy}
            />
          </div>
        )}

        {/*
          The draft on the letterhead, as its own step.
          `previewNonce` is bumped every time this step is opened so the
          document is re-rendered rather than served from the last visit —
          the prescription behind it has usually changed in between.
        */}
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

        {a && step === 3 && !finishedWithoutRx && (
          <PrescriptionPreviewPanel
            appointmentId={a.id}
            patientName={a.patient_name}
            canIssue={canAct}
            alreadyIssued={alreadyIssued}
            reloadKey={previewNonce}
            onEdit={() => setStep(2)}
            onFinished={markComplete}
            onBackToList={() => navigate('/dashboard')}
            onDeleted={() => {
              // Nothing to preview any more: back to a blank editor, and the
              // preview step is locked again until something is saved.
              setSavedOnce(false);
              setStep(2);
            }}
            load={async () => {
              // Whichever mode was showing gets to push its draft first —
              // except on a frozen prescription, where saving is refused and
              // there is nothing unsaved to push anyway.
              if (!alreadyIssued) await flushDraft(flushRef);
              return consultationApi.prescriptionPreview(id!);
            }}
          />
        )}
      </div>

      {/*
        The next action, pinned to the bottom of the screen. Step 3 is the end
        of the sequence and carries its own actions, so the bar goes away there.
      */}
      {canAct && step < 3 && !finishedWithoutRx && (
        <div className="visit-bottom-bar">
          <div className="visit-bottom-inner">
            {step === 2 && (
              <button className="btn btn-secondary-cta" onClick={() => setStep(1)}>
                Back
              </button>
            )}
            <button
              className="btn-cta"
              onClick={onCta}
              disabled={step === 2 && !alreadyIssued && draftInFlight}
              title={
                step === 2 && !alreadyIssued && draftInFlight
                  ? 'Wait for the recording to become a draft'
                  : undefined
              }
            >
              {step === 1
                ? 'Write prescription'
                : alreadyIssued
                  ? 'View prescription'
                  : recorderBusy
                    ? 'Recording…'
                    : aiDrafting
                      ? 'Drafting from recording…'
                      : 'Save prescription'}
            </button>
          </div>
        </div>
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

  const print = async () => {
    setBusy('print');
    try {
      const { blob } = await reportsApi.file(report.id);
      const outcome = await printBlob(blob);
      if (outcome === 'opened') {
        toast.success(
          'Report opened in a new tab',
          'This browser would not open the print dialog itself — print it from there.',
        );
      }
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

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

  const { ai_summary_status: status, ai_summary: summary } = report;
  const ready = status === 'ready' && !!summary;

  return (
    <div className="report-card">
      <div className="report-top">
        <div className="report-info">
          <a
            className="report-name"
            href={report.url}
            target="_blank"
            rel="noreferrer"
            title={report.title}
          >
            {report.title}
          </a>
          {report.createdAt && (
            <div className="report-date">
              {new Date(report.createdAt).toLocaleString(undefined, {
                day: 'numeric',
                month: 'short',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </div>
          )}
        </div>
        <div className="report-actions">
          <button
            className="ra-icon-btn"
            onClick={print}
            disabled={busy !== null}
            title="Print"
            aria-label="Print"
          >
            <PrinterIcon size={14} />
          </button>
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
            className={`ra-icon-btn ${open ? 'summary-active' : ''}`}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            title="AI summary"
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

      {open && (
        <div className="report-summary">
          {ready ? (
            <SummaryBody summary={summary} />
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

function Field({
  label,
  value,
  /** Spans every column — for values long enough to wrap. */
  wide,
}: {
  label: string;
  value?: string | null;
  wide?: boolean;
}) {
  if (!value) return null;
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'baseline',
        fontSize: 13,
        lineHeight: 1.5,
        gridColumn: wide ? '1 / -1' : undefined,
      }}
    >
      <span className="muted" style={{ flex: '0 0 96px', fontSize: 12 }}>{label}</span>
      <span style={{ fontWeight: 500, minWidth: 0, overflowWrap: 'anywhere' }}>{value}</span>
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
  const [collapsed, toggleCollapsed] = useCollapsible('visit-summary-v2');
  const retry = useMutation({
    mutationFn: () => reportsApi.retryVisitSummary(appointmentId),
    onSuccess: () => { onRetried(); toast.success('Combining report summaries…'); },
    onError: (e) => toast.error(e),
  });

  if (reportCount < 2 && status !== 'ready') return null;

  return (
    <div className="ai-box">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: collapsed ? 0 : 6 }}>
        <CollapseToggle
          collapsed={collapsed}
          onToggle={toggleCollapsed}
          label="the combined summary"
        >
          <span className="ai-box-title">
            <SparkleIcon size={16} />
            AI summary
            {count ? ` · ${count} report${count > 1 ? 's' : ''}` : ''}
          </span>
        </CollapseToggle>
        {status === 'ready' && !collapsed && (
          <button className="btn btn-sm btn-ghost" disabled={retry.isPending} onClick={() => retry.mutate()}>
            {retry.isPending ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>
      {collapsed ? null : status === 'processing' ? (
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
