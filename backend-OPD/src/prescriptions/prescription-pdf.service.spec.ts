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
 * Does the document draw any text at all?
 *
 * The strings themselves are compressed in the stream, so looking for a name
 * in the bytes finds nothing either way. A page with no `/Font` resource has
 * no text on it — which is what "as it was uploaded" has to mean: every piece
 * of furniture we compose (header, patient row, footer, rebook block) puts
 * words on the page.
 */
function hasText(pdf: Buffer): boolean {
  return pdf.toString('latin1').includes('/Font');
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

  const UPLOADED = { mode: PrescriptionMode.UPLOADED };

  it('renders an uploaded prescription, one page per scan', async () => {
    const one = await service.render(draft(), [], appointment, doctor, {
      ...UPLOADED,
      scans: [PNG],
    });
    expect(one.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount(one)).toBe(1);

    const three = await service.render(draft(), [], appointment, doctor, {
      ...UPLOADED,
      scans: [PNG, PNG, PNG],
    });
    expect(pageCount(three)).toBe(3);
  });

  it('issues an uploaded prescription as the scan, with no letterhead', async () => {
    const scanOnly = await service.render(draft(), [], appointment, doctor, {
      ...UPLOADED,
      scans: [PNG],
    });
    // The photograph is already a prescription on the doctor's own pad, so
    // nothing of the sheet we compose is drawn over it.
    expect(hasText(scanOnly)).toBe(false);

    // And the print copy is the same page — there is no pad header to leave
    // room for when the pad is in the picture.
    const print = await service.render(draft(), [], appointment, doctor, {
      ...UPLOADED,
      scans: [PNG],
      letterhead: false,
    });
    expect(pageCount(print)).toBe(1);
    expect(hasText(print)).toBe(false);
  });

  /*
   * The rule the whole mode argument exists for. A visit can hold a typed
   * draft, an e-pen page and photographs of the pad all at once — a doctor who
   * starts one way and finishes another leaves the first behind, saved — and
   * the page used to be assembled from whatever existed. Issuing from Type
   * sent the abandoned photograph too; issuing from Upload stapled the
   * half-dictated draft above it.
   */
  it('issues only the tab that issued, when the visit holds more than one draft', async () => {
    const everything = draft({
      diagnosis: 'Viral fever',
      advice: 'Rest and fluids',
      handwriting_image_key: 'hw/1.png',
    });

    // Issued from Type or Record: our letterhead and the typed rows. The
    // photographs are not in it — the same visit with no scans renders the
    // same bytes.
    const typed = await service.render(everything, [medicine], appointment, doctor, {
      mode: PrescriptionMode.STRUCTURED,
      scans: [PNG, PNG],
    });
    const typedAlone = await service.render(everything, [medicine], appointment, doctor, {
      mode: PrescriptionMode.STRUCTURED,
    });
    expect(hasText(typed)).toBe(true);
    expect(pageCount(typed)).toBe(1);
    expect(typed.length).toBe(typedAlone.length);

    // Issued from Upload: the photographs, and not a word of the typed draft
    // sitting beside them.
    const uploaded = await service.render(everything, [medicine], appointment, doctor, {
      ...UPLOADED,
      scans: [PNG, PNG],
    });
    expect(hasText(uploaded)).toBe(false);
    expect(pageCount(uploaded)).toBe(2);
  });

  it('survives a scan that is not a readable image', async () => {
    const buf = await service.render(draft(), [], appointment, doctor, {
      ...UPLOADED,
      scans: [Buffer.from('not an image'), PNG],
    });
    // The unreadable one leaves its page blank; the other still reaches the
    // patient, because a bad photo must not cost them the prescription.
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount(buf)).toBe(2);
  });

  it('still renders an empty prescription as an empty prescription', async () => {
    const buf = await service.render(draft(), [], appointment, doctor);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount(buf)).toBe(1);
  });
});
