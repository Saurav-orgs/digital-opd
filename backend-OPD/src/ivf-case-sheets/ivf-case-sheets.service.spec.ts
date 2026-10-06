import { Op } from 'sequelize';
import { IvfCaseSheetsService } from './ivf-case-sheets.service';
import {
  ActivityAction,
  ConsultationStatus,
  PrescriptionStatus,
} from '../common/enums';
import { AppException } from '../common/errors/app.exception';

/**
 * One visit has one prescription, and for an IVF & Fertility doctor it is
 * either this case-sheet or the handwritten/typed one. Two bugs came out of
 * the two documents not knowing about each other, and both are asserted here:
 *
 *   * A doctor who issued the case-sheet could still write on the Handwrite
 *     pad and issue a second prescription for the same visit, because each
 *     document only ever checked its own status.
 *   * The issued sheet never reached the patient's account. Every
 *     patient-facing payload read `e_prescriptions` alone, and the "your
 *     prescription is ready" notice carried the sheet's id under a key
 *     (`caseSheetId`) that nothing looked for — so the patient was told the
 *     document existed and had nowhere to open it, and withdrawing the sheet
 *     left that notice sitting in their feed.
 */
describe('IvfCaseSheetsService', () => {
  const APPT = 'appt-1';

  let sheets: any[];
  let prescriptions: any[];
  let notified: any[];
  let logged: any[];
  /** The appointment row the fake model hands back, so a test can read it. */
  let appointment: any;

  const row = (over: Record<string, unknown> = {}) => {
    const r: any = {
      id: 'sheet-1',
      appointment_id: APPT,
      doctor_id: 'doc-1',
      status: PrescriptionStatus.DRAFT,
      issued_at: null,
      pdf_key: null,
      data: {},
      ...over,
    };
    r.update = async (patch: any) => Object.assign(r, patch);
    r.destroy = async () => sheets.splice(sheets.indexOf(r), 1);
    return r;
  };

  const service = () => {
    const appointmentModel: any = {
      findByPk: async (id: string) => (id === APPT ? appointment : null),
    };
    const doctorModel: any = {
      findByPk: async () => ({ id: 'doc-1', name: 'Rao', specialization: 'IVF & Fertility' }),
    };
    const sheetModel: any = {
      findOne: async ({ where }: any) =>
        sheets.find(
          (s) =>
            s.appointment_id === where.appointment_id &&
            (where.status === undefined || s.status === where.status),
        ) ?? null,
      findByPk: async (id: string) => sheets.find((s) => s.id === id) ?? null,
      findAll: async ({ where }: any) => {
        // `pdfUrlsFor` asks for a list of ids with `Op.in`.
        const ids: string[] = where.id[Op.in];
        return sheets.filter((s) => ids.includes(s.id) && s.status === where.status);
      },
      create: async (attrs: any) => {
        const created = row(attrs);
        sheets.push(created);
        return created;
      },
    };
    const prescriptionModel: any = {
      findOne: async ({ where }: any) =>
        prescriptions.find(
          (p) =>
            p.appointment_id === where.appointment_id &&
            (where.status === undefined || p.status === where.status),
        ) ?? null,
    };
    const pdf: any = { render: async () => Buffer.from('%PDF-1.4') };
    const storage: any = {
      uploadDocument: async () => ({ key: 'ivf-case-sheets/doc-1/sheet.pdf' }),
      presignedGetUrl: async (key: string | null) => (key ? `https://files.test/${key}` : null),
      delete: async () => undefined,
    };
    const activity: any = { recordForUser: (_u: unknown, e: any) => logged.push(e) };
    // Runs the callback with a stub transaction — the fake rows ignore it.
    const sequelize: any = { transaction: async (fn: any) => fn({}) };
    const notifications: any = {
      create: async (
        mobile: string,
        type: string,
        title: string,
        body: string,
        data: Record<string, unknown>,
      ) => notified.push({ mobile, type, title, body, data }),
      removeForPrescription: async () => 1,
    };

    return new IvfCaseSheetsService(
      appointmentModel,
      doctorModel,
      sheetModel,
      prescriptionModel,
      pdf,
      storage,
      notifications,
      activity,
      sequelize,
    );
  };

  /** The treating doctor; `assertAccess` wants a doctorId that matches. */
  const doctorUser: any = { id: 'user-1', doctorId: 'doc-1' };

  const refusal = async (run: () => Promise<unknown>): Promise<AppException> => {
    try {
      await run();
    } catch (err) {
      return err as AppException;
    }
    throw new Error('Expected the call to be refused.');
  };

  beforeEach(() => {
    sheets = [];
    prescriptions = [];
    notified = [];
    logged = [];
    appointment = {
      id: APPT,
      doctor_id: 'doc-1',
      patient_name: 'Asha Verma',
      patient_mobile: '9000000000',
      appointment_date: '2026-10-06',
      consultation_status: ConsultationStatus.PENDING,
    };
    appointment.update = async (patch: any) => Object.assign(appointment, patch);
  });

  // ── One prescription per visit ──────────────────────────────

  it('refuses to write the sheet once the visit has an issued prescription', async () => {
    sheets.push(row());
    prescriptions.push({ appointment_id: APPT, status: PrescriptionStatus.ISSUED });

    const err = await refusal(() =>
      service().update(APPT, { data: { diagnosisAndPlan: 'IUI' } }, doctorUser),
    );
    expect(err.getStatus()).toBe(400);
    expect((err.getResponse() as any).message).toContain('already been issued');
  });

  it('refuses to issue the sheet when the visit was issued the other way', async () => {
    sheets.push(row({ data: { diagnosisAndPlan: 'IVF planned' } }));
    prescriptions.push({ appointment_id: APPT, status: PrescriptionStatus.ISSUED });

    await refusal(() => service().issue(APPT, doctorUser));
    expect(notified).toHaveLength(0);
  });

  it('writes the sheet when the other prescription is only a draft', async () => {
    sheets.push(row());
    prescriptions.push({ appointment_id: APPT, status: PrescriptionStatus.DRAFT });

    const view = await service().update(
      APPT,
      { data: { diagnosisAndPlan: 'IUI' } },
      doctorUser,
    );
    expect((view.data as any).diagnosisAndPlan).toBe('IUI');
  });

  // ── Reaching the patient ───────────────────────────────────

  it('issues under the key the patient’s bell and withdrawal both read', async () => {
    sheets.push(row({ data: { diagnosisAndPlan: 'IVF planned' } }));

    await service().issue(APPT, doctorUser);

    expect(notified).toHaveLength(1);
    // Not `caseSheetId`: the feed mints the download link from
    // `prescriptionId`, and withdrawing clears the notice by matching it.
    expect(notified[0].data).toEqual({
      appointmentId: APPT,
      prescriptionId: 'sheet-1',
    });
  });

  // ── Closing the visit ──────────────────────────────────────

  it('closes the visit, like issuing any other prescription does', async () => {
    sheets.push(row({ data: { diagnosisAndPlan: 'IVF planned' } }));

    await service().issue(APPT, doctorUser);

    expect(appointment.consultation_status).toBe(ConsultationStatus.DONE);
    // The status moved, so something in the log accounts for it.
    const closed = logged.find(
      (e) => e.action === ActivityAction.APPOINTMENT_CONSULTATION_SET,
    );
    expect(closed.metadata).toMatchObject({
      from: ConsultationStatus.PENDING,
      to: ConsultationStatus.DONE,
      via: 'ivf_case_sheet_issue',
    });
    expect(logged.some((e) => e.action === ActivityAction.PRESCRIPTION_ISSUED)).toBe(true);
  });

  it('leaves a no-show visit at the status the doctor chose', async () => {
    sheets.push(row({ data: { diagnosisAndPlan: 'IVF planned' } }));
    appointment.consultation_status = ConsultationStatus.NO_SHOW;

    await service().issue(APPT, doctorUser);

    // A deliberate statement about a visit that did not happen the normal
    // way, never overwritten by a late reprint.
    expect(appointment.consultation_status).toBe(ConsultationStatus.NO_SHOW);
    expect(
      logged.some((e) => e.action === ActivityAction.APPOINTMENT_CONSULTATION_SET),
    ).toBe(false);
  });

  it('projects an issued sheet in the shape every patient client renders', async () => {
    sheets.push(row({ data: { diagnosisAndPlan: 'IVF planned' } }));
    await service().issue(APPT, doctorUser);

    const view = await service().findIssuedForAppointment(APPT);
    expect(view).toMatchObject({
      id: 'sheet-1',
      mode: 'ivf',
      // The sheet's free note is the one line worth showing in a list.
      diagnosis: 'IVF planned',
      // The PDF is the document, exactly as for a handwritten prescription.
      medicines: [],
    });
    expect(view!.pdf_url).toContain('sheet.pdf');
  });

  it('shows the patient nothing while the sheet is still a draft', async () => {
    sheets.push(row({ data: { diagnosisAndPlan: 'IVF planned' } }));
    expect(await service().findIssuedForAppointment(APPT)).toBeNull();
    expect(await service().pdfUrlsFor(['sheet-1'])).toEqual(new Map());
  });

  it('mints a download link per issued sheet for the notification feed', async () => {
    sheets.push(row({ data: { diagnosisAndPlan: 'IVF planned' } }));
    await service().issue(APPT, doctorUser);

    const urls = await service().pdfUrlsFor(['sheet-1', 'not-a-sheet']);
    expect(urls.get('sheet-1')).toContain('sheet.pdf');
    expect(urls.has('not-a-sheet')).toBe(false);
  });
});
