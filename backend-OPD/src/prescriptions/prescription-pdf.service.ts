import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PDFDocument from 'pdfkit';
import { Appointment } from '../database/models/appointment.model';
import { Doctor } from '../database/models/doctor.model';
import { EPrescription } from '../database/models/e-prescription.model';
import { EPrescriptionMedicine } from '../database/models/e-prescription-medicine.model';
import { StorageService } from '../uploads/storage.service';
import { PrescriptionMode } from '../common/enums';

/** Layout constants for an A4 prescription. */
const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 44;
const CONTENT_W = PAGE.width - MARGIN * 2;
const COLOR = {
  accent: '#1B6EF3', // vibrant royal blue accent bar
  ink: '#111827',    // deep dark text / headers
  text: '#374151',   // primary body text
  muted: '#6B7280',  // secondary / instruction text
  faint: '#9CA3AF',  // faint lines / borders
  line: '#E5E7EB',   // light divider line
  darkIcon: '#0F172A', // myFollowup icon background
  cyanWave: '#38BDF8', // myFollowup wave color
};

/**
 * Formats a DATEONLY string (YYYY-MM-DD) into a human readable date (e.g. 17 August 2026).
 */
function formatReadableDate(dateStr: string | null | undefined): string {
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

/**
 * Formats a prefix "X " cleanly without duplicating "X " or "x ".
 */
function formatWithCrossPrefix(val: string | null | undefined): string {
  if (!val || !val.trim()) return '';
  const trimmed = val.trim();
  if (/^[xX]\s+/i.test(trimmed)) {
    return trimmed;
  }
  return `X ${trimmed}`;
}

@Injectable()
export class PrescriptionPdfService {
  private readonly logger = new Logger(PrescriptionPdfService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {}

  async render(
    prescription: EPrescription,
    medicines: EPrescriptionMedicine[],
    appointment: Appointment,
    doctor: Doctor,
  ): Promise<Buffer> {
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

    // Draw top accent bar
    this.topAccentBar(doc);

    // Render doctor header
    let y = this.doctorHeader(doc, doctor);

    // Render patient name & date row
    y = this.patientInfo(doc, appointment, y);

    if (prescription.mode === PrescriptionMode.HANDWRITTEN) {
      const drawing = await this.fetchHandwriting(prescription);
      y = this.handwritingBody(doc, drawing, y);
    } else {
      y = this.diagnosis(doc, prescription, y);
      y = this.treatmentAdvice(doc, medicines, prescription, y);
    }

    // Render footer & furniture on all pages
    this.pageFurniture(doc);

    doc.end();
    return done;
  }

  // ── Top Accent Line ────────────────────────────────────────
  private topAccentBar(doc: PDFKit.PDFDocument): void {
    const barH = 4.5;
    const y = 36;
    doc.save().rect(MARGIN, y, CONTENT_W, barH).fill(COLOR.accent).restore();
  }

  // ── Doctor Header ──────────────────────────────────────────
  private doctorHeader(doc: PDFKit.PDFDocument, doctor: Doctor): number {
    const envClinic = this.config.get<{
      name: string;
      address: string;
      phone: string;
      email: string;
    }>('clinic') || { name: '', address: '', phone: '', email: '' };

    const topY = 56;
    const halfW = (CONTENT_W - 20) / 2;

    // Doctor Name on Left
    let docName = doctor.name || 'Doctor';
    if (!docName.toLowerCase().startsWith('dr.') && !docName.toLowerCase().startsWith('dr ')) {
      docName = `Dr. ${docName}`;
    }

    doc
      .fillColor(COLOR.ink)
      .font('Helvetica-Bold')
      .fontSize(15.5)
      .text(docName, MARGIN, topY, { width: halfW });

    let leftY = doc.y + 3;

    // Qualifications
    if (doctor.qualifications?.trim()) {
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(COLOR.text)
        .text(doctor.qualifications.trim(), MARGIN, leftY, { width: halfW });
      leftY = doc.y + 2;
    }

    // Specialization / Subtitle
    const spec = doctor.specialization || doctor.clinic_name;
    if (spec?.trim()) {
      doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor(COLOR.muted)
        .text(spec.trim(), MARGIN, leftY, { width: halfW });
      leftY = doc.y;
    }

    // Right Column: Address / Clinic contact
    const address = doctor.clinic_address || envClinic.address || doctor.clinic_name || 'Address';
    const contactLines = [address, doctor.clinic_phone || envClinic.phone]
      .filter(Boolean)
      .join('\n');

    const rightX = MARGIN + halfW + 20;
    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor(COLOR.ink)
      .text(contactLines, rightX, topY, {
        width: halfW,
        align: 'right',
        lineGap: 2,
      });

    const rightY = doc.y;
    return Math.max(leftY, rightY) + 26;
  }

  // ── Patient Info & Date ────────────────────────────────────
  private patientInfo(
    doc: PDFKit.PDFDocument,
    appt: Appointment,
    y: number,
  ): number {
    const halfW = (CONTENT_W - 20) / 2;

    // Left Column: Patient Name & details
    doc
      .font('Helvetica-Bold')
      .fontSize(13.5)
      .fillColor(COLOR.ink)
      .text('Patient Name', MARGIN, y, { width: halfW });

    const patientY = doc.y + 3;

    const details: string[] = [];
    if (appt.patient_age != null) {
      details.push(`${appt.patient_age} yrs`);
    }
    if (appt.patient_gender) {
      const g = appt.patient_gender.trim();
      const gInitial = g.charAt(0).toUpperCase();
      details.push(gInitial === 'M' ? 'M' : gInitial === 'F' ? 'F' : g);
    }

    const patientDisplay = details.length > 0
      ? `${appt.patient_name} (${details.join(', ')})`
      : appt.patient_name;

    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor(COLOR.text)
      .text(patientDisplay, MARGIN, patientY, { width: halfW });

    // Right Column: Formatted Date
    const formattedDate = formatReadableDate(appt.appointment_date);
    const rightX = MARGIN + halfW + 20;
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(COLOR.ink)
      .text(formattedDate, rightX, patientY, {
        width: halfW,
        align: 'right',
      });

    return Math.max(doc.y, patientY + 16) + 24;
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

  // ── Treatment Advice (Medicines + Notes) ────────────────────
  private treatmentAdvice(
    doc: PDFKit.PDFDocument,
    meds: EPrescriptionMedicine[],
    p: EPrescription,
    y: number,
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
      if (y > PAGE.height - 150) {
        doc.addPage();
        this.topAccentBar(doc);
        y = 56;
      }

      const medicineName = [m.medicine_name, m.strength].filter(Boolean).join(' ');
      const title = `${idx + 1}. ${medicineName.toUpperCase()}`;

      // Column 1: Medicine Number and Name
      doc
        .font('Helvetica-Bold')
        .fontSize(10.5)
        .fillColor(COLOR.ink)
        .text(title, col1X, y, { width: col1W - 10 });

      const col1Bottom = doc.y;

      // Column 2: Dosage / Frequency (e.g. "X Once Daily", "X 1-0-1")
      //
      // `dosage` first, not `timing`. In this system `dosage` holds how often
      // ("1-0-1", "twice a day") and `timing` holds the meal relation ("after
      // food") — and it is the frequency the client's reference prints here
      // ("X Once Daily"). Reading `timing` first dropped the frequency from the
      // sheet entirely, leaving a patient told when to take a drug relative to
      // food but never how many times a day.
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
      // The meal relation joins the instructions here rather than being lost:
      // column 2 now carries the frequency, and both matter on a prescription.
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

    // Doctor's General Advice
    if (p.advice?.trim()) {
      y += 8;
      if (y > PAGE.height - 150) {
        doc.addPage();
        this.topAccentBar(doc);
        y = 56;
      }
      doc
        .font('Helvetica')
        .fontSize(10.5)
        .fillColor(COLOR.text)
        .text(p.advice.trim(), MARGIN, y, { width: CONTENT_W, lineGap: 3 });
      y = doc.y + 10;
    }

    // Follow-up Date
    if (p.follow_up_date) {
      if (y > PAGE.height - 150) {
        doc.addPage();
        this.topAccentBar(doc);
        y = 56;
      }
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
  ): number {
    const availH = PAGE.height - 170 - y;
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

  // ── Per-page Furniture (Footer, Separator, Disclaimer, Bottom Accent) ─────
  private pageFurniture(doc: PDFKit.PDFDocument): void {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);

      // 1. Separator thin line
      const divY = PAGE.height - 75;
      doc
        .save()
        .moveTo(MARGIN, divY)
        .lineTo(PAGE.width - MARGIN, divY)
        .lineWidth(0.5)
        .strokeColor(COLOR.line)
        .stroke()
        .restore();

      // 2. Digitally signed prescription disclaimer
      const disclaimerY = PAGE.height - 60;
      doc
        .font('Helvetica-Oblique')
        .fontSize(9)
        .fillColor(COLOR.muted)
        .text(
          '*This is a digitally signed prescription and does not require signature.*',
          MARGIN,
          disclaimerY,
          { width: CONTENT_W, align: 'center' },
        );

      // 3. Bottom blue accent line
      const barY = PAGE.height - 40;
      doc
        .save()
        .rect(MARGIN, barY, CONTENT_W, 4.5)
        .fill(COLOR.accent)
        .restore();
    }
  }
}
