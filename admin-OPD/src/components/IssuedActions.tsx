import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { consultationApi } from '../api/endpoints';
import { useToast } from './Toast';
import { ConfirmDialog } from './ui';
import { PrintPrescriptionButton, WhatsAppPrescriptionButton } from './PrescriptionPreview';
import { ApiError } from '../api/client';
import { downloadFile, shareFile } from '../lib/shareFile';

/**
 * Sends the issued prescription out through the platform's share sheet as the
 * PDF itself — the doctor picks WhatsApp (or anything else the device offers)
 * and the patient receives the document, not a link that expires or needs a
 * login.
 *
 * The bytes come from the API rather than the presigned S3 URL next to this
 * button: that URL is fine for the browser to *navigate* to, but cannot be
 * read by script, because the bucket sends no CORS headers.
 */
function SharePrescriptionButton({ appointmentId }: { appointmentId: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const onShare = async () => {
    setBusy(true);
    try {
      const { blob, filename } = await consultationApi.prescriptionPdf(appointmentId);
      const file = new File([blob], filename, { type: 'application/pdf' });
      const outcome = await shareFile(file, {
        title: 'Prescription',
        text: 'Prescription from your visit.',
      });
      if (outcome === 'downloaded') {
        toast.success(
          'Prescription downloaded',
          'This browser cannot open a share sheet — attach the saved PDF instead.',
        );
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Could not share the prescription.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className="btn btn-sm btn-primary" onClick={onShare} disabled={busy}>
      {busy ? 'Preparing…' : '↗ Share'}
    </button>
  );
}

/**
 * Saves the issued PDF to disk.
 *
 * The bytes come from the API, not from the presigned S3 `pdf_url` next to it:
 * a cross-origin link honours neither the `download` attribute nor a scripted
 * save, so that link could only ever *open* the PDF in a new tab — which is the
 * bug this replaces. Fetched through the API, the same document is CORS-readable
 * and goes straight to the downloads folder.
 */
function DownloadPdfButton({ appointmentId }: { appointmentId: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const onDownload = async () => {
    setBusy(true);
    try {
      const { blob, filename } = await consultationApi.prescriptionPdf(appointmentId);
      downloadFile(new File([blob], filename, { type: 'application/pdf' }));
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Could not download the prescription.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className="btn btn-sm" onClick={onDownload} disabled={busy}>
      {busy ? 'Preparing…' : 'Download PDF'}
    </button>
  );
}

/**
 * The one row every mode shows once this visit's prescription is issued:
 * the Issued badge, the ways of handing it over, and Withdraw.
 *
 * It lives here rather than in `PrescriptionEditor` because Type and Record
 * were the only tabs that had it. A prescription issued from the Upload tab
 * left that tab exactly as it was — "Take photo", "Choose files" and a delete
 * cross on every scan, with no badge and no way back — so the doctor's only
 * route to Withdraw was to guess that the Type tab, which they had never
 * opened, now held it. One component, so a mode cannot be issued without the
 * actions that belong to an issued prescription.
 */
export function IssuedActions({
  appointmentId,
  canEdit,
  pdfUrl,
  /**
   * Run after a successful withdrawal, before the queries are invalidated —
   * for a mode that holds editor state of its own and must stop treating it
   * as the issued copy.
   */
  onWithdrawn,
}: {
  appointmentId: string;
  canEdit: boolean;
  pdfUrl?: string | null;
  onWithdrawn?: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  const withdraw = useMutation({
    mutationFn: () => consultationApi.withdrawPrescription(appointmentId),
    onSuccess: () => {
      setConfirmWithdraw(false);
      onWithdrawn?.();
      qc.invalidateQueries({ queryKey: ['prescription', appointmentId] });
      qc.invalidateQueries({ queryKey: ['appointment', appointmentId] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      toast.success(
        'Prescription withdrawn',
        'It is a draft again and no longer visible to the patient. Correct it and issue again.',
      );
    },
    onError: (err: unknown) => {
      setConfirmWithdraw(false);
      toast.error(
        err instanceof ApiError ? err.message : 'Could not withdraw the prescription.',
      );
    },
  });

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="badge badge-available">Issued</span>
        <div className="row" style={{ gap: 8 }}>
          {pdfUrl && <DownloadPdfButton appointmentId={appointmentId} />}
          <PrintPrescriptionButton appointmentId={appointmentId} />
          <SharePrescriptionButton appointmentId={appointmentId} />
          <WhatsAppPrescriptionButton appointmentId={appointmentId} />
          {canEdit && (
            <button
              className="btn btn-sm"
              style={{ color: 'var(--state-error)' }}
              onClick={() => setConfirmWithdraw(true)}
              disabled={withdraw.isPending}
              title="Take this prescription back so it can be corrected"
            >
              {withdraw.isPending ? 'Withdrawing…' : 'Withdraw'}
            </button>
          )}
        </div>
      </div>

      {confirmWithdraw && (
        <ConfirmDialog
          title="Withdraw this prescription?"
          destructive
          busy={withdraw.isPending}
          confirmLabel="Withdraw"
          message={
            <>
              The patient can already see this prescription. Withdrawing it
              removes their copy and the PDF, and clears the notification they
              were sent.
              <br />
              <br />
              Everything written for this visit stays here as a draft, so you can
              correct it and issue again.
            </>
          }
          onConfirm={() => withdraw.mutate()}
          onCancel={() => setConfirmWithdraw(false)}
        />
      )}
    </>
  );
}
