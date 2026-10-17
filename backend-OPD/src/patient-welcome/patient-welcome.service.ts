import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { Patient } from '../database/models/patient.model';
import { DoctorsService } from '../doctors/doctors.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

/**
 * The one-time "welcome, here is your doctor" WhatsApp message.
 *
 * Sent the first time a number arrives on the patient side — through
 * registration, through opening an account from the booking flow, or through a
 * guest booking. All three call `sendIfFirst`, which is the whole point of a
 * service rather than three copies: the "only once" guarantee lives in one
 * place, keyed on the account's `welcome_sent_at`, so the patient who signs up
 * and then books is greeted once, not twice.
 *
 * Nothing here throws. The account (and, for a booking, the appointment) is
 * already saved by the time this runs; failing that request because a courtesy
 * message did not go out would tell the patient their registration failed when
 * it did not — the same contract `announceLeave` keeps.
 */
@Injectable()
export class PatientWelcomeService {
  private readonly logger = new Logger(PatientWelcomeService.name);

  constructor(
    @InjectModel(Patient) private readonly patientModel: typeof Patient,
    private readonly doctors: DoctorsService,
    private readonly whatsapp: WhatsAppService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Welcome this number, if it has never been welcomed before.
   *
   * `doctorId` is which clinic the patient came through — the QR/portal tenant
   * for a registration, the booked doctor for a booking. Without it there is no
   * link to send, so the greeting is skipped and the stamp left null, leaving
   * the next door (one that does know the doctor) free to send it.
   */
  async sendIfFirst(mobile: string, doctorId?: string | null): Promise<void> {
    try {
      const template = this.config.get<string>('whatsapp.welcomeTemplate') ?? '';
      const language = this.config.get<string>('whatsapp.welcomeTemplateLang') ?? 'en_US';
      // No template approved yet, or no credentials: nothing to send and
      // nothing to record, so a later deploy that configures one still welcomes
      // this account on its next action.
      if (!this.whatsapp.canSendNotice(template)) return;
      if (!doctorId) return;

      const account = await this.patientModel.findOne({ where: { mobile } });
      // Already welcomed — every door after the first is a no-op.
      if (!account || account.welcome_sent_at) return;

      const doctor = await this.doctors.findRawById(doctorId);
      if (!doctor) return;

      // Claim the welcome before sending, so two near-simultaneous doors (a
      // signup and the booking right behind it) cannot both pass the check
      // above and send twice. A send that then fails is logged, not retried —
      // a welcome is not worth a second message storm.
      const [claimed] = await this.patientModel.update(
        { welcome_sent_at: new Date() } as any,
        { where: { id: account.id, welcome_sent_at: null } },
      );
      if (!claimed) return;

      await this.whatsapp.sendTemplate(
        mobile,
        template,
        language,
        [doctor.name, this.doctors.bookingUrl(doctor)],
        { kind: 'welcome', reference: `patient:${account.id}` },
      );
    } catch (err) {
      // Recorded in `whatsapp_messages` with Meta's own reason when it got that
      // far; this line is so the registration/booking log tells the same story.
      this.logger.warn(
        `Welcome message for ${mobile} was not sent: ${(err as Error).message}`,
      );
    }
  }
}
