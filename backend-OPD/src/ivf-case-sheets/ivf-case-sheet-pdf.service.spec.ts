import PDFDocument from 'pdfkit';
import { ConfigService } from '@nestjs/config';
import { IvfCaseSheetPdfService } from './ivf-case-sheet-pdf.service';
import { StorageService } from '../uploads/storage.service';
import { IvfCaseSheet } from '../database/models/ivf-case-sheet.model';
import { Appointment } from '../database/models/appointment.model';
import { Doctor } from '../database/models/doctor.model';
import { FEMALE_TESTS, MALE_TESTS } from './ivf-case-sheet.schema';

/**
 * Renders a filled sheet all the way to PDF bytes — the whole body renderer,
 * every section, with no DB or S3. The doctor has no uploaded header, so the
 * composed header path runs and storage is never touched.
 */
describe('IvfCaseSheetPdfService', () => {
  const config = { get: () => undefined } as unknown as ConfigService;
  const storage = {
    download: jest.fn(),
  } as unknown as StorageService;
  const service = new IvfCaseSheetPdfService(config, storage);

  const doctor = {
    name: 'Shweta Mittal',
    qualifications: 'MD (OBGY), DNB',
    specialization: 'IVF & Fertility',
    clinic_name: 'Unity Healthcare',
    clinic_address: '7/11, New Delhi',
    clinic_phone: '011-41809050',
    letterhead_header_key: null,
    letterhead_header_ratio: null,
  } as unknown as Doctor;

  const appointment = {
    id: 'a1',
    patient_name: 'Asha Verma',
    patient_age: 32,
    patient_gender: 'female',
    appointment_date: '2026-10-05',
    doctor_id: 'd1',
  } as unknown as Appointment;

  const sheet = {
    id: 's1',
    data: {
      wife: { name: 'Asha Verma', age: '32', occupation: 'Teacher' },
      husband: { name: 'Raj Verma', age: '35' },
      vitals: { weight: '58', height: '160', bmi: '22.6', bp: '118/76', date: '2026-10-05' },
      marriedSinceYrs: '5',
      durationOfInfertility: '3 yrs',
      menstrualCycle: '28 days',
      medicalHistory: { thyroid: 'hypo, on thyroxine' },
      femaleBloodGroup: 'B+',
      femaleInvestigations: {
        fsh: { date: '2026-09-02', report: '6.1' },
        amh: { date: '2026-09-02', report: '2.4' },
      },
      semenAnalysis: [{ datePlace: '02/09 SGRH', vol: '2.5', count: '45', motility: '55%' }],
      maleInvestigations: { totalTest: { report: '450' } },
      afc: { rt: '7', lt: '8' },
      diagnosisAndPlan: 'Primary infertility. Plan: antagonist protocol IVF.',
    },
  } as unknown as IvfCaseSheet;

  it('renders a filled sheet to a non-trivial PDF', async () => {
    const buf = await service.render(sheet, appointment, doctor);
    expect(buf.length).toBeGreaterThan(1500);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(storage.download).not.toHaveBeenCalled();
  });

  it('renders the print copy (no letterhead) too', async () => {
    const buf = await service.render(sheet, appointment, doctor, { letterhead: false });
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('renders an almost-empty sheet without throwing', async () => {
    const bare = { id: 's2', data: { lmp: '2026-10-01' } } as unknown as IvfCaseSheet;
    const buf = await service.render(bare, appointment, doctor);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  /**
   * A sheet long enough to run over several pages.
   *
   * The body renderers each track their own `y`, and `ensure` used to only
   * reassign the one in `render`: a table that ran long broke the page but
   * kept drawing at the old `y`, so rows piled up under the footer and the
   * new page came out blank. This watches the actual draw calls — the only
   * place that sees the real coordinates — and fails if anything but the
   * footer furniture is drawn below the frame.
   */
  it('keeps every page inside the frame when the sheet runs long', async () => {
    const femaleInvestigations: Record<string, { date: string; report: string }> = {};
    FEMALE_TESTS.forEach((t, i) => {
      femaleInvestigations[t.key] = { date: `0${(i % 9) + 1}/09/2026`, report: `value ${i}` };
    });
    const maleInvestigations: Record<string, { date: string; report: string }> = {};
    MALE_TESTS.forEach((t, i) => {
      maleInvestigations[t.key] = { date: `1${i % 9}/09/2026`, report: `res ${i}` };
    });
    const long = (w: string) => Array(25).fill(w).join(' ');

    const big = {
      id: 's3',
      data: {
        wife: { name: 'Asha Verma', age: '32' },
        husband: { name: 'Raj Verma', age: '35' },
        obstetricHistory: long('G1P0 missed abortion'),
        surgicalHistory: long('appendicectomy 2019'),
        familyHistory: long('mother type 2 DM'),
        ovulationInduction: long('3 cycles letrozole'),
        previousIVFDetails: long('antagonist cycle cancelled'),
        femaleInvestigations,
        maleInvestigations,
        thrombophilias: long('APLA negative'),
        semenAnalysis: [{ vol: '2.5' }, { vol: '3.0' }, { vol: '2.8' }],
        usgPelvis: { notes: long('AFC 15 normal uterus') },
        diagnosisAndPlan: long('Primary infertility, plan antagonist protocol IVF with ICSI.'),
      },
    } as unknown as IvfCaseSheet;

    // The bottom of the body frame, as the renderer computes it.
    const FLOOR = 841.89 - 75 - 14;
    const proto = PDFDocument.prototype as unknown as Record<string, any>;
    const origText = proto.text;
    const origRect = proto.rect;
    const offenders: string[] = [];
    proto.text = function (t: unknown, x: unknown, y: unknown, ...rest: unknown[]) {
      // The footer's own disclaimer is meant to sit down there.
      if (typeof y === 'number' && y > FLOOR && !String(t).includes('digitally signed')) {
        offenders.push(`text "${String(t).slice(0, 24)}" at y=${y.toFixed(1)}`);
      }
      return origText.call(this, t, x, y, ...rest);
    };
    proto.rect = function (x: unknown, y: unknown, w: unknown, h: unknown) {
      // h === 4.5 is the page's accent bar, which belongs at the very bottom.
      if (typeof y === 'number' && typeof h === 'number' && h !== 4.5 && y + h > FLOOR + 14) {
        offenders.push(`rect at y=${y.toFixed(1)} h=${h}`);
      }
      return origRect.call(this, x, y, w, h);
    };

    try {
      const buf = await service.render(big, appointment, doctor);
      expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      // More than one page, or the case is not exercising pagination at all.
      expect(buf.length).toBeGreaterThan(5000);
    } finally {
      proto.text = origText;
      proto.rect = origRect;
    }

    expect(offenders).toEqual([]);
  });
});
