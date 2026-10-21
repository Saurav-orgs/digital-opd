import { ConfigService } from '@nestjs/config';
import { PatientWelcomeService } from './patient-welcome.service';

/**
 * The one-time patient welcome.
 *
 * It fires from three patient-side doors (register, signup, guest booking), so
 * what matters here is the shared guarantees that do not belong to any one of
 * them: only once per number, skipped when nothing can be sent, and never a
 * thrown error back at the caller. Exercised on the service directly — the
 * doors themselves only forward a mobile and a doctor id to it.
 */
function build(opts: {
  template?: string;
  account?: { id: string; welcome_sent_at: Date | null } | null;
  doctor?: { id: string; name: string } | null;
  claimed?: number;
}) {
  const template = opts.template ?? 'patient_welcome';
  const whatsapp = {
    canSendNotice: (t: string) => !!t,
    sendTemplate: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    get: (key: string) =>
      key === 'whatsapp.welcomeTemplate'
        ? template
        : key === 'whatsapp.welcomeTemplateLang'
          ? 'en_US'
          : undefined,
  } as unknown as ConfigService;
  const patientModel = {
    findOne: jest.fn().mockResolvedValue(
      opts.account === undefined
        ? { id: 'acc-1', welcome_sent_at: null }
        : opts.account,
    ),
    // One row claimed means this call won the race to send; zero means another
    // door already did.
    update: jest.fn().mockResolvedValue([opts.claimed ?? 1]),
  };
  const doctors = {
    findRawById: jest.fn().mockResolvedValue(
      opts.doctor === undefined ? { id: 'doc-1', name: 'Dr Meera Iyer' } : opts.doctor,
    ),
    bookingUrl: jest.fn().mockReturnValue('https://book.example.test/d/meera-iyer'),
  };

  const service = Object.create(PatientWelcomeService.prototype) as PatientWelcomeService;
  Object.assign(service, {
    patientModel,
    doctors,
    whatsapp,
    config,
    logger: { warn: jest.fn() },
  });
  return { service, whatsapp, patientModel, doctors };
}

describe('PatientWelcomeService — the one-time welcome', () => {
  it('sends the doctor name and booking link the first time', async () => {
    const { service, whatsapp } = build({});
    await service.sendIfFirst('9876543210', 'doc-1');
    expect(whatsapp.sendTemplate).toHaveBeenCalledWith(
      '9876543210',
      'patient_welcome',
      'en_US',
      ['Dr Meera Iyer', 'https://book.example.test/d/meera-iyer'],
      expect.objectContaining({ kind: 'welcome' }),
    );
  });

  it('stamps the account before sending, so a second door cannot send again', async () => {
    const { service, whatsapp, patientModel } = build({});
    await service.sendIfFirst('9876543210', 'doc-1');
    // The claim is the guard: update to welcome_sent_at only where it was null.
    expect(patientModel.update).toHaveBeenCalledWith(
      expect.objectContaining({ welcome_sent_at: expect.any(Date) }),
      { where: { id: 'acc-1', welcome_sent_at: null } },
    );
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
  });

  it('says nothing for a number that was already welcomed', async () => {
    const { service, whatsapp, doctors } = build({
      account: { id: 'acc-1', welcome_sent_at: new Date('2026-01-01') },
    });
    await service.sendIfFirst('9876543210', 'doc-1');
    expect(doctors.findRawById).not.toHaveBeenCalled();
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
  });

  it('does not send when another door won the claim', async () => {
    const { service, whatsapp } = build({ claimed: 0 });
    await service.sendIfFirst('9876543210', 'doc-1');
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
  });

  it('stays silent, and claims nothing, while no template is configured', async () => {
    const { service, whatsapp, patientModel } = build({ template: '' });
    await service.sendIfFirst('9876543210', 'doc-1');
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    // Left unclaimed, so a later deploy that approves a template still welcomes.
    expect(patientModel.update).not.toHaveBeenCalled();
  });

  it('skips a door that does not know which doctor the patient came through', async () => {
    const { service, whatsapp, patientModel } = build({});
    await service.sendIfFirst('9876543210', undefined);
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(patientModel.update).not.toHaveBeenCalled();
  });

  it('skips a stale doctor id without claiming the welcome', async () => {
    const { service, whatsapp, patientModel } = build({ doctor: null });
    await service.sendIfFirst('9876543210', 'gone');
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(patientModel.update).not.toHaveBeenCalled();
  });

  it('swallows a failed send — the account is already registered', async () => {
    const { service, whatsapp } = build({});
    whatsapp.sendTemplate.mockRejectedValueOnce(new Error('Meta said no'));
    await expect(service.sendIfFirst('9876543210', 'doc-1')).resolves.toBeUndefined();
  });
});
