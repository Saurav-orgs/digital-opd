import { ConfigService } from '@nestjs/config';
import { PrescriptionPdfService } from './prescription-pdf.service';
import { StorageService } from '../uploads/storage.service';
import { DoctorsService } from '../doctors/doctors.service';
import { EPrescription } from '../database/models/e-prescription.model';
import { EPrescriptionMedicine } from '../database/models/e-prescription-medicine.model';
import { Appointment } from '../database/models/appointment.model';
import { Doctor } from '../database/models/doctor.model';
import { PrescriptionMode, PrescriptionStatus } from '../common/enums';

/** A 2×2 red PNG — a stand-in for the photograph of a prescription pad. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGO4IycHRAwQCgAhpgRhTxp8CQAAAABJRU5ErkJggg==',
  'base64',
);

/** A draft with nothing in it, unless the test puts something there. */
const draft = (over: Partial<EPrescription> = {}) =>
  ({
    id: 'p1',
    status: PrescriptionStatus.DRAFT,
    mode: PrescriptionMode.STRUCTURED,
    diagnosis: null,
    previous_history: null,
    advice: null,
    follow_up_date: null,
    handwriting_image_key: null,
    ...over,
  }) as unknown as EPrescription;

/** How many pages the rendered document has. */
function pageCount(pdf: Buffer): number {
  return pdf.toString('latin1').split('/Type /Page\n').length - 1;
}

/**
 * The prescription body, rendered to bytes — no DB, no S3.
 *
 * The scan pages are what these lock down: a visit whose prescription is a
 * photograph of the doctor's pad used to be unissuable, and the fix is only
 * worth anything if the photo actually reaches the PDF the patient opens.
 */
describe('PrescriptionPdfService', () => {
  const config = { get: () => undefined } as unknown as ConfigService;
  const storage = { download: jest.fn() } as unknown as StorageService;
  const doctors = {
    bookingUrl: () => 'https://patient.test/d/sweta-rao',
  } as unknown as DoctorsService;
  const service = new PrescriptionPdfService(config, storage, doctors);

  const doctor = {
    name: 'Sweta Rao',
    qualifications: 'MBBS, MD',
    specialization: 'General Medicine',
    clinic_name: 'Rao Clinic',
    clinic_address: '12, MG Road, Pune',
    letterhead_header_key: null,
    letterhead_header_ratio: null,
  } as unknown as Doctor;

  const appointment = {
    id: 'a1',
    patient_name: 'Ramesh Kulkarni',
    patient_age: 44,
    patient_gender: 'male',
    appointment_date: '2026-10-08',
    doctor_id: 'd1',
  } as unknown as Appointment;

  const medicine = {
    medicine_name: 'Paracetamol',
    strength: '500mg',
    dosage: 'Twice a day',
    duration_days: 3,
    instructions: 'after food',
  } as unknown as EPrescriptionMedicine;

  it('renders a scan-only prescription, one page per scan', async () => {
    const one = await service.render(draft(), [], appointment, doctor, {
      scans: [PNG],
    });
    expect(one.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount(one)).toBe(1);

    const three = await service.render(draft(), [], appointment, doctor, {
      scans: [PNG, PNG, PNG],
    });
    expect(pageCount(three)).toBe(3);
  });

  it('keeps the typed body and adds the scan to it', async () => {
    const written = draft({ diagnosis: 'Viral fever', advice: 'Rest and fluids' });
    const typed = await service.render(written, [medicine], appointment, doctor);
    const withScan = await service.render(written, [medicine], appointment, doctor, {
      scans: [PNG],
    });
    // Both carry the typed body — a doctor who photographed the pad *and*
    // typed meant both to reach the patient — and the scan is extra bytes on
    // top of it, not a replacement for it.
    expect(pageCount(typed)).toBe(1);
    expect(withScan.length).toBeGreaterThan(typed.length);
  });

  it('survives a scan that is not a readable image', async () => {
    const buf = await service.render(draft(), [], appointment, doctor, {
      scans: [Buffer.from('not an image')],
    });
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('still renders an empty prescription as an empty prescription', async () => {
    const buf = await service.render(draft(), [], appointment, doctor);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount(buf)).toBe(1);
  });
});
