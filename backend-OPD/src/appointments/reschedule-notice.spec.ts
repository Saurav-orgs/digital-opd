import { ConfigService } from '@nestjs/config';
import { AppointmentsService } from './appointments.service';

const appointment = {
  id: 'appt-1',
  doctor_id: 'doc-1',
  patient_name: 'Asha Verma',
  patient_mobile: '9876543210',
};

/**
 * Only the collaborators this path touches; the rest of the service is not
 * involved in sending a message.
 */
function build(template: string) {
  const whatsapp = {
    canSendNotice: (t: string) => !!t,
    sendTemplate: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    get: (key: string) =>
      key === 'whatsapp.rescheduleTemplate'
        ? template
        : key === 'whatsapp.rescheduleTemplateLang'
          ? 'en_US'
          : undefined,
  } as unknown as ConfigService;
  const doctorModel = {
    findByPk: jest.fn().mockResolvedValue({ id: 'doc-1', name: 'Dr Meera Iyer' }),
  };

  const service = Object.create(AppointmentsService.prototype) as AppointmentsService;
  Object.assign(service, {
    doctorModel,
    config,
    whatsapp,
    logger: { warn: jest.fn(), error: jest.fn() },
  });
  return { service, whatsapp, doctorModel };
}

/** The private sender, reached the way the reschedule path reaches it. */
const send = (service: AppointmentsService) =>
  (
    service as unknown as {
      sendRescheduleNotice: (a: unknown, d: string, t: string) => Promise<void>;
    }
  ).sendRescheduleNotice(appointment, '2026-10-20', '11:30');

/**
 * Telling the patient their visit has moved.
 *
 * The in-app notification has always gone out; this covers the WhatsApp half,
 * which can only be sent through a Meta-approved template and so has to stay
 * silent — not broken — until one is configured. Exercised directly rather
 * than through `reschedule`, which would need the slot engine, the models and
 * a transaction to reach three lines of messaging.
 */
describe('AppointmentsService — the reschedule notice', () => {
  it('says nothing while no approved template is configured', async () => {
    const { service, whatsapp, doctorModel } = build('');
    await send(service);
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    // Not even a lookup: nothing to build a message out of.
    expect(doctorModel.findByPk).not.toHaveBeenCalled();
  });

  it('sends the new date and time once a template is configured', async () => {
    const { service, whatsapp } = build('reschedule_notice');
    await send(service);
    expect(whatsapp.sendTemplate).toHaveBeenCalledWith(
      '9876543210',
      'reschedule_notice',
      'en_US',
      ['Asha Verma', 'Dr Meera Iyer', 'Tue, 20 Oct 2026', '11:30 AM'],
      expect.objectContaining({ kind: 'reschedule_notice' }),
    );
  });

  it('does not prefix the doctor name, which carries its own title', async () => {
    const { service, whatsapp } = build('reschedule_notice');
    await send(service);
    expect(whatsapp.sendTemplate.mock.calls[0][3][1]).toBe('Dr Meera Iyer');
  });

  it('swallows a failed send — the appointment has already moved', async () => {
    const { service, whatsapp } = build('reschedule_notice');
    whatsapp.sendTemplate.mockRejectedValueOnce(new Error('Meta said no'));
    await expect(send(service)).resolves.toBeUndefined();
  });
});
