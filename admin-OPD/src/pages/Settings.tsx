import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { settingsApi, type AppSettings } from '../api/endpoints';
import { Field, Loading } from '../components/ui';
import { useToast } from '../components/Toast';
import { ApiError } from '../api/client';

/** The invoice issuer fields, in the order they read on the document. */
const INVOICE_FIELDS: {
  key: keyof AppSettings;
  label: string;
  placeholder: string;
  hint?: string;
}[] = [
  {
    key: 'invoice_legal_name',
    label: 'Registered name',
    placeholder: 'Impulsive Web Private Limited',
    hint: 'The legal entity that sells the subscriptions, not the product name.',
  },
  {
    key: 'invoice_address',
    label: 'Registered address',
    placeholder: '4th Floor, Tower B, Sector 62, Noida, Uttar Pradesh 201301',
  },
  {
    key: 'invoice_gstin',
    label: 'GSTIN',
    placeholder: '09AAACT1234C1ZS',
    hint: 'Until this is filled in, invoices are issued as plain invoices rather than tax invoices.',
  },
  { key: 'invoice_pan', label: 'PAN', placeholder: 'AAACT1234C' },
  {
    key: 'invoice_state',
    label: 'State',
    placeholder: 'Uttar Pradesh',
    hint: 'Decides whether tax prints as CGST + SGST or as IGST.',
  },
  { key: 'invoice_email', label: 'Billing email', placeholder: 'billing@mydigitalopd.com' },
  { key: 'invoice_phone', label: 'Billing phone', placeholder: '+91 98765 43210' },
  {
    key: 'invoice_prefix',
    label: 'Invoice number prefix',
    placeholder: 'MDO',
    hint: 'Numbers read PREFIX/2026-27/0001 and restart each financial year.',
  },
];

/**
 * Platform settings — super admin only.
 *
 * The patient portal's address, and who invoices are issued by. Both live
 * here rather than in env vars because both are facts the business owns and
 * changes without a deploy: a wrong portal address makes every printed QR
 * point nowhere, and a wrong registered address makes every invoice wrong.
 *
 * Editing the issuer only changes invoices raised from now on. The ones
 * already issued carry their own copy of these fields, and must — an invoice
 * has to keep saying what it said on the day it was raised.
 */
export default function SettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [base, setBase] = useState('');
  const [invoice, setInvoice] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);

  const settingsQ = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  useEffect(() => {
    const data = settingsQ.data;
    if (!data) return;
    setBase(data.patient_web_base ?? '');
    setInvoice(
      Object.fromEntries(INVOICE_FIELDS.map((f) => [f.key, (data[f.key] as string) ?? ''])),
    );
  }, [settingsQ.data]);

  const save = useMutation({
    mutationFn: () => settingsApi.update({ patient_web_base: base.trim() }),
    onSuccess: () => {
      toast.success(
        'Settings saved',
        'New booking QRs use this address. Existing ones keep the old one until regenerated.',
      );
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['doctors'] });
    },
    onError: (e: unknown) =>
      setError(e instanceof ApiError ? e.message : 'Could not save. Please try again.'),
  });

  const saveInvoice = useMutation({
    mutationFn: () =>
      settingsApi.update(
        Object.fromEntries(
          INVOICE_FIELDS.map((f) => [f.key, (invoice[f.key] ?? '').trim()]),
        ) as Partial<AppSettings>,
      ),
    onSuccess: () => {
      toast.success(
        'Invoice details saved',
        'Invoices raised from now on carry these. Ones already issued keep what they were issued with.',
      );
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (e: unknown) =>
      setInvoiceError(e instanceof ApiError ? e.message : 'Could not save. Please try again.'),
  });

  if (settingsQ.isLoading) return <Loading />;

  const valid = /^https?:\/\/.+/i.test(base.trim());
  const unchanged = base.trim() === (settingsQ.data?.patient_web_base ?? '');
  const invoiceUnchanged = INVOICE_FIELDS.every(
    (f) => (invoice[f.key] ?? '').trim() === ((settingsQ.data?.[f.key] as string) ?? ''),
  );

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>Settings</h2>

      <div className="card" style={{ maxWidth: 560 }}>
        <div className="card-title">Patient portal address</div>
        <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 14 }}>
          Where patients land when they scan a doctor's QR code. Every booking
          link is this address plus the doctor's slug — so it has to be
          reachable from a patient's phone, not just from this machine.
        </p>

        <Field label="Base URL">
          <input
            className="input"
            placeholder="https://booking.myclinic.com"
            value={base}
            onChange={(e) => {
              setBase(e.target.value);
              setError(null);
            }}
          />
          <span className="hint">
            Must start with http:// or https://. A doctor can override this on
            their own profile.
          </span>
        </Field>

        {base.trim().length > 0 && !valid && (
          <p style={{ color: 'var(--danger, red)', fontSize: 12, marginTop: -6 }}>
            Enter a full URL starting with http:// or https://
          </p>
        )}
        {/localhost|127\.0\.0\.1/i.test(base) && (
          <p style={{ color: 'var(--warning, #b45309)', fontSize: 12.5, marginTop: -4 }}>
            A phone cannot reach localhost — QR codes built from this address
            will not open on a patient's device.
          </p>
        )}
        {error && <p style={{ color: 'var(--danger, red)', fontSize: 13 }}>{error}</p>}

        <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
          <button
            className="btn btn-primary"
            disabled={!valid || unchanged || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 560, marginTop: 16 }}>
        <div className="card-title">Invoice details</div>
        <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 14 }}>
          Printed at the top of every subscription invoice and emailed to the doctor who paid.
          Changing them affects invoices raised from now on; ones already issued keep their own
          copy.
        </p>

        {INVOICE_FIELDS.map((f) => (
          <Field key={f.key} label={f.label}>
            <input
              className="input"
              placeholder={f.placeholder}
              value={invoice[f.key] ?? ''}
              onChange={(e) => {
                setInvoice((v) => ({ ...v, [f.key]: e.target.value }));
                setInvoiceError(null);
              }}
            />
            {f.hint && <span className="hint">{f.hint}</span>}
          </Field>
        ))}

        {invoiceError && (
          <p style={{ color: 'var(--danger, red)', fontSize: 13 }}>{invoiceError}</p>
        )}

        <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
          <button
            className="btn btn-primary"
            disabled={invoiceUnchanged || saveInvoice.isPending}
            onClick={() => saveInvoice.mutate()}
          >
            {saveInvoice.isPending ? 'Saving…' : 'Save invoice details'}
          </button>
        </div>
      </div>
    </div>
  );
}
