import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Invoice } from '../database/models/invoice.model';

/** A4 in points, with the margin the prescription PDF also uses. */
const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const CONTENT_W = PAGE.width - MARGIN * 2;

const COLOR = {
  accent: '#167567', // the product teal
  ink: '#111827',
  text: '#374151',
  muted: '#6b7280',
  line: '#e5e7eb',
  panel: '#f8fafc',
};

/**
 * Rupees, written the way an Indian invoice writes them.
 *
 * Deliberately `Rs.` and not `₹`: PDFKit's built-in Helvetica is a WinAnsi
 * font with no rupee glyph, so the symbol would print as a black box. The
 * currency code is also on the document, so nothing is ambiguous.
 */
const money = (n: number) =>
  'Rs. ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const day = (d: Date | null) =>
  d
    ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

/** Rupees in words, as GST invoices are expected to carry. */
function amountInWords(total: number): string {
  const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
    'Eighteen', 'Nineteen',
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const two = (n: number): string =>
    n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? ' ' + ones[n % 10] : ''}`;
  const three = (n: number): string =>
    n >= 100 ? `${ones[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' + two(n % 100) : ''}` : two(n);

  // The Indian system: crore, lakh, thousand, then the last three digits.
  const parts: string[] = [];
  const whole = Math.floor(total);
  const paise = Math.round((total - whole) * 100);
  const chunks: [number, string][] = [
    [Math.floor(whole / 10_000_000), 'Crore'],
    [Math.floor((whole % 10_000_000) / 100_000), 'Lakh'],
    [Math.floor((whole % 100_000) / 1_000), 'Thousand'],
    [whole % 1_000, ''],
  ];
  for (const [value, label] of chunks) {
    if (value > 0) parts.push(`${three(value)}${label ? ' ' + label : ''}`);
  }
  const rupees = parts.length ? parts.join(' ') : 'Zero';
  return `Rupees ${rupees}${paise ? ` and ${two(paise)} Paise` : ''} Only`;
}

/**
 * How the tax is presented.
 *
 * GST is one rate on the row, but it is *reported* as CGST + SGST when the
 * buyer is in the issuer's own state and as IGST when they are not. Where we
 * do not know the buyer's state — a doctor who paid before filling in their
 * clinic address — the rate is shown as a single GST line rather than split
 * on a guess, because guessing the wrong head is worse than not splitting.
 */
function taxLines(inv: Invoice): { label: string; amount: number }[] {
  const rate = Number(inv.gst_rate);
  const amount = Number(inv.gst_amount);
  const issuerState = inv.issuer?.state?.trim().toLowerCase() || null;
  const buyerState = inv.buyer?.placeOfSupply?.trim().toLowerCase() || null;
  if (!issuerState || !buyerState) return [{ label: `GST @ ${rate}%`, amount }];
  if (issuerState === buyerState) {
    const half = Math.round((amount / 2) * 100) / 100;
    return [
      { label: `CGST @ ${rate / 2}%`, amount: half },
      { label: `SGST @ ${rate / 2}%`, amount: Math.round((amount - half) * 100) / 100 },
    ];
  }
  return [{ label: `IGST @ ${rate}%`, amount }];
}

/**
 * Renders a subscription invoice as a one-page A4 PDF.
 *
 * Everything printed comes off the invoice row — the issuer and buyer blocks
 * were snapshotted when it was raised — so a document downloaded a year later
 * is byte-for-byte what was emailed on the day.
 */
@Injectable()
export class InvoicePdfService {
  async render(inv: Invoice): Promise<Buffer> {
    const doc = new PDFDocument({ size: [PAGE.width, PAGE.height], margin: MARGIN });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const isTaxInvoice = !!inv.issuer?.gstin;
    let y = MARGIN;

    // ── Title bar ──────────────────────────────────────────
    doc.rect(0, 0, PAGE.width, 6).fill(COLOR.accent);

    doc
      .fillColor(COLOR.ink)
      .font('Helvetica-Bold')
      .fontSize(18)
      .text(inv.issuer?.name || 'myDigitalOPD', MARGIN, y + 16, { width: CONTENT_W * 0.6 });

    const issuerLines = [
      inv.issuer?.address,
      inv.issuer?.gstin ? `GSTIN: ${inv.issuer.gstin}` : null,
      inv.issuer?.pan ? `PAN: ${inv.issuer.pan}` : null,
      [inv.issuer?.email, inv.issuer?.phone].filter(Boolean).join('  ·  ') || null,
    ].filter(Boolean) as string[];
    doc.font('Helvetica').fontSize(9).fillColor(COLOR.muted);
    let iy = doc.y + 4;
    for (const line of issuerLines) {
      doc.text(line, MARGIN, iy, { width: CONTENT_W * 0.55 });
      iy = doc.y + 1;
    }

    // The document's own identity sits opposite the issuer.
    doc
      .font('Helvetica-Bold')
      .fontSize(15)
      .fillColor(COLOR.accent)
      .text(isTaxInvoice ? 'TAX INVOICE' : 'INVOICE', MARGIN + CONTENT_W * 0.6, y + 18, {
        width: CONTENT_W * 0.4,
        align: 'right',
      });
    doc
      .font('Helvetica')
      .fontSize(9.5)
      .fillColor(COLOR.text)
      .text(`Invoice no.  ${inv.invoice_no}`, MARGIN + CONTENT_W * 0.5, y + 40, {
        width: CONTENT_W * 0.5,
        align: 'right',
      })
      .text(`Date  ${day(inv.issued_at)}`, { width: CONTENT_W * 0.5, align: 'right' });

    y = Math.max(iy, doc.y) + 16;
    doc.moveTo(MARGIN, y).lineTo(PAGE.width - MARGIN, y).lineWidth(1).stroke(COLOR.line);
    y += 18;

    // ── Billed to / payment reference ──────────────────────
    const colW = CONTENT_W / 2 - 12;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOR.muted).text('BILLED TO', MARGIN, y);
    doc
      .font('Helvetica-Bold')
      .fontSize(11.5)
      .fillColor(COLOR.ink)
      .text(inv.buyer?.name || '—', MARGIN, doc.y + 3, { width: colW });
    doc.font('Helvetica').fontSize(9.5).fillColor(COLOR.text);
    for (const line of [
      inv.buyer?.address,
      inv.buyer?.email,
      inv.buyer?.mobile,
      inv.buyer?.gstin ? `GSTIN: ${inv.buyer.gstin}` : null,
      inv.buyer?.placeOfSupply ? `Place of supply: ${inv.buyer.placeOfSupply}` : null,
    ].filter(Boolean) as string[]) {
      doc.text(line, MARGIN, doc.y + 1, { width: colW });
    }
    const leftBottom = doc.y;

    const refX = MARGIN + CONTENT_W / 2 + 12;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOR.muted).text('PAYMENT', refX, y);
    doc.font('Helvetica').fontSize(9.5).fillColor(COLOR.text);
    let ry = doc.y + 3;
    for (const [label, value] of [
      ['Order id', inv.cf_order_id || '—'],
      ['Payment id', inv.cf_payment_id || '—'],
      ['Method', 'Online (Cashfree)'],
      ['Status', 'Paid'],
    ] as [string, string][]) {
      doc.fillColor(COLOR.muted).text(label, refX, ry, { width: 70, continued: false });
      doc.fillColor(COLOR.ink).text(value, refX + 74, ry, { width: colW - 74 });
      ry = doc.y + 2;
    }

    y = Math.max(leftBottom, ry) + 20;

    // ── The line item ──────────────────────────────────────
    const cols = { desc: MARGIN + 10, qty: MARGIN + CONTENT_W - 210, rate: MARGIN + CONTENT_W - 130, amt: MARGIN + CONTENT_W - 60 };
    doc.rect(MARGIN, y, CONTENT_W, 24).fill(COLOR.panel);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOR.muted);
    doc.text('DESCRIPTION', cols.desc, y + 8);
    doc.text('MONTHS', cols.qty, y + 8, { width: 60, align: 'right' });
    doc.text('RATE', cols.rate, y + 8, { width: 60, align: 'right' });
    doc.text('AMOUNT', cols.amt - 10, y + 8, { width: 70, align: 'right' });
    y += 24;

    const base = Number(inv.base_amount);
    const perMonth = inv.months > 0 ? base / inv.months : base;
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COLOR.ink);
    doc.text(`${inv.plan_name} subscription`, cols.desc, y + 10, { width: 240 });
    doc.font('Helvetica').fontSize(9).fillColor(COLOR.muted);
    doc.text(
      `Service period ${day(inv.period_start)} – ${day(inv.period_end)}   ·   SAC 998314`,
      cols.desc,
      doc.y + 2,
      { width: 260 },
    );
    doc.font('Helvetica').fontSize(10).fillColor(COLOR.text);
    doc.text(String(inv.months), cols.qty, y + 10, { width: 60, align: 'right' });
    doc.text(money(perMonth), cols.rate, y + 10, { width: 60, align: 'right' });
    doc.text(money(base), cols.amt - 10, y + 10, { width: 70, align: 'right' });

    y = doc.y + 14;
    doc.moveTo(MARGIN, y).lineTo(PAGE.width - MARGIN, y).stroke(COLOR.line);
    y += 12;

    // ── Totals ─────────────────────────────────────────────
    const totalsX = MARGIN + CONTENT_W - 250;
    const row = (label: string, value: string, bold = false) => {
      doc
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(bold ? 11 : 10)
        .fillColor(bold ? COLOR.ink : COLOR.text);
      doc.text(label, totalsX, y, { width: 150, align: 'right' });
      doc.text(value, totalsX + 160, y, { width: 90, align: 'right' });
      y += bold ? 20 : 16;
    };
    row('Taxable value', money(base));
    for (const line of taxLines(inv)) row(line.label, money(line.amount));
    doc.moveTo(totalsX, y).lineTo(PAGE.width - MARGIN, y).stroke(COLOR.line);
    y += 8;
    row(`Total (${inv.currency})`, money(Number(inv.total_amount)), true);

    doc
      .font('Helvetica-Oblique')
      .fontSize(9.5)
      .fillColor(COLOR.text)
      .text(amountInWords(Number(inv.total_amount)), MARGIN, y - 6, { width: CONTENT_W - 260 });

    y = Math.max(y, doc.y) + 24;

    // ── Footer ─────────────────────────────────────────────
    doc.moveTo(MARGIN, y).lineTo(PAGE.width - MARGIN, y).stroke(COLOR.line);
    y += 10;
    doc.font('Helvetica').fontSize(8.5).fillColor(COLOR.muted);
    doc.text(
      isTaxInvoice
        ? 'This is a computer-generated invoice and needs no signature. Tax is payable under the forward charge mechanism.'
        : 'This is a computer-generated invoice and needs no signature.',
      MARGIN,
      y,
      { width: CONTENT_W },
    );
    doc.text(
      'Subscription charges are for access to the myDigitalOPD platform and are not refundable once the billing period has started.',
      MARGIN,
      doc.y + 4,
      { width: CONTENT_W },
    );

    doc.end();
    return done;
  }

  /** `MDO-2026-27-0007.pdf` — a filename a mail client and a disk both accept. */
  filename(inv: Invoice): string {
    return `${inv.invoice_no.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`;
  }
}
