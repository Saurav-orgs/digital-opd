import { Link } from 'react-router-dom';
import type { Appointment } from '../api/types';
import { Badge } from './ui';
import { PhoneIcon } from './icons';
import { displayStatus } from '../lib/appointmentStatus';

/**
 * One past visit, as a card.
 *
 * Shared by the two screens that list a patient's history — the one reached
 * from inside a consultation and the one reached from the Patients list. They
 * differ only in how they find the patient, never in how a visit reads.
 */
export function HistoryVisit({ visit: h }: { visit: Appointment }) {
  return (
    <div className="card history-visit">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        {/* Opens that visit in full — its own reports and its own summary,
            which the doctor often wants to read rather than just the note. */}
        <Link to={`/appointments/${h.id}`} className="history-visit-date">
          {h.appointment_date} · {h.start_time?.slice(0, 5)}
        </Link>
        <Badge value={displayStatus(h)} />
      </div>

      {h.doctor?.name && (
        <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
          Seen by {h.doctor.name}
        </div>
      )}
      {h.description && (
        <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
          Reason: {h.description}
        </div>
      )}
      {h.doctor_notes && (
        <div style={{ fontSize: 13, marginTop: 6, whiteSpace: 'pre-wrap' }}>{h.doctor_notes}</div>
      )}

      {h.prescriptions.length > 0 && (
        <>
          <div className="history-sub-label">Prescriptions</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {h.prescriptions.map((p) => (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                <img
                  src={p.url}
                  alt="Prescription"
                  style={{
                    width: 56,
                    height: 56,
                    objectFit: 'cover',
                    borderRadius: 8,
                    border: 'var(--hairline)',
                  }}
                />
              </a>
            ))}
          </div>
        </>
      )}

      {h.reports.length > 0 && (
        <>
          <div className="history-sub-label">Reports</div>
          <div className="stack" style={{ gap: 4 }}>
            {h.reports.map((r) => (
              <div
                key={r.id}
                className="row"
                style={{ justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}
              >
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  📄 {r.title}
                </span>
                <a
                  className="btn btn-sm"
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ flexShrink: 0 }}
                >
                  View report
                </a>
              </div>
            ))}
          </div>
        </>
      )}

      {h.patient_mobile && (
        <a className="appt-phone" href={`tel:${h.patient_mobile}`}>
          <PhoneIcon />
          {h.patient_mobile}
        </a>
      )}
    </div>
  );
}
