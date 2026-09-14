import { useState } from 'react';
import { doctorsApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import type { Doctor } from '../api/types';
import { useToast } from './Toast';
import { Modal } from './ui';
import { downloadFile } from '../lib/shareFile';

/** The public booking page for a doctor, from whatever the profile carries. */
export function bookingUrlOf(doctor: Doctor): string {
  if (doctor.booking_url) return doctor.booking_url;
  const base = (doctor.profile_base_url || window.location.origin.replace(':5173', ':5174')).replace(/\/+$/, '');
  return `${base}/d/${doctor.public_slug}`;
}

/**
 * The doctor's booking QR and link, as a dialog.
 *
 * Reached from the appointment list, next to Walk In: a patient at the desk
 * asking "how do I book next time?" is answered by turning the screen round
 * or pressing Share, without a trip to My profile. The same picture and
 * buttons live on the profile page, which is where the code is managed.
 */
export function BookingQrModal({ doctor, onClose }: { doctor: Doctor; onClose: () => void }) {
  const toast = useToast();
  const url = bookingUrlOf(doctor);

  return (
    <Modal title="Booking link & QR" onClose={onClose}>
      <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
        Patients scan this to book with {doctor.name} directly.
      </p>
      {doctor.qr_code_url ? (
        <div className="qr-sheet">
          <img src={doctor.qr_code_url} alt="Booking QR code" className="qr-sheet-img" />
        </div>
      ) : (
        <div className="empty">No QR code has been generated for this profile yet.</div>
      )}
      <div className="qr-link">{url}</div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          className="btn btn-sm"
          onClick={() => {
            navigator.clipboard.writeText(url);
            toast.success('Link copied');
          }}
        >
          Copy link
        </button>
        {doctor.qr_code_url && (
          <a className="btn btn-sm" href={doctor.qr_code_url} target="_blank" rel="noreferrer" download="doctor-booking-qr.png">
            ⬇ Download QR
          </a>
        )}
        {doctor.qr_code_url && <ShareQrButton doctorName={doctor.name} bookingUrl={url} />}
      </div>
    </Modal>
  );
}

/**
 * Shares the QR image itself, not just the booking link — a doctor sending this
 * to a patient on WhatsApp wants the picture, which is what they will print or
 * forward.
 *
 * The bytes come from the API, not from `qr_code_url`. That URL points straight
 * at the S3 bucket, which serves the object publicly but sends no
 * `Access-Control-Allow-Origin` header — so `fetch`ing it from this origin is
 * blocked by the browser and this button could only ever report a failure. The
 * <img> above still uses that URL, because images are not subject to the same
 * restriction.
 *
 * Web Share level 2 (`files`) is the good path and exists on the phones this
 * matters on. Where it is missing — most desktop browsers — the image is copied
 * to the clipboard instead, so it can be pasted straight into a chat, and
 * failing that it is saved. Download remains as the button next to this one.
 */
export function ShareQrButton({
  doctorName,
  bookingUrl,
}: {
  doctorName: string;
  bookingUrl: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const share = async () => {
    setBusy(true);
    try {
      const { blob, filename } = await doctorsApi.myQrFile();
      const file = new File([blob], filename, { type: blob.type || 'image/png' });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Book an appointment with ${doctorName}`,
          text: `Scan this QR or open ${bookingUrl} to book an appointment with ${doctorName}.`,
        });
        return;
      }

      // No file sharing here — put the image on the clipboard instead.
      if (navigator.clipboard && 'ClipboardItem' in window) {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ [blob.type || 'image/png']: blob }),
          ]);
          toast.success('QR code copied — paste it into a chat');
          return;
        } catch {
          // Clipboard images are refused in some browsers; fall through to save.
        }
      }

      downloadFile(file);
      toast.success(
        'QR code downloaded',
        'This browser cannot open a share sheet — attach the saved image instead.',
      );
    } catch (err) {
      // A user dismissing the share sheet is not an error worth shouting about.
      if ((err as Error)?.name === 'AbortError') return;
      toast.error(
        err instanceof ApiError ? err.message : 'Could not share the QR code.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className="btn btn-sm btn-primary" onClick={share} disabled={busy}>
      {busy ? 'Preparing…' : '↗ Share QR'}
    </button>
  );
}
