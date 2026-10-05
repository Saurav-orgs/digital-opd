import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  CalendarPlus,
  FileText,
  LockOpen,
  MoreHorizontal,
  Pencil,
  Plus,
} from 'lucide-react';
import { prettyDate, prettyGender } from '../lib/patientFormat';
import {
  appointmentsApi,
  blockedNumbersApi,
  patientProfilesApi,
} from '../api/endpoints';
import type { Appointment, ClinicPatient, PatientOverview } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { ConfirmDialog, Empty, Loading } from '../components/ui';
import { avatarTone, initials } from '../lib/avatar';
import { HistoryVisit } from '../components/HistoryVisit';
import { PatientFormModal } from '../components/PatientFormModal';
import { WalkInModal } from '../components/WalkInModal';
import { useAnchoredMenu } from '../lib/anchoredMenu';

/**
 * One patient's whole record, reached from the Patients list.
 *
 * Built on the aggregated `overview` endpoint — which works even for a patient
 * the clinic has registered but not yet seen — plus the visit history for the
 * rich per-visit cards. The layout follows the redesign: an identity card with
 * the numbers that matter across the top, then the clinical picture and
 * documents down one side and the visit history down the other.
 */
export default function PatientDetailPage() {
  const { profileId } = useParams<{ profileId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { can, user, isDoctor } = useAuth();
  const doctorId = user?.doctorId ?? undefined;
  const canBlock = can('appointments', 'update') || isDoctor;
  const canEdit = can('patients', 'update') || isDoctor;
  const canBook = can('appointments', 'create') || isDoctor;

  const overviewQ = useQuery({
    queryKey: ['patient-overview', profileId],
    queryFn: () => patientProfilesApi.overview(profileId!),
    enabled: !!profileId,
  });
  const historyQ = useQuery({
    queryKey: ['patient-visits', profileId],
    queryFn: () => appointmentsApi.history(profileId!),
    enabled: !!profileId,
  });

  const o = overviewQ.data;
  const visits = historyQ.data ?? [];
  const mobile = o?.profile.mobile ?? visits[0]?.patient_mobile ?? '';

  // Everyone else registered on this number — the family card.
  const familyQ = useQuery({
    queryKey: ['patients-by-mobile', mobile],
    queryFn: () => patientProfilesApi.byMobile(mobile),
    enabled: /^[6-9]\d{9}$/.test(mobile),
  });
  const family = (familyQ.data ?? []).filter((p) => p.id !== profileId);

  // The block lives on the number, so a family sharing a phone is blocked
  // together — the same rule the Blocked screen applies.
  const blockedQ = useQuery({
    queryKey: ['blocked-numbers'],
    queryFn: blockedNumbersApi.list,
    enabled: canBlock,
  });
  const blockRow = mobile
    ? blockedQ.data?.find((b) => b.mobile === mobile) ?? null
    : null;

  // ── Local UI: the overflow menu, the edit form, the walk-in, the confirm ──
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const { menuRef, style: menuStyle } = useAnchoredMenu(menuOpen, menuBtn, () =>
    setMenuOpen(false),
  );
  const [editOpen, setEditOpen] = useState(false);
  const [addFamilyOpen, setAddFamilyOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const [confirming, setConfirming] = useState<'block' | 'unblock' | null>(null);

  const blockMut = useMutation({
    mutationFn: () => blockedNumbersApi.block(mobile, 'Blocked from patient profile'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blocked-numbers'] });
      toast.success(`${o?.profile.name} blocked`, 'They can no longer book with this clinic.');
      setConfirming(null);
    },
    onError: (e) => {
      toast.error(e);
      setConfirming(null);
    },
  });
  const unblockMut = useMutation({
    mutationFn: () => blockedNumbersApi.unblock(blockRow!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blocked-numbers'] });
      toast.success('Number unblocked');
      setConfirming(null);
    },
    onError: (e) => {
      toast.error(e);
      setConfirming(null);
    },
  });

  if (overviewQ.isLoading) return <Loading />;

  if (!o) {
    return (
      <div className="patient-profile">
        <div className="profile-topbar">
          <button className="btn btn-ghost" onClick={() => navigate('/patients')}>
            <ArrowLeft size={16} /> Patients
          </button>
        </div>
        <Empty>This patient could not be found.</Empty>
      </div>
    );
  }

  const p = o.profile;
  const genderAge = [prettyGender(p.gender), p.age != null ? `${p.age} yrs` : null]
    .filter(Boolean)
    .join(' · ');

  const upcoming = computeUpcoming(visits);

  const editingPatient: ClinicPatient = {
    id: p.id,
    patient_code: p.patient_code,
    name: p.name,
    relation: p.relation,
    gender: p.gender,
    dob: p.dob,
    address_line: null,
    city: null,
    state: null,
    pincode: null,
    last_age: p.age,
    last_visit_date: o.last_visit,
    visit_count: o.visit_count,
    can_delete: false,
    mobile,
    blood_group: p.blood_group ?? null,
    conditions: p.recorded_conditions ?? [],
    long_term_medicines: p.recorded_long_term_medicines ?? [],
  };

  return (
    <div className="patient-profile">
      <div className="profile-topbar">
        <button className="btn btn-ghost" onClick={() => navigate('/patients')}>
          <ArrowLeft size={16} /> Patients
        </button>
        <div className="toolbar-grow" />
        {canBook && mobile && (
          <button className="btn btn-primary" onClick={() => setBookOpen(true)}>
            <CalendarPlus size={16} /> Book appointment
          </button>
        )}
        {(canEdit || canBlock) && (
          <div className="profile-menu-wrap">
            <button
              ref={menuBtn}
              className="btn btn-icon"
              aria-label="More actions"
              aria-haspopup="menu"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <MoreHorizontal size={18} />
            </button>
            {menuOpen && (
              <div
                ref={menuRef}
                className="action-menu-dropdown"
                role="menu"
                style={{ ...menuStyle, zIndex: 70 }}
              >
                {canEdit && (
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setEditOpen(true);
                    }}
                  >
                    <Pencil size={15} /> Edit details
                  </button>
                )}
                {canBlock && mobile && (
                  <button
                    role="menuitem"
                    className={blockRow ? '' : 'danger'}
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirming(blockRow ? 'unblock' : 'block');
                    }}
                  >
                    {blockRow ? <LockOpen size={15} /> : <Ban size={15} />}
                    {blockRow ? 'Unblock number' : 'Block number'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Identity card with the figures that matter across a record. */}
      <div className="card profile-head">
        <span className={`appt-avatar lg ${avatarTone(p.name)}`} aria-hidden>
          {initials(p.name)}
        </span>
        <div className="profile-who">
          <h1>
            {p.name}
            {blockRow && (
              <span
                className="appt-badge cancelled"
                title={blockRow.reason || 'Cannot book online with this clinic'}
              >
                Number blocked
              </span>
            )}
          </h1>
          <div className="pc-meta">{[genderAge, mobile].filter(Boolean).join(' · ')}</div>
          {p.patient_code && (
            <div className="muted" style={{ fontSize: 12 }}>
              {p.patient_code}
              {p.relation && p.relation !== 'self' ? ` · ${prettyGender(p.relation)}` : ''}
            </div>
          )}
        </div>
        <div className="profile-stats">
          <Stat value={String(o.visit_count)} label="Visits" />
          <Stat value={prettyDate(o.last_visit)} label="Last visit" />
          <Stat value={String(upcoming.length)} label="Upcoming" />
          <Stat value={prettyDate(p.registered_at?.slice(0, 10) ?? null)} label="Registered" />
        </div>
      </div>

      <div className="profile-grid">
        <div className="profile-col">
          <ProfileCard
            title="Upcoming"
            action={
              canBook && mobile
                ? { label: '+ Book', onClick: () => setBookOpen(true) }
                : undefined
            }
          >
            {upcoming.length ? (
              <div className="stack" style={{ gap: 8 }}>
                {upcoming.map((v) => (
                  <div key={v.id} className="upcoming-row">
                    <CalendarPlus size={16} className="upcoming-ico" aria-hidden />
                    <div>
                      <div className="upcoming-when">
                        {prettyDate(v.appointment_date)} · {v.start_time?.slice(0, 5)}
                      </div>
                      {v.description && <div className="muted">{v.description}</div>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No appointment booked.</p>
            )}
          </ProfileCard>

          <ProfileCard
            title="Clinical summary"
            action={canEdit ? { label: 'Edit', onClick: () => setEditOpen(true) } : undefined}
          >
            <ClinicalSummary profile={p} />
          </ProfileCard>

          <ProfileCard
            title="All documents"
            meta={o.reports.length ? `${o.reports.length} file${o.reports.length === 1 ? '' : 's'}` : undefined}
          >
            {o.reports.length ? (
              <div className="stack" style={{ gap: 2 }}>
                {o.reports.map((r) => (
                  <a
                    key={r.id}
                    className="doc-row"
                    href={r.url ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <FileText size={16} aria-hidden />
                    <span className="doc-name">{r.title}</span>
                    <span className="muted">{prettyDate(r.visit_date)}</span>
                  </a>
                ))}
              </div>
            ) : (
              <p className="muted">No reports uploaded yet.</p>
            )}
          </ProfileCard>

          <ProfileCard
            title="Family on this number"
            action={
              canEdit && mobile
                ? { label: '+ Add', onClick: () => setAddFamilyOpen(true) }
                : undefined
            }
          >
            {family.length ? (
              <div className="stack" style={{ gap: 6 }}>
                {family.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="family-row"
                    onClick={() => navigate(`/patients/${f.id}`)}
                  >
                    <span className={`appt-avatar sm ${avatarTone(f.name)}`} aria-hidden>
                      {initials(f.name)}
                    </span>
                    <div>
                      <div className="family-name">{f.name}</div>
                      <div className="muted">
                        {[prettyGender(f.gender), f.dob ? `${ageFrom(f.dob)} yrs` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">Only patient on {mobile || 'this number'}.</p>
            )}
          </ProfileCard>
        </div>

        <ProfileCard
          title="Visit history"
          meta={visits.length ? `${visits.length} visit${visits.length === 1 ? '' : 's'}` : undefined}
          className="profile-visits"
        >
          {historyQ.isLoading ? (
            <Loading />
          ) : visits.length ? (
            <div className="stack" style={{ gap: 12 }}>
              {visits.map((v: Appointment) => (
                <HistoryVisit key={v.id} visit={v} />
              ))}
            </div>
          ) : (
            <Empty>{p.name} hasn’t been seen at the clinic yet.</Empty>
          )}
        </ProfileCard>
      </div>

      {editOpen && (
        <PatientFormModal
          editing={editingPatient}
          allPatients={[]}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            qc.invalidateQueries({ queryKey: ['patient-overview', profileId] });
            qc.invalidateQueries({ queryKey: ['patients-by-mobile', mobile] });
          }}
        />
      )}

      {addFamilyOpen && mobile && (
        <PatientFormModal
          presetMobile={mobile}
          allPatients={[]}
          onClose={() => setAddFamilyOpen(false)}
          onSaved={(saved) => {
            setAddFamilyOpen(false);
            navigate(`/patients/${saved.id}`);
          }}
        />
      )}

      {bookOpen && doctorId && mobile && (
        <WalkInModal
          doctorId={doctorId}
          initialMobile={mobile}
          onClose={() => setBookOpen(false)}
        />
      )}

      {confirming === 'block' && (
        <ConfirmDialog
          title="Block this number?"
          message={
            <>
              {mobile} will no longer be able to book with this clinic. Everyone
              registered on it is affected. Existing appointments are left alone,
              and the number can be unblocked from here or from the Blocked screen.
            </>
          }
          confirmLabel="Block"
          destructive
          busy={blockMut.isPending}
          onCancel={() => setConfirming(null)}
          onConfirm={() => blockMut.mutate()}
        />
      )}
      {confirming === 'unblock' && blockRow && (
        <ConfirmDialog
          title="Unblock this number?"
          confirmLabel="Unblock"
          busy={unblockMut.isPending}
          message={
            <>
              <strong>{p.name}</strong> ({mobile}) will be able to book online with
              your clinic again.
            </>
          }
          onCancel={() => setConfirming(null)}
          onConfirm={() => unblockMut.mutate()}
        />
      )}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="profile-stat">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function ProfileCard({
  title,
  meta,
  action,
  className,
  children,
}: {
  title: string;
  meta?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`card profile-card ${className ?? ''}`.trim()}>
      <div className="profile-card-head">
        <h3>{title}</h3>
        {meta && <span className="muted">{meta}</span>}
        {action && (
          <button className="link-btn" onClick={action.onClick}>
            {action.label.startsWith('+') ? <Plus size={13} /> : null}
            {action.label.replace(/^\+\s*/, '')}
          </button>
        )}
      </div>
      <div className="profile-card-body">{children}</div>
    </div>
  );
}

function ClinicalSummary({ profile }: { profile: PatientOverview['profile'] }) {
  const conds = profile.recorded_conditions ?? [];
  const meds = profile.recorded_long_term_medicines ?? [];
  return (
    <dl className="summary-rows">
      <SummaryRow label="Blood group">
        {profile.blood_group || <span className="muted">Not known</span>}
      </SummaryRow>
      <SummaryRow label="Conditions">
        {conds.length ? (
          <span className="cond-chips">
            {conds.map((c) => (
              <span key={c} className="cond-chip">
                {c}
              </span>
            ))}
          </span>
        ) : (
          <span className="muted">None recorded</span>
        )}
      </SummaryRow>
      <SummaryRow label="Long-term">
        {meds.length ? (
          <span>
            {meds.map((m, i) => (
              <span key={m}>
                {i > 0 && <br />}
                {m}
              </span>
            ))}
          </span>
        ) : (
          <span className="muted">None recorded</span>
        )}
      </SummaryRow>
      <SummaryRow label="Date of birth">
        {profile.dob ? prettyDate(profile.dob) : <span className="muted">Not recorded</span>}
      </SummaryRow>
    </dl>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="summary-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Future confirmed appointments, soonest first. Date read here, outside render. */
function computeUpcoming(visits: Appointment[]): Appointment[] {
  const today = new Date().toISOString().slice(0, 10);
  return visits
    .filter((v) => v.status === 'confirmed' && (v.appointment_date ?? '') >= today)
    .toSorted(
      (a, b) =>
        (a.appointment_date ?? '').localeCompare(b.appointment_date ?? '') ||
        (a.start_time ?? '').localeCompare(b.start_time ?? ''),
    );
}

/** Age in whole years from YYYY-MM-DD, for the family rows. */
function ageFrom(dob: string): number | string {
  const born = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(born.getTime())) return '';
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const md = now.getMonth() - born.getMonth();
  if (md < 0 || (md === 0 && now.getDate() < born.getDate())) age--;
  return age;
}
