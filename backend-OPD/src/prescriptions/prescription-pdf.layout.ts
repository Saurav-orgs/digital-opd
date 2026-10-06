import { Logger } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { Appointment } from '../database/models/appointment.model';
import { Doctor } from '../database/models/doctor.model';
import { StorageService } from '../uploads/storage.service';
import { HEADER_MIN_RATIO } from '../uploads/letterhead-image';

/**
 * The letterhead, frame and footer that every document printed on a doctor's
 * pad shares — the prescription and the IVF case-sheet draw the same header,
 * the same accent bars and the same digitally-signed footer, and pin their
 * body inside the same vertical frame.
 *
 * It lived as private methods on `PrescriptionPdfService` until the case-sheet
 * needed exactly the same header. Two copies of the pad top would drift the
 * day one of them was adjusted, and a case-sheet whose header disagreed with
 * the prescription beside it is the kind of thing a clinic notices. So the
 * shared pieces are free functions here, taking the `doc` (and, for the header,
 * the storage client and a logger) as arguments; each document keeps its own
 * body renderers.
 */

/** Layout constants for an A4 page. */
export const PAGE = { width: 595.28, height: 841.89 };
export const MARGIN = 44;
export const CONTENT_W = PAGE.width - MARGIN * 2;
/** Where the per-page footer (separator, disclaimer, bottom bar) begins. */
export const FOOTER_TOP = PAGE.height - 75;

export const COLOR = {
  accent: '#1B6EF3', // vibrant royal blue accent bar
  ink: '#111827', // deep dark text / headers
  text: '#374151', // primary body text
  muted: '#6B7280', // secondary / instruction text
  faint: '#9CA3AF', // faint lines / borders
  line: '#E5E7EB', // light divider line
  darkIcon: '#0F172A', // myFollowup icon background
  cyanWave: '#38BDF8', // myFollowup wave color
};

/**
 * The box a doctor-uploaded header is drawn into: the full content width, with
 * the height that keeps the image's own proportions. `HEADER_MIN_RATIO` caps it
 * (a third of the width, ≈ 6 cm); the upload refuses anything taller, so `fit`
 * never has to shrink a header.
 */
export const HEADER_TOP = 40;
export const HEADER_MAX_H = CONTENT_W / HEADER_MIN_RATIO;
/**
 * Headers uploaded before their shape was measured have no ratio on the doctor
 * and print in the box they always did.
 */
const LEGACY_HEADER_H = 90;
export function headerHeight(doctor: Doctor): number {
  const ratio = doctor.letterhead_header_ratio;
  if (!ratio || ratio <= 0) return LEGACY_HEADER_H;
  return Math.min(CONTENT_W / ratio, HEADER_MAX_H);
}

/** Where the body resumes on a continuation page. */
const CONTINUATION_Y = 56;

/** The clinic fallbacks read from config when the doctor has set none. */
export interface EnvClinic {
  name: string;
  address: string;
  phone: string;
  email: string;
}

/**
 * Formats a DATEONLY string (YYYY-MM-DD) into a human readable date
 * (e.g. 17 August 2026).
 */
export function formatReadableDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const date = new Date(Date.UTC(year, month, day));
      return date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });
    }
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    }
  } catch (_) {}
  return dateStr;
}

/** Formats a prefix "X " cleanly without duplicating "X " or "x ". */
export function formatWithCrossPrefix(val: string | null | undefined): string {
  if (!val || !val.trim()) return '';
  const trimmed = val.trim();
  if (/^[xX]\s+/i.test(trimmed)) {
    return trimmed;
  }
  return `X ${trimmed}`;
}

// ── Accent line ──────────────────────────────────────────────
export function accentBar(doc: PDFKit.PDFDocument, y: number): void {
  doc.save().rect(MARGIN, y, CONTENT_W, 4.5).fill(COLOR.accent).restore();
}

/** The bar under the doctor's details on the first page. */
export function headerRule(
  doc: PDFKit.PDFDocument,
  y: number,
  paint = true,
): number {
  if (paint) accentBar(doc, y);
  return y + 4.5 + 22;
}

/**
 * A continuation page: no letterhead to rule under, so the bar sits at the top
 * to keep the page framed the same way as the first. Returns the Y the body
 * resumes at.
 */
export function continuationPage(doc: PDFKit.PDFDocument): number {
  doc.addPage();
  accentBar(doc, 36);
  return CONTINUATION_Y;
}

// ── Uploaded header ──────────────────────────────────────────
/**
 * The doctor's own header image across the content width, `height` tall. `fit`
 * only matters for a legacy header whose box was not sized to it; a measured
 * one fills the box exactly. Returns the Y below the header.
 */
export function imageHeader(
  doc: PDFKit.PDFDocument,
  image: Buffer,
  height: number,
  logger: Logger,
): number {
  try {
    doc.image(image, MARGIN, HEADER_TOP, {
      fit: [CONTENT_W, height],
      valign: 'center',
    });
  } catch (err) {
    logger.warn(`Could not embed the letterhead header: ${(err as Error).message}`);
  }
  return HEADER_TOP + height + 12;
}

/**
 * Best-effort: a missing or unreadable image falls back to the composed header
 * rather than failing the document.
 */
export async function fetchHeaderImage(
  storage: StorageService,
  doctor: Doctor,
  logger: Logger,
): Promise<Buffer | null> {
  if (!doctor.letterhead_header_key) return null;
  try {
    return await storage.download(doctor.letterhead_header_key);
  } catch (err) {
    logger.warn(`Could not fetch the letterhead header: ${(err as Error).message}`);
    return null;
  }
}

// ── Composed doctor header ───────────────────────────────────
/**
 * With `paint` off the header is laid out but not drawn, so the page below it
 * sits exactly where it would with the header present (the print-copy case).
 * Returns the Y below the header.
 */
export function doctorHeader(
  doc: PDFKit.PDFDocument,
  doctor: Doctor,
  envClinic: EnvClinic,
  paint = true,
): number {
  const topY = 44;
  const halfW = (CONTENT_W - 20) / 2;

  // Draws, or only measures: either way `doc.y` ends up where the text does.
  const text = (
    str: string,
    x: number,
    y: number,
    o: PDFKit.Mixins.TextOptions,
  ) => {
    if (paint) {
      doc.text(str, x, y, o);
    } else {
      doc.y = y + doc.heightOfString(str, o);
    }
  };

  // Doctor name on the left.
  let docName = doctor.name || 'Doctor';
  if (
    !docName.toLowerCase().startsWith('dr.') &&
    !docName.toLowerCase().startsWith('dr ')
  ) {
    docName = `Dr. ${docName}`;
  }

  doc.fillColor(COLOR.ink).font('Helvetica-Bold').fontSize(15.5);
  text(docName, MARGIN, topY, { width: halfW });

  let leftY = doc.y + 3;

  if (doctor.qualifications?.trim()) {
    doc.font('Helvetica').fontSize(10).fillColor(COLOR.text);
    text(doctor.qualifications.trim(), MARGIN, leftY, { width: halfW });
    leftY = doc.y + 2;
  }

  const spec = doctor.specialization || doctor.clinic_name;
  if (spec?.trim()) {
    doc.font('Helvetica').fontSize(9.5).fillColor(COLOR.muted);
    text(spec.trim(), MARGIN, leftY, { width: halfW });
    leftY = doc.y;
  }

  // Right column: address / clinic contact.
  const address =
    doctor.clinic_address || envClinic.address || doctor.clinic_name || 'Address';
  const contactLines = [address, doctor.clinic_phone || envClinic.phone]
    .filter(Boolean)
    .join('\n');

  const rightX = MARGIN + halfW + 20;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(COLOR.ink);
  text(contactLines, rightX, topY, {
    width: halfW,
    align: 'right',
    lineGap: 2,
  });

  const rightY = doc.y;
  return Math.max(leftY, rightY) + 14;
}

// ── Patient info & date ──────────────────────────────────────
/**
 * The "Patient Name / details … date" row that sits under the blue rule on
 * every document printed on the pad — the row the Profile letterhead preview
 * draws too. Shared so the prescription and the IVF case sheet open the same
 * way; a case sheet whose top half did not match the pad beside it is what
 * made the IVF sheet look like a different letterhead.
 */
export function patientInfo(
  doc: PDFKit.PDFDocument,
  appt: Appointment,
  y: number,
): number {
  const halfW = (CONTENT_W - 20) / 2;

  doc
    .font('Helvetica-Bold')
    .fontSize(13.5)
    .fillColor(COLOR.ink)
    .text('Patient Name', MARGIN, y, { width: halfW });

  const patientY = doc.y + 3;

  const details: string[] = [];
  if (appt.patient_age != null) details.push(`${appt.patient_age} yrs`);
  if (appt.patient_gender) {
    const g = appt.patient_gender.trim();
    const gInitial = g.charAt(0).toUpperCase();
    details.push(gInitial === 'M' ? 'M' : gInitial === 'F' ? 'F' : g);
  }

  const patientDisplay =
    details.length > 0 ? `${appt.patient_name} (${details.join(', ')})` : appt.patient_name;

  doc
    .font('Helvetica')
    .fontSize(11)
    .fillColor(COLOR.text)
    .text(patientDisplay, MARGIN, patientY, { width: halfW });

  const rightX = MARGIN + halfW + 20;
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(COLOR.ink)
    .text(formatReadableDate(appt.appointment_date), rightX, patientY, {
      width: halfW,
      align: 'right',
    });

  return Math.max(doc.y, patientY + 16) + 24;
}

// ── Book the next visit (URL + QR) ─────────────────────────
/**
 * The "book your next visit" block: a QR of the doctor's booking page, plus
 * the URL in plain text beside it. Pinned to the foot of the last page,
 * directly above the footer, rather than flowing after the body.
 *
 * The URL is printed as well as encoded on purpose: a patient with no camera
 * to hand, or a fax-quality photocopy of this sheet, can still type it in.
 *
 * Shared because the IVF case-sheet needs the same block — it was private to
 * `PrescriptionPdfService`, so an IVF doctor's prescription went out with no
 * way to rebook on it at all, which is the one thing this block exists for.
 * It takes the URL rather than the doctor, so this module stays free of
 * `DoctorsService` and `bookingUrl` keeps its single definition.
 *
 * Best-effort throughout: a prescription must be issued even if the QR cannot
 * be drawn, so every failure degrades to no block rather than a failed issue.
 */
export const REBOOK_H = 100;
/**
 * On a print copy the sheet goes onto the doctor's own pad, whose footer is
 * already printed where ours would be. Ours is left off and this block is
 * lifted this much (≈1.5 cm) clear of it, so the body stops higher too.
 */
export const PRINT_FOOTER_LIFT = 43;

/**
 * The vertical frame the body and the rebook block work within — where the
 * block sits, and the lowest baseline the body may reach before starting a
 * new page. Two of them: the issued copy's, and the print copy's lifted one.
 */
export interface Frame {
  rebookTop: number;
  bodyBottom: number;
}

export function frameFor(print: boolean): Frame {
  const rebookTop = FOOTER_TOP - REBOOK_H - (print ? PRINT_FOOTER_LIFT : 0);
  return { rebookTop, bodyBottom: rebookTop - 12 };
}

export async function rebookQr(
  doc: PDFKit.PDFDocument,
  url: string,
  y: number,
  frame: Frame,
  logger: Logger,
): Promise<void> {
  // A relative path is what `bookingUrl` returns when no portal base is
  // configured. Nothing can scan that, so print nothing.
  if (!/^https?:\/\//i.test(url)) return;

  let png: Buffer;
  try {
    png = await QRCode.toBuffer(url, {
      type: 'png',
      width: 256,
      margin: 0,
      errorCorrectionLevel: 'M',
    });
  } catch (err) {
    logger.warn(`Could not render the booking QR: ${(err as Error).message}`);
    return;
  }

  // A new page only if the body genuinely ran into this block's space —
  // `rebookTop`, not `bodyBottom`. The 12pt between them is the clearance the
  // body aims for, not room the block needs: testing against it sent the
  // whole block to a page of its own when an IVF sheet's last line came two
  // points past the target, leaving a trailing page with nothing on it but a
  // QR code. `pageFurniture` runs after this and covers whichever page we
  // end on.
  if (y > frame.rebookTop) continuationPage(doc);
  y = frame.rebookTop;

  const qrSize = 64;

  doc
    .save()
    .moveTo(MARGIN, y)
    .lineTo(PAGE.width - MARGIN, y)
    .lineWidth(0.5)
    .strokeColor(COLOR.line)
    .stroke()
    .restore();

  y += 12;

  try {
    doc.image(png, MARGIN, y, { fit: [qrSize, qrSize] });
  } catch (err) {
    logger.warn(`Could not embed the booking QR: ${(err as Error).message}`);
    return;
  }

  const textX = MARGIN + qrSize + 14;
  const textW = CONTENT_W - qrSize - 14;

  doc
    .font('Helvetica-Bold')
    .fontSize(11.5)
    .fillColor(COLOR.ink)
    .text('Book your next appointment', textX, y + 6, { width: textW });

  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor(COLOR.muted)
    .text('Scan this code, or open the link below.', textX, doc.y + 2, {
      width: textW,
    });

  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor(COLOR.accent)
    .text(url, textX, doc.y + 3, {
      width: textW,
      link: url,
      underline: false,
      lineBreak: false,
      ellipsis: true,
    });
}

// ── Per-page furniture (separator, disclaimer, bottom accent) ──
/**
 * `docLabel` names the document in the disclaimer — "prescription" for the
 * prescription, "case sheet" for the IVF sheet — so each sheet says what it is
 * rather than both claiming to be a prescription.
 */
export function pageFurniture(
  doc: PDFKit.PDFDocument,
  docLabel = 'prescription',
): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);

    // 1. Separator thin line.
    const divY = FOOTER_TOP;
    doc
      .save()
      .moveTo(MARGIN, divY)
      .lineTo(PAGE.width - MARGIN, divY)
      .lineWidth(0.5)
      .strokeColor(COLOR.line)
      .stroke()
      .restore();

    // 2. Digitally-signed disclaimer.
    const disclaimerY = PAGE.height - 60;
    doc
      .font('Helvetica-Oblique')
      .fontSize(9)
      .fillColor(COLOR.muted)
      .text(
        `*This is a digitally signed ${docLabel} and does not require signature.*`,
        MARGIN,
        disclaimerY,
        { width: CONTENT_W, align: 'center' },
      );

    // 3. Bottom blue accent line.
    accentBar(doc, PAGE.height - 40);
  }
}
