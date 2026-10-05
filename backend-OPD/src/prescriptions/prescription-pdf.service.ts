import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { Appointment } from '../database/models/appointment.model';
import { Doctor } from '../database/models/doctor.model';
import { EPrescription } from '../database/models/e-prescription.model';
import { EPrescriptionMedicine } from '../database/models/e-prescription-medicine.model';
import { StorageService } from '../uploads/storage.service';
import { DoctorsService } from '../doctors/doctors.service';
import { PrescriptionMode } from '../common/enums';
import {
  COLOR,
  CONTENT_W,
  EnvClinic,
  FOOTER_TOP,
  HEADER_TOP,
  MARGIN,
  PAGE,
  continuationPage,
  doctorHeader,
  fetchHeaderImage,
  formatReadableDate,
  formatWithCrossPrefix,
  headerHeight,
  headerRule,
  imageHeader,
  pageFurniture,
  patientInfo,
} from './prescription-pdf.layout';

/**
 * The "book your next visit" QR block is pinned to the bottom of the last
 * page, directly above the footer, rather than flowing after the body. This
 * is the height it takes including the divider above it; the body renderers
 * stop short of it so nothing runs underneath the code.
 */
const REBOOK_H = 100;
/**
 * On the print copy the sheet goes onto the doctor's own pad, whose footer
 * is already printed where ours would be. Ours is left off and the QR block
 * is lifted this much (≈1.5 cm) clear of it, so the body stops higher too.
 */
const PRINT_FOOTER_LIFT = 43;

/**
 * The vertical frame the body and QR block work within — where the QR sits
 * and the lowest baseline the body may reach before starting a new page.
 * Two of them: the issued copy's, and the print copy's with its lifted QR.
 */
interface Frame {
  rebookTop: number;
  bodyBottom: number;
}
function frameFor(print: boolean): Frame {
  const rebookTop = FOOTER_TOP - REBOOK_H - (print ? PRINT_FOOTER_LIFT : 0);
  return { rebookTop, bodyBottom: rebookTop - 12 };
}

@Injectable()
export class PrescriptionPdfService {
  private readonly logger = new Logger(PrescriptionPdfService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly doctors: DoctorsService,
  ) {}

  /**
   * `letterhead: false` renders the same page with the doctor's header left
   * blank — its space is kept, nothing is drawn in it. That is the print
   * variant: doctors print onto their own pre-printed pad, which already
   * carries the header, so the body has to land below it, not on top of it.
   * The pad's footer is pre-printed too, so the print copy draws no footer
   * of its own and lifts the QR block clear of that space (`frameFor`).
   * Everything that reaches the patient as a file (issue, share, download)
   * keeps the letterhead and the footer.
   */
  async render(
    prescription: EPrescription,
    medicines: EPrescriptionMedicine[],
    appointment: Appointment,
    doctor: Doctor,
    opts: { letterhead?: boolean } = {},
  ): Promise<Buffer> {
    const letterhead = opts.letterhead !== false;
    const frame = frameFor(!letterhead);
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, left: MARGIN, right: MARGIN, bottom: 0 },
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    const done = new Promise<Buffer>((resolve) =>
      doc.on('end', () => resolve(Buffer.concat(chunks))),
    );

    // The header is the doctor's own uploaded pad top when they have one,
    // otherwise composed from their details; the accent bar rules under
    // either and separates the letterhead from the patient's sheet. On a
    // print copy neither is drawn, but the space is kept.
    let y: number;
    if (doctor.letterhead_header_key && !letterhead) {
      // Print copy of a pad with its own header: keep the image box's height
      // blank, not the text header's, so the body lands where it does on the
      // issued copy. Sized from the stored ratio — the image is not fetched.
      y = HEADER_TOP + headerHeight(doctor) + 12;
    } else {
      const headerImage = letterhead
        ? await fetchHeaderImage(this.storage, doctor, this.logger)
        : null;
      y = headerImage
        ? imageHeader(doc, headerImage, headerHeight(doctor), this.logger)
        : doctorHeader(doc, doctor, this.envClinic(), letterhead);
    }
    y = headerRule(doc, y, letterhead);

    // Render patient name & date row
    y = patientInfo(doc, appointment, y);

    if (prescription.mode === PrescriptionMode.HANDWRITTEN) {
      const drawing = await this.fetchHandwriting(prescription);
      y = this.handwritingBody(doc, drawing, y, frame);
    } else {
      y = this.previousHistory(doc, prescription, y);
      y = this.diagnosis(doc, prescription, y);
      y = this.treatmentAdvice(doc, medicines, prescription, y, frame);
    }

    // The patient leaves with this sheet in hand — the QR is how the next
    // visit gets booked without them having to find the clinic online again.
    // It sits at the foot of the last page, whatever the body left above it.
    await this.rebookQr(doc, doctor, y, frame);

    // Render footer & furniture on all pages — not on the print copy, whose
    // pad carries its own.
    if (letterhead) pageFurniture(doc);

    doc.end();
    return done;
  }

  /** The clinic fallbacks the composed header reads when the doctor set none. */
  private envClinic(): EnvClinic {
    return (
      this.config.get<EnvClinic>('clinic') || {
        name: '',
        address: '',
        phone: '',
        email: '',
      }
    );
  }

  // ── Diagnosis ──────────────────────────────────────────────
  private diagnosis(
    doc: PDFKit.PDFDocument,
    p: EPrescription,
    y: number,
  ): number {
    if (!p.diagnosis?.trim()) return y;

    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor(COLOR.ink)
      .text('DIAGNOSIS', MARGIN, y, { characterSpacing: 0.5 });

    const contentY = doc.y + 4;
    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor(COLOR.text)
      .text(p.diagnosis.trim(), MARGIN, contentY, {
        width: CONTENT_W,
        lineGap: 3,
      });

    return doc.y + 22;
  }

  // ── Previous history ───────────────────────────────────────
  /** Same block as the diagnosis, above it: the background the doctor is
   *  reading the diagnosis against comes first on the sheet, as it does on
   *  the form they wrote it on. Skipped entirely when empty — most
   *  prescriptions carry none and a heading with nothing under it would only
   *  make the sheet longer. */
  private previousHistory(
    doc: PDFKit.PDFDocument,
    p: EPrescription,
    y: number,
  ): number {
    if (!p.previous_history?.trim()) return y;

    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor(COLOR.ink)
      .text('PREVIOUS HISTORY', MARGIN, y, { characterSpacing: 0.5 });

    const contentY = doc.y + 4;
    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor(COLOR.text)
      .text(p.previous_history.trim(), MARGIN, contentY, {
        width: CONTENT_W,
        lineGap: 3,
      });

    return doc.y + 22;
  }

  // ── Treatment Advice (Medicines + Notes) ────────────────────
  private treatmentAdvice(
    doc: PDFKit.PDFDocument,
    meds: EPrescriptionMedicine[],
    p: EPrescription,
    y: number,
    frame: Frame,
  ): number {
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor(COLOR.ink)
      .text('TREATMENT ADVICE', MARGIN, y, { characterSpacing: 0.5 });

    y = doc.y + 14;

    if (meds.length === 0 && !p.advice?.trim()) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(10)
        .fillColor(COLOR.muted)
        .text('No medicines or treatment advice prescribed.', MARGIN, y);
      return y + 24;
    }

    // 3 Column Layout for Medicines
    // Col 1 (Medicine Name + Instructions): width 230
    // Col 2 (Dosage / Timing with 'X ' prefix): width 140
    // Col 3 (Duration with 'X ' prefix): width 130
    const col1W = 230;
    const col2W = 140;
    const col3W = CONTENT_W - col1W - col2W;

    const col1X = MARGIN;
    const col2X = MARGIN + col1W;
    const col3X = MARGIN + col1W + col2W;

    meds.forEach((m, idx) => {
      // Check for page overflow before rendering row
      if (y > frame.bodyBottom - 40) y = continuationPage(doc);

      const medicineName = [m.medicine_name, m.strength].filter(Boolean).join(' ');
      const title = `${idx + 1}. ${medicineName.toUpperCase()}`;

      // Column 1: Medicine Number and Name
      doc
        .font('Helvetica-Bold')
        .fontSize(10.5)
        .fillColor(COLOR.ink)
        .text(title, col1X, y, { width: col1W - 10 });

      const col1Bottom = doc.y;

      // Column 2: Dosage / Frequency (e.g. "X Once Daily", "X Twice a day")
      //
      // `dosage` holds how often. The meal relation ("after food") used to sit
      // in `timing`; it is part of `instructions` now and prints on the
      // sub-line below. `timing` is still read as a fallback so prescriptions
      // written before that change keep rendering their frequency.
      const dosageVal = m.dosage || m.timing;
      if (dosageVal?.trim()) {
        const dosageStr = formatWithCrossPrefix(dosageVal);
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor(COLOR.ink)
          .text(dosageStr, col2X, y, { width: col2W - 10 });
      }

      // Check if instructions is purely a duration statement (e.g. "8 weeks only", "2 weeks", "5 days")
      const isDurationInstruction =
        m.instructions &&
        /^\s*(\d+\s*(days?|weeks?|months?))(\s*only)?\s*$/i.test(m.instructions.trim());

      // Column 3: Duration (e.g. "X 2 days", "X 8 weeks only")
      let durationStr = '';
      if (isDurationInstruction) {
        durationStr = formatWithCrossPrefix(m.instructions!.trim());
      } else if (m.duration_days) {
        if (m.duration_days % 7 === 0 && m.duration_days >= 14) {
          durationStr = formatWithCrossPrefix(`${m.duration_days / 7} weeks`);
        } else {
          durationStr = formatWithCrossPrefix(`${m.duration_days} days`);
        }
      }

      if (durationStr) {
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor(COLOR.ink)
          .text(durationStr, col3X, y, { width: col3W });
      }

      let rowHeight = Math.max(col1Bottom, doc.y) - y;

      // Sub-line below the medicine name (the "sos" line in the reference).
      // Carries the meal relation and anything else about how to take it. New
      // prescriptions put all of that in `instructions`; `timing` is still
      // joined in for rows written before it was merged, so reprinting an old
      // prescription does not silently drop "after food".
      const subLineParts = [
        m.dosage ? m.timing?.trim() : null,
        isDurationInstruction ? null : m.instructions?.trim(),
      ].filter((part): part is string => !!part);
      const instructionText = subLineParts.join(' · ');
      if (instructionText) {
        const instY = y + 14;
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor(COLOR.muted)
          .text(instructionText, col1X + 14, instY, {
            width: col1W - 20,
          });
        rowHeight = Math.max(rowHeight, (doc.y - y) + 2);
      }

      y += Math.max(rowHeight + 10, 24);
    });

    // Doctor's General Advice, under its own heading so the patient can tell
    // it apart from the medicine rows above.
    if (p.advice?.trim()) {
      y += 10;
      if (y > frame.bodyBottom - 60) y = continuationPage(doc);
      doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .fillColor(COLOR.ink)
        .text('ADVICE', MARGIN, y, { characterSpacing: 0.5 });
      doc
        .font('Helvetica')
        .fontSize(10.5)
        .fillColor(COLOR.text)
        .text(p.advice.trim(), MARGIN, doc.y + 4, { width: CONTENT_W, lineGap: 3 });
      y = doc.y + 10;
    }

    // Follow-up Date
    if (p.follow_up_date) {
      if (y > frame.bodyBottom - 24) y = continuationPage(doc);
      const formattedFollowUp = formatReadableDate(p.follow_up_date);
      doc
        .font('Helvetica-Bold')
        .fontSize(10.5)
        .fillColor(COLOR.ink)
        .text(`Follow-up on ${formattedFollowUp}`, MARGIN, y);
      y = doc.y + 10;
    }

    return y;
  }

  // ── Handwritten Body ───────────────────────────────────────
  private handwritingBody(
    doc: PDFKit.PDFDocument,
    drawing: Buffer | null,
    y: number,
    frame: Frame,
  ): number {
    // Stop short of the rebook block pinned above the footer, so a full-page
    // drawing is scaled to fit above the QR instead of colliding with it.
    const availH = frame.bodyBottom - y;
    if (!drawing) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(10)
        .fillColor(COLOR.muted)
        .text('The handwritten prescription could not be loaded.', MARGIN, y);
      return y + 20;
    }
    try {
      doc.image(drawing, MARGIN, y, {
        fit: [CONTENT_W, availH],
        align: 'center',
      });
    } catch (err) {
      this.logger.warn(`Could not embed handwriting: ${(err as Error).message}`);
    }
    return y + availH;
  }

  // ── Book the Next Visit (URL + QR) ─────────────────────────
  /**
   * A QR of the doctor's booking page, plus the URL in plain text beside it.
   *
   * The URL is printed as well as encoded on purpose: a patient with no camera
   * to hand, or a fax-quality photocopy of this sheet, can still type it in.
   *
   * Best-effort — a prescription must be issued even if the QR cannot be drawn,
   * so every failure here degrades to no block rather than a failed issue.
   */
  private async rebookQr(
    doc: PDFKit.PDFDocument,
    doctor: Doctor,
    y: number,
    frame: Frame,
  ): Promise<void> {
    let url: string;
    try {
      url = this.doctors.bookingUrl(doctor);
    } catch (err) {
      this.logger.warn(`Could not build the booking URL: ${(err as Error).message}`);
      return;
    }
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
      this.logger.warn(`Could not render the booking QR: ${(err as Error).message}`);
      return;
    }

    // Pinned to the foot of the page, above the footer furniture. A new page
    // is started only if the body genuinely ran into that space; `pageFurniture`
    // runs after this and covers whichever page we end on.
    if (y > frame.bodyBottom) continuationPage(doc);
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
      this.logger.warn(`Could not embed the booking QR: ${(err as Error).message}`);
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

  /** Best-effort handwriting fetch. */
  private async fetchHandwriting(p: EPrescription): Promise<Buffer | null> {
    if (!p.handwriting_image_key) return null;
    try {
      return await this.storage.download(p.handwriting_image_key);
    } catch (err) {
      this.logger.warn(`Could not fetch handwriting: ${(err as Error).message}`);
      return null;
    }
  }

}
