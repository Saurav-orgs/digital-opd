import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PDFDocument from 'pdfkit';
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
  HEADER_TOP,
  MARGIN,
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
  rebookQr,
  type Frame,
  frameFor,
} from './prescription-pdf.layout';

/**
 * Least vertical space a scan is given before it is moved to its own page.
 * Below this it prints as a letterbox strip nobody can read.
 */
const MIN_SCAN_H = 220;

/** Has the doctor written anything into the structured fields? */
function hasWrittenBody(
  p: EPrescription,
  medicines: EPrescriptionMedicine[],
): boolean {
  return (
    medicines.length > 0 ||
    !!p.diagnosis?.trim() ||
    !!p.previous_history?.trim() ||
    !!p.advice?.trim()
  );
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
    opts: { letterhead?: boolean; scans?: Buffer[] } = {},
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

    const scans = opts.scans ?? [];
    if (prescription.mode === PrescriptionMode.HANDWRITTEN) {
      const drawing = await this.fetchHandwriting(prescription);
      y = this.handwritingBody(doc, drawing, y, frame);
    } else if (hasWrittenBody(prescription, medicines) || scans.length === 0) {
      y = this.previousHistory(doc, prescription, y);
      y = this.diagnosis(doc, prescription, y);
      y = this.treatmentAdvice(doc, medicines, prescription, y, frame);
    }

    // The photographed pad, when the doctor's prescription for this visit is a
    // scan rather than rows. It is the body on its own — the branch above is
    // skipped — and it follows the typed body when there is one, because a
    // doctor who both typed and photographed meant both to reach the patient.
    if (scans.length) {
      y = this.scanBody(doc, scans, y, frame, hasWrittenBody(prescription, medicines));
    }

    // The patient leaves with this sheet in hand — the QR is how the next
    // visit gets booked without them having to find the clinic online again.
    // It sits at the foot of the last page, whatever the body left above it.
    await this.rebookBlock(doc, doctor, y, frame);

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

  // ── Uploaded scans ─────────────────────────────────────────
  /**
   * The prescription images the doctor uploaded for this visit, one per page,
   * each scaled to the space above the rebook block.
   *
   * These used to reach the patient only as thumbnails in the clinic's own
   * screen: issuing a visit whose prescription was a photo of the pad was
   * refused outright ("add at least one medicine or some advice"), because
   * nothing but the structured rows and the e-pen drawing counted as content.
   * The scan is the prescription in that case, so it prints as one.
   */
  private scanBody(
    doc: PDFKit.PDFDocument,
    scans: Buffer[],
    y: number,
    frame: Frame,
    labelled: boolean,
  ): number {
    scans.forEach((scan, idx) => {
      // A page of its own for every scan after the first, and for the first
      // one too when what was typed above has left no usable room.
      if (idx > 0 || frame.bodyBottom - y < MIN_SCAN_H) y = continuationPage(doc);
      if (labelled && idx === 0) {
        doc
          .font('Helvetica-Bold')
          .fontSize(12)
          .fillColor(COLOR.ink)
          .text('UPLOADED PRESCRIPTION', MARGIN, y, { characterSpacing: 0.5 });
        y = doc.y + 8;
      }
      try {
        doc.image(scan, MARGIN, y, {
          fit: [CONTENT_W, frame.bodyBottom - y],
          align: 'center',
        });
      } catch (err) {
        this.logger.warn(`Could not embed a prescription scan: ${(err as Error).message}`);
      }
      y = frame.bodyBottom;
    });
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

  /**
   * The shared rebook block, for this doctor.
   *
   * `bookingUrl` has exactly one definition (`DoctorsService`) and the layout
   * module is deliberately free of it, so resolving the doctor to a URL is
   * this service's job and drawing it is the layout's. A URL that cannot even
   * be built degrades to no block, like every other failure in there.
   */
  private async rebookBlock(
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
    await rebookQr(doc, url, y, frame, this.logger);
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
