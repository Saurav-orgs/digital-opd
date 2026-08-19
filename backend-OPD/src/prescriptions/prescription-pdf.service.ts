import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PDFDocument from 'pdfkit';
import { Appointment } from '../database/models/appointment.model';
import { Doctor } from '../database/models/doctor.model';
import { EPrescription } from '../database/models/e-prescription.model';
import { EPrescriptionMedicine } from '../database/models/e-prescription-medicine.model';

/** Layout constants for an A4 prescription. */
const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 40;
const CONTENT_W = PAGE.width - MARGIN * 2;
const COLOR = {
  brand: '#0F766E', // deep teal — clinical, not corporate
  brandDark: '#0B5750',
  ink: '#1A1A1A',
  soft: '#555555',
  faint: '#8A8A8A',
  line: '#D9D9D9',
  band: '#EAF3F1', // very light teal for the patient bar
  zebra: '#F5F8F7',
};

/**
 * Renders an issued prescription as a proper prescription pad: a branded
 * letterhead with the doctor's name and qualifications, a patient bar, an Rx
 * table, advice, and a signature block — the kind of sheet a pharmacist expects.
 */
@Injectable()
export class PrescriptionPdfService {
  constructor(private readonly config: ConfigService) {}

  async render(
    prescription: EPrescription,
    medicines: EPrescriptionMedicine[],
    appointment: Appointment,
    doctor: Doctor,
  ): Promise<Buffer> {
    // bottom: 0 prevents PDFKit from auto-adding pages when the footer lands
    // below the default 40 pt bottom margin. All page-break logic is manual.
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

    let y = this.letterhead(doc, doctor);
    y = this.patientBar(doc, appointment, y);
    y = this.diagnosis(doc, prescription, y);
    y = this.medicines(doc, medicines, y);
    y = this.advice(doc, prescription, y);
    this.signature(doc, doctor, y);
    this.pageFurniture(doc); // footer band + timestamp on every page

    doc.end();
    return done;
  }

  // ── Letterhead ─────────────────────────────────────────────
  private letterhead(doc: PDFKit.PDFDocument, doctor: Doctor): number {
    const clinic = this.config.get<{
      name: string;
      address: string;
      phone: string;
      email: string;
    }>('clinic')!;

    const bandH = 84;
    doc.save().rect(0, 0, PAGE.width, bandH).fill(COLOR.brand).restore();
    // A thin accent stripe under the band.
    doc.save().rect(0, bandH, PAGE.width, 3).fill(COLOR.brandDark).restore();

    // Practice title: the clinic name if branded, otherwise the doctor's name.
    const title = clinic.name || doctor.name;
    doc
      .fillColor('#FFFFFF')
      .font('Helvetica-Bold')
      .fontSize(20)
      .text(title, MARGIN, 20, { width: CONTENT_W - 150 });

    const creds = [doctor.qualifications, doctor.specialization]
      .filter(Boolean)
      .join('  •  ');
    if (creds) {
      doc
        .font('Helvetica')
        .fontSize(10.5)
        .fillColor('#DCEDEA')
        .text(creds, MARGIN, 48, { width: CONTENT_W - 150 });
    }
    // When the clinic is branded, still name the doctor beneath the title.
    if (clinic.name) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(10)
        .fillColor('#CFE6E2')
        .text(doctor.name, MARGIN, creds ? 63 : 48);
    }

    // Right-aligned clinic contact block inside the band.
    const contact = [clinic.address, clinic.phone, clinic.email]
      .filter(Boolean)
      .join('\n');
    if (contact) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#EAF3F1')
        .text(contact, PAGE.width - MARGIN - 200, 22, {
          width: 200,
          align: 'right',
          lineGap: 2,
        });
    }

    return bandH + 22;
  }

  // ── Patient bar ────────────────────────────────────────────
  private patientBar(
    doc: PDFKit.PDFDocument,
    appt: Appointment,
    y: number,
  ): number {
    const h = 58;
    doc
      .save()
      .roundedRect(MARGIN, y, CONTENT_W, h, 6)
      .fill(COLOR.band)
      .restore();

    const genderAge = [
      appt.patient_gender
        ? appt.patient_gender[0].toUpperCase() + appt.patient_gender.slice(1)
        : null,
      appt.patient_age != null ? `${appt.patient_age} yrs` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    // Two rows of label/value pairs, laid out in three columns.
    const pad = 12;
    const colW = (CONTENT_W - pad * 2) / 3;
    const cell = (
      label: string,
      value: string,
      col: number,
      row: number,
    ) => {
      const cx = MARGIN + pad + col * colW;
      const cy = y + 8 + row * 18;
      doc.font('Helvetica').fontSize(7.5).fillColor(COLOR.faint).text(label.toUpperCase(), cx, cy);
      doc
        .font('Helvetica-Bold')
        .fontSize(10.5)
        .fillColor(COLOR.ink)
        .text(value || '—', cx, cy + 8, { width: colW - 6, ellipsis: true });
    };

    cell('Patient', appt.patient_name, 0, 0);
    cell('Age / Sex', genderAge, 1, 0);
    cell('Date', appt.appointment_date, 2, 0);
    cell('Mobile', appt.patient_mobile, 0, 1);

    return y + h + 16;
  }

  // ── Diagnosis ──────────────────────────────────────────────
  private diagnosis(
    doc: PDFKit.PDFDocument,
    p: EPrescription,
    y: number,
  ): number {
    if (!p.diagnosis?.trim()) return y;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOR.brand).text('DIAGNOSIS', MARGIN, y);
    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor(COLOR.ink)
      .text(p.diagnosis.trim(), MARGIN, y + 12, { width: CONTENT_W });
    return doc.y + 14;
  }

  // ── Rx table ───────────────────────────────────────────────
  private medicines(
    doc: PDFKit.PDFDocument,
    meds: EPrescriptionMedicine[],
    y: number,
  ): number {
    // Big serif Rx mark, the way a prescription opens.
    doc.font('Times-BoldItalic').fontSize(26).fillColor(COLOR.brand).text('Rx', MARGIN, y - 4);
    y += 30;

    if (meds.length === 0) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(10)
        .fillColor(COLOR.soft)
        .text('No medicines prescribed.', MARGIN, y);
      return y + 20;
    }

    // Column layout: #, Medicine, Dosage, When, Days.
    const cols = [
      { key: 'n', w: 22, align: 'left' as const },
      { key: 'med', w: 250, align: 'left' as const },
      { key: 'dose', w: 90, align: 'left' as const },
      { key: 'when', w: 100, align: 'left' as const },
      { key: 'days', w: CONTENT_W - 22 - 250 - 90 - 100, align: 'left' as const },
    ];
    const x = (i: number) => MARGIN + cols.slice(0, i).reduce((a, c) => a + c.w, 0);

    // Header row.
    const headH = 20;
    doc.save().rect(MARGIN, y, CONTENT_W, headH).fill(COLOR.brand).restore();
    const heads = ['#', 'Medicine', 'Dosage', 'When', 'Days'];
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#FFFFFF');
    heads.forEach((h, i) =>
      doc.text(h, x(i) + 5, y + 6, { width: cols[i].w - 8, align: cols[i].align }),
    );
    y += headH;

    meds.forEach((m, idx) => {
      const title = [m.medicine_name, m.strength].filter(Boolean).join(' ');
      const rowH = m.instructions?.trim() ? 34 : 24;

      // Page break before a row that wouldn't fit above the footer.
      if (y + rowH > PAGE.height - 130) {
        doc.addPage();
        y = MARGIN + 10;
      }

      if (idx % 2 === 1) {
        doc.save().rect(MARGIN, y, CONTENT_W, rowH).fill(COLOR.zebra).restore();
      }

      doc.font('Helvetica').fontSize(10).fillColor(COLOR.ink);
      doc.text(String(idx + 1), x(0) + 5, y + 6, { width: cols[0].w - 8 });
      doc.font('Helvetica-Bold').text(title, x(1) + 5, y + 6, { width: cols[1].w - 8 });
      doc.font('Helvetica').fillColor(COLOR.soft);
      doc.text(m.dosage || '—', x(2) + 5, y + 6, { width: cols[2].w - 8 });
      doc.text(m.timing || '—', x(3) + 5, y + 6, { width: cols[3].w - 8 });
      doc.text(m.duration_days ? String(m.duration_days) : '—', x(4) + 5, y + 6, {
        width: cols[4].w - 8,
      });

      if (m.instructions?.trim()) {
        doc
          .font('Helvetica-Oblique')
          .fontSize(8.5)
          .fillColor(COLOR.faint)
          .text(m.instructions.trim(), x(1) + 5, y + 20, {
            width: CONTENT_W - cols[0].w - 10,
          });
      }

      // Row separator.
      doc
        .save()
        .moveTo(MARGIN, y + rowH)
        .lineTo(MARGIN + CONTENT_W, y + rowH)
        .lineWidth(0.5)
        .strokeColor(COLOR.line)
        .stroke()
        .restore();
      y += rowH;
    });

    return y + 18;
  }

  // ── Advice & follow-up ─────────────────────────────────────
  private advice(doc: PDFKit.PDFDocument, p: EPrescription, y: number): number {
    if (p.advice?.trim()) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOR.brand).text('ADVICE', MARGIN, y);
      doc
        .font('Helvetica')
        .fontSize(10.5)
        .fillColor(COLOR.ink)
        .text(p.advice.trim(), MARGIN, y + 13, { width: CONTENT_W, lineGap: 2 });
      y = doc.y + 12;
    }
    if (p.follow_up_date) {
      doc
        .font('Helvetica-Bold')
        .fontSize(10.5)
        .fillColor(COLOR.ink)
        .text(`Follow-up on ${p.follow_up_date}`, MARGIN, y);
      y = doc.y + 12;
    }
    return y;
  }

  // ── Signature ──────────────────────────────────────────────
  private signature(doc: PDFKit.PDFDocument, doctor: Doctor, y: number): void {
    // Sit the block near the bottom, but never on top of the content.
    const top = Math.max(y + 20, PAGE.height - 140);
    const boxW = 200;
    const x = PAGE.width - MARGIN - boxW;

    doc
      .moveTo(x, top + 24)
      .lineTo(x + boxW, top + 24)
      .lineWidth(0.8)
      .strokeColor(COLOR.line)
      .stroke();
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(COLOR.ink)
      .text(doctor.name, x, top + 30, { width: boxW, align: 'center' });
    const creds = [doctor.qualifications, doctor.specialization]
      .filter(Boolean)
      .join(', ');
    if (creds) {
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(COLOR.soft)
        .text(creds, x, top + 44, { width: boxW, align: 'center' });
    }
    doc
      .font('Helvetica-Oblique')
      .fontSize(8)
      .fillColor(COLOR.faint)
      .text('Digitally issued — valid without a physical signature.', x, top + 58, {
        width: boxW,
        align: 'center',
      });
  }

  // ── Per-page footer band ───────────────────────────────────
  private pageFurniture(doc: PDFKit.PDFDocument): void {
    const clinic = this.config.get<{ name: string; phone: string }>('clinic')!;
    const issued = new Date().toLocaleString('en-IN', {
      timeZone: this.config.get<string>('clinicTimezone') ?? 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const fy = PAGE.height - 34;
      doc
        .save()
        .moveTo(MARGIN, fy)
        .lineTo(PAGE.width - MARGIN, fy)
        .lineWidth(0.5)
        .strokeColor(COLOR.line)
        .stroke()
        .restore();
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(COLOR.faint)
        .text(
          'This is a computer-generated prescription.' +
            (clinic.phone ? `  •  ${clinic.phone}` : ''),
          MARGIN,
          fy + 6,
          { width: CONTENT_W / 2 },
        );
      doc.text(`Issued ${issued}`, MARGIN + CONTENT_W / 2, fy + 6, {
        width: CONTENT_W / 2,
        align: 'right',
      });
    }
  }
}
