import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PDFDocument from 'pdfkit';
import { Appointment } from '../database/models/appointment.model';
import { Doctor } from '../database/models/doctor.model';
import { IvfCaseSheet } from '../database/models/ivf-case-sheet.model';
import { StorageService } from '../uploads/storage.service';
import {
  COLOR,
  CONTENT_W,
  EnvClinic,
  FOOTER_TOP,
  HEADER_TOP,
  MARGIN,
  continuationPage,
  doctorHeader,
  fetchHeaderImage,
  headerHeight,
  headerRule,
  imageHeader,
  pageFurniture,
  patientInfo,
} from '../prescriptions/prescription-pdf.layout';
import {
  FEMALE_TESTS,
  InvestigationValue,
  IvfCaseSheetData,
  MALE_TESTS,
  SemenRow,
} from './ivf-case-sheet.schema';

/**
 * Makes room for the next block: returns the Y to draw at, starting a new page
 * first when `need` points would run past the bottom of the frame. Callers
 * always reassign (`y = ensure(y, n)`) — see the note where it is built.
 */
type Ensure = (y: number, need: number) => number;

/**
 * Renders an IVF case-sheet as the A4 PDF it is issued as, drawn onto the
 * doctor's letterhead. The header, the frame and the footer are the shared pad
 * furniture (`prescription-pdf.layout`), identical to the prescription's; only
 * the body — the couple, the history, the investigation panels and the plan —
 * is this document's own.
 *
 * `letterhead: false` is the print copy: the header space is kept but left
 * blank for the doctor's own pre-printed pad, and no footer of ours is drawn.
 */
@Injectable()
export class IvfCaseSheetPdfService {
  private readonly logger = new Logger(IvfCaseSheetPdfService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {}

  async render(
    sheet: IvfCaseSheet,
    appointment: Appointment,
    doctor: Doctor,
    opts: { letterhead?: boolean } = {},
  ): Promise<Buffer> {
    const letterhead = opts.letterhead !== false;
    // The lowest baseline the body may reach before a new page. The issued copy
    // stops above its footer; the print copy keeps the same stop so the two
    // paginate alike.
    const bodyBottom = FOOTER_TOP - 14;

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

    // Header: the doctor's own pad top when they have one, otherwise composed.
    let y: number;
    if (doctor.letterhead_header_key && !letterhead) {
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

    const data = sheet.data || {};

    /**
     * Start a new page when the next block will not fit, and hand back the Y to
     * carry on at.
     *
     * It *returns* the new Y rather than reassigning one: each section renderer
     * tracks its own `y`, so a version that only mutated this closure's copy
     * broke the page the moment a table ran long — the break happened, but the
     * renderer kept drawing at the old Y, over the footer, leaving the fresh
     * page blank. Every caller must therefore write `y = ensure(y, n)`.
     */
    const ensure: Ensure = (atY, need) =>
      atY + need > bodyBottom ? continuationPage(doc) : atY;

    // Same opening as the prescription: the doctor's header, the blue rule,
    // then the patient row. The case sheet used to replace that row with a big
    // "IVF CASE SHEET" banner, which is why it did not read as the same
    // letterhead the Profile preview shows.
    y = patientInfo(doc, appointment, y);
    y = this.titleRow(doc, y);
    y = this.coupleBlock(doc, data, y, ensure);
    y = this.historyBlock(doc, data, y, ensure);
    y = this.femaleInvestigations(doc, data, y, ensure);
    y = this.semenAnalysis(doc, data.semenAnalysis, y, ensure);
    y = this.maleInvestigations(doc, data, y, ensure);
    y = this.usgAndAfc(doc, data, y, ensure);
    this.diagnosisAndPlan(doc, data.diagnosisAndPlan, y, ensure);

    if (letterhead) pageFurniture(doc);

    doc.end();
    return done;
  }

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

  // ── Sheet label ──────────────────────────────────────────────
  /**
   * A quiet label for which prescription form this is. The date is not
   * repeated here — the patient row above already carries it.
   */
  private titleRow(doc: PDFKit.PDFDocument, y: number): number {
    doc
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .fillColor(COLOR.muted)
      .text('IVF PRESCRIPTION', MARGIN, y, {
        width: CONTENT_W,
        characterSpacing: 0.6,
      });
    return doc.y + 10;
  }

  // ── Couple + vitals ──────────────────────────────────────────
  private coupleBlock(
    doc: PDFKit.PDFDocument,
    data: IvfCaseSheetData,
    y: number,
    ensure: Ensure,
  ): number {
    y = ensure(y, 70);
    const halfW = (CONTENT_W - 20) / 2;
    const rightX = MARGIN + halfW + 20;

    const person = (
      label: string,
      p: { name?: string; age?: string; occupation?: string } | undefined,
      x: number,
      top: number,
    ): number => {
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(COLOR.ink)
        .text(label, x, top, { width: halfW });
      const extras = [
        p?.age ? `Age ${p.age}` : null,
        p?.occupation ? `Occ. ${p.occupation}` : null,
      ].filter(Boolean);
      doc
        .font('Helvetica')
        .fontSize(10.5)
        .fillColor(COLOR.text)
        .text(p?.name || '—', x, doc.y + 2, { width: halfW });
      if (extras.length) {
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor(COLOR.muted)
          .text(extras.join('  ·  '), x, doc.y + 1, { width: halfW });
      }
      return doc.y;
    };

    const leftBottom = person('Wife', data.wife, MARGIN, y);
    const rightBottom = person('Husband', data.husband, rightX, y);
    y = Math.max(leftBottom, rightBottom) + 10;

    const v = data.vitals;
    const vitals = [
      v?.weight ? `Weight: ${v.weight}` : null,
      v?.height ? `Height: ${v.height}` : null,
      v?.bmi ? `BMI: ${v.bmi}` : null,
      v?.bp ? `BP: ${v.bp}` : null,
      v?.date ? `Dated: ${v.date}` : null,
    ].filter(Boolean);
    if (vitals.length) {
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(COLOR.text)
        .text(vitals.join('      '), MARGIN, y, { width: CONTENT_W });
      y = doc.y + 8;
    }

    return y + 4;
  }

  // ── History (label: value list) ──────────────────────────────
  private historyBlock(
    doc: PDFKit.PDFDocument,
    d: IvfCaseSheetData,
    y: number,
    ensure: Ensure,
  ): number {
    const mh = d.medicalHistory;
    const medical = [
      mh?.dm ? `DM: ${mh.dm}` : null,
      mh?.ht ? `HT: ${mh.ht}` : null,
      mh?.thyroid ? `Thyroid: ${mh.thyroid}` : null,
      mh?.tb ? `TB: ${mh.tb}` : null,
      mh?.others ? `Others: ${mh.others}` : null,
    ].filter(Boolean).join('  ·  ');

    const ce = d.clinicalExam;
    const exam = [
      ce?.thyroid ? `Thyroid: ${ce.thyroid}` : null,
      ce?.galactorrhoea ? `Galactorrhoea: ${ce.galactorrhoea}` : null,
      ce?.hirsutism ? `Hirsutism: ${ce.hirsutism}` : null,
      ce?.psppv ? `P/S/P/V: ${ce.psppv}` : null,
    ].filter(Boolean).join('  ·  ');

    const ph = d.partnerHistory;
    const partner = [
      ph?.medical ? `Medical: ${ph.medical}` : null,
      ph?.surgical ? `Surgical: ${ph.surgical}` : null,
    ].filter(Boolean).join('  ·  ');

    const hsg = d.hsg
      ? [
          d.hsg.date ? `Date ${d.hsg.date}` : null,
          d.hsg.uterus ? `Uterus: ${d.hsg.uterus}` : null,
          d.hsg.tubes ? `Tubes: ${d.hsg.tubes}` : null,
        ].filter(Boolean).join('  ·  ')
      : '';
    const lap = d.laparoscopy
      ? [d.laparoscopy.date, d.laparoscopy.notes].filter(Boolean).join(' — ')
      : '';
    const hys = d.hysteroscopy
      ? [d.hysteroscopy.date, d.hysteroscopy.notes].filter(Boolean).join(' — ')
      : '';

    const rows: [string, string | undefined][] = [
      ['Married since', d.marriedSinceYrs],
      ['Duration of infertility', d.durationOfInfertility],
      ['Menstrual history / cycle', d.menstrualCycle],
      ['LMP', d.lmp],
      ['Obstetric history (O/H)', d.obstetricHistory],
      ['Medical history', medical || undefined],
      ['Coital difficulty', d.coitalDifficulty],
      ['Contraception', d.contraception],
      ['Surgical history', d.surgicalHistory],
      ['Family history', d.familyHistory],
      ['Drug allergy', d.drugAllergy],
      ['Ovulation induction', d.ovulationInduction],
      ['Previous IUI', d.previousIUI],
      ['Stimulation', d.stimulation],
      ['Previous IVF details', d.previousIVFDetails],
      ['HSG', hsg || undefined],
      ['Laparoscopy', lap || undefined],
      ['Hysteroscopy', hys || undefined],
      ['Clinical exam', exam || undefined],
      ["Partner's history", partner || undefined],
      ['Smoking', d.smoking],
      ['Substance abuse', d.substanceAbuse],
    ];

    const present = rows.filter(([, v]) => v && v.trim());
    if (present.length === 0) return y;

    y = this.sectionTitle(doc, 'HISTORY', y, ensure);

    const labelW = 150;
    const valueX = MARGIN + labelW + 8;
    const valueW = CONTENT_W - labelW - 8;

    for (const [label, value] of present) {
      // Room for the label and the value's first line, so a row never starts
      // at the very bottom; the value itself then flows and breaks on its own.
      y = ensure(y, 22);
      const rowY = y;
      doc
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .fillColor(COLOR.muted)
        .text(label, MARGIN, rowY, { width: labelW });
      doc.font('Helvetica').fontSize(10).fillColor(COLOR.text);
      y = this.flowText(doc, value!, valueX, valueW, rowY, ensure) + 5;
    }

    return y + 6;
  }

  // ── Investigation panels ─────────────────────────────────────
  private femaleInvestigations(
    doc: PDFKit.PDFDocument,
    d: IvfCaseSheetData,
    y: number,
    ensure: Ensure,
  ): number {
    const values = d.femaleInvestigations || {};
    const extras = [
      d.femaleBloodGroup ? `Blood group: ${d.femaleBloodGroup}` : null,
      d.thrombophilias ? `Thrombophilias: ${d.thrombophilias}` : null,
      d.karyotypeWife ? `Karyotype (wife): ${d.karyotypeWife}` : null,
      d.papSmear ? `PAP smear (LBC): ${d.papSmear}` : null,
      d.hpv ? `HPV: ${d.hpv}` : null,
    ].filter(Boolean);

    const hasValues = FEMALE_TESTS.some((t) => this.hasValue(values[t.key]));
    if (!hasValues && extras.length === 0) return y;

    y = this.sectionTitle(doc, 'INVESTIGATIONS — FEMALE PARTNER', y, ensure);
    if (hasValues) {
      y = this.investigationTable(doc, FEMALE_TESTS, values, y, ensure);
    }
    if (extras.length) {
      y = this.inlineNote(doc, extras.join('      '), y, ensure);
    }
    return y + 6;
  }

  private maleInvestigations(
    doc: PDFKit.PDFDocument,
    d: IvfCaseSheetData,
    y: number,
    ensure: Ensure,
  ): number {
    const values = d.maleInvestigations || {};
    const hasValues = MALE_TESTS.some((t) => this.hasValue(values[t.key]));
    const bg = d.maleBloodGroup ? `Blood group: ${d.maleBloodGroup}` : '';
    if (!hasValues && !bg) return y;

    y = this.sectionTitle(doc, 'INVESTIGATIONS — MALE PARTNER', y, ensure);
    if (hasValues) {
      y = this.investigationTable(doc, MALE_TESTS, values, y, ensure);
    }
    if (bg) y = this.inlineNote(doc, bg, y, ensure);
    return y + 6;
  }

  /**
   * A two-up grid of TEST · DATE · REPORT, the pad's own layout: the panel's
   * rows are split down the middle so a 22-test list is eleven rows wide rather
   * than twenty-two tall.
   */
  private investigationTable(
    doc: PDFKit.PDFDocument,
    tests: { key: string; label: string }[],
    values: Record<string, InvestigationValue>,
    y: number,
    ensure: Ensure,
  ): number {
    const rows = tests.map((t) => ({ label: t.label, v: values[t.key] }));
    const half = Math.ceil(rows.length / 2);
    const left = rows.slice(0, half);
    const right = rows.slice(half);

    const groupW = (CONTENT_W - 16) / 2;
    const testW = groupW * 0.42;
    const dateW = groupW * 0.26;
    const reportW = groupW - testW - dateW;
    const rowH = 15;

    const header = (x: number, top: number) => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(COLOR.muted);
      doc.text('TEST', x + 3, top + 3, { width: testW - 4 });
      doc.text('DATE', x + testW + 3, top + 3, { width: dateW - 4 });
      doc.text('REPORT', x + testW + dateW + 3, top + 3, { width: reportW - 4 });
    };

    const cell = (
      label: string,
      v: InvestigationValue | undefined,
      x: number,
      top: number,
    ) => {
      doc.save().rect(x, top, groupW, rowH).lineWidth(0.4).strokeColor(COLOR.line).stroke().restore();
      doc.font('Helvetica').fontSize(8).fillColor(COLOR.ink);
      doc.text(label, x + 3, top + 3.5, { width: testW - 4, lineBreak: false, ellipsis: true });
      doc.fillColor(COLOR.text);
      doc.text(v?.date || '', x + testW + 3, top + 3.5, { width: dateW - 4, lineBreak: false, ellipsis: true });
      doc.text(v?.report || '', x + testW + dateW + 3, top + 3.5, { width: reportW - 4, lineBreak: false, ellipsis: true });
    };

    const leftX = MARGIN;
    const rightXcol = MARGIN + groupW + 16;

    y = ensure(y, rowH + 4);
    header(leftX, y);
    header(rightXcol, y);
    y += rowH;

    for (let i = 0; i < half; i++) {
      const broke = ensure(y, rowH + 2);
      if (broke !== y) {
        // Carried onto a new page: the headings go with it, or the rows below
        // read as three unlabelled columns.
        y = broke;
        header(leftX, y);
        header(rightXcol, y);
        y += rowH;
      }
      if (left[i]) cell(left[i].label, left[i].v, leftX, y);
      if (right[i]) cell(right[i].label, right[i].v, rightXcol, y);
      y += rowH;
    }
    return y + 4;
  }

  // ── Semen analysis ───────────────────────────────────────────
  private semenAnalysis(
    doc: PDFKit.PDFDocument,
    rows: SemenRow[] | undefined,
    y: number,
    ensure: Ensure,
  ): number {
    const present = (rows || []).filter(
      (r) =>
        r.datePlace ||
        r.vol ||
        r.count ||
        r.motility ||
        r.morphology ||
        r.pc ||
        r.fructose,
    );
    if (present.length === 0) return y;

    y = this.sectionTitle(doc, 'SEMEN ANALYSIS', y, ensure);

    const cols: { key: keyof SemenRow; label: string; w: number }[] = [
      { key: 'datePlace', label: 'Date / Place', w: 0.22 },
      { key: 'vol', label: 'Vol', w: 0.11 },
      { key: 'count', label: 'Count', w: 0.13 },
      { key: 'motility', label: 'Motility', w: 0.14 },
      { key: 'morphology', label: 'Morphology', w: 0.16 },
      { key: 'pc', label: 'P.C.', w: 0.12 },
      { key: 'fructose', label: 'Fructose', w: 0.12 },
    ];
    const rowH = 16;
    let x = MARGIN;
    const widths = cols.map((c) => c.w * CONTENT_W);

    // Header plus every row in one reservation — the table is three rows at
    // most, so it either fits here or starts the next page whole.
    y = ensure(y, rowH * (present.length + 1) + 4);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(COLOR.muted);
    cols.forEach((c, i) => {
      doc.text(c.label, x + 3, y + 4, { width: widths[i] - 4, lineBreak: false, ellipsis: true });
      x += widths[i];
    });
    y += rowH;

    for (const r of present) {
      y = ensure(y, rowH + 2);
      x = MARGIN;
      cols.forEach((c, i) => {
        doc.save().rect(x, y, widths[i], rowH).lineWidth(0.4).strokeColor(COLOR.line).stroke().restore();
        doc
          .font('Helvetica')
          .fontSize(8.5)
          .fillColor(COLOR.text)
          .text((r[c.key] as string) || '', x + 3, y + 4, {
            width: widths[i] - 4,
            lineBreak: false,
            ellipsis: true,
          });
        x += widths[i];
      });
      y += rowH;
    }
    return y + 6;
  }

  // ── USG / AFC ────────────────────────────────────────────────
  private usgAndAfc(
    doc: PDFKit.PDFDocument,
    d: IvfCaseSheetData,
    y: number,
    ensure: Ensure,
  ): number {
    const parts = [
      d.usgPelvis?.date ? `USG (Pelvis) date: ${d.usgPelvis.date}` : null,
      d.usgPelvis?.notes ? d.usgPelvis.notes : null,
      d.afc?.rt ? `AFC Rt: ${d.afc.rt}` : null,
      d.afc?.lt ? `AFC Lt: ${d.afc.lt}` : null,
    ].filter(Boolean);
    if (parts.length === 0) return y;

    y = this.sectionTitle(doc, 'USG (PELVIS) / AFC', y, ensure);
    return this.inlineNote(doc, parts.join('      '), y, ensure) + 6;
  }

  // ── Diagnosis & Plan ─────────────────────────────────────────
  private diagnosisAndPlan(
    doc: PDFKit.PDFDocument,
    text: string | undefined,
    y: number,
    ensure: Ensure,
  ): number {
    if (!text?.trim()) return y;
    y = this.sectionTitle(doc, 'DIAGNOSIS & PLAN', y, ensure);
    doc.font('Helvetica').fontSize(10.5).fillColor(COLOR.text);
    return this.flowText(doc, text.trim(), MARGIN, CONTENT_W, y, ensure) + 6;
  }

  // ── Shared bits ──────────────────────────────────────────────
  private sectionTitle(
    doc: PDFKit.PDFDocument,
    title: string,
    y: number,
    ensure: Ensure,
  ): number {
    y = ensure(y, 52);
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(COLOR.ink)
      .text(title, MARGIN, y, { characterSpacing: 0.5 });
    const barY = doc.y + 2;
    doc
      .save()
      .rect(MARGIN, barY, CONTENT_W, 1.5)
      .fill(COLOR.accent)
      .restore();
    return barY + 8;
  }

  private inlineNote(
    doc: PDFKit.PDFDocument,
    text: string,
    y: number,
    ensure: Ensure,
  ): number {
    doc.font('Helvetica').fontSize(9.5).fillColor(COLOR.text);
    return this.flowText(doc, text, MARGIN, CONTENT_W, y, ensure) + 4;
  }

  /**
   * Draw a paragraph line by line, taking a page break between lines when the
   * next one will not fit.
   *
   * `doc.text` with a width flows the whole block in one go, and with a bottom
   * margin of 0 PDFKit happily runs it off the bottom of the page — which is
   * how the diagnosis note ended up under the footer. Measuring and placing
   * each line ourselves keeps every line inside the frame, however long the
   * text is. The caller sets the font, size and colour first.
   */
  private flowText(
    doc: PDFKit.PDFDocument,
    text: string,
    x: number,
    width: number,
    y: number,
    ensure: Ensure,
  ): number {
    const lineH = doc.currentLineHeight() + 2;
    let line = '';
    const flush = () => {
      if (!line) return;
      y = ensure(y, lineH);
      doc.text(line, x, y, { width, lineBreak: false });
      y += lineH;
      line = '';
    };
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && doc.widthOfString(candidate) > width) {
        flush();
        line = word;
      } else {
        line = candidate;
      }
    }
    flush();
    return y;
  }

  private hasValue(v: InvestigationValue | undefined): boolean {
    return !!(v && (v.date || v.report));
  }
}
