import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Patient } from '../database/models/patient.model';
import { PatientProfile } from '../database/models/patient-profile.model';
import { Appointment } from '../database/models/appointment.model';
import { PatientReport } from '../database/models/patient-report.model';
import { Notification } from '../database/models/notification.model';
import { StorageService } from '../uploads/storage.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AppointmentStatus, ConsultationStatus } from '../common/enums';
import {
  PatientDetailsDto,
  UpdatePatientProfileDto,
} from './dto/patient-profile.dto';

/** One entry in the booking picker. */
export interface PatientProfileSummary {
  id: string;
  patient_code: string;
  name: string;
  relation: string | null;
  gender: string | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  /** Age as of their most recent visit — profiles store no age of their own. */
  last_age: number | null;
  last_visit_date: string | null;
  visit_count: number;
  /** False once any OPD is done: the record is permanent from then on. */
  can_delete: boolean;
}

/**
 * Patients as people, under an account that is just a phone number.
 *
 * The one rule this service exists to enforce: **a patient is never matched by
 * name.** `createForAccount` always creates, even when the name is identical to
 * an existing profile's, because the caller chose "new patient" rather than
 * picking a card. Fuzzy matching here would silently merge two people, which is
 * the failure this whole design avoids.
 */
@Injectable()
export class PatientProfilesService {
  private readonly logger = new Logger(PatientProfilesService.name);

  /** Crockford base32 minus I, L, O and U — unambiguous when read aloud. */
  private static readonly CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

  constructor(
    @InjectModel(Patient) private readonly patientModel: typeof Patient,
    @InjectModel(PatientProfile)
    private readonly profileModel: typeof PatientProfile,
    @InjectModel(Appointment)
    private readonly appointmentModel: typeof Appointment,
    @InjectModel(PatientReport)
    private readonly reportModel: typeof PatientReport,
    @InjectModel(Notification)
    private readonly notificationModel: typeof Notification,
    private readonly storage: StorageService,
  ) {}

  /**
   * The mobile number *is* the account. Typing a new number at the first
   * booking step creates it — no name, no password, nothing else asked.
   */
  async findAccount(mobile: string): Promise<Patient | null> {
    return this.patientModel.findOne({ where: { mobile } });
  }

  async findOrCreateAccount(mobile: string): Promise<Patient> {
    const existing = await this.patientModel.findOne({ where: { mobile } });
    if (existing) return existing;
    return this.patientModel.create({ mobile, name: null } as any);
  }

  /** Everyone registered on this number, most recently seen first. */
  async listForAccount(patientId: string): Promise<PatientProfileSummary[]> {
    const profiles = await this.profileModel.findAll({
      where: { patient_id: patientId, archived_at: null },
      order: [['created_at', 'ASC']],
    });
    const summaries = await Promise.all(
      profiles.map((p) => this.summarise(p)),
    );
    // Whoever visited most recently is the likeliest pick.
    return summaries.sort((a, b) =>
      (b.last_visit_date ?? '').localeCompare(a.last_visit_date ?? ''),
    );
  }

  /**
   * Load a profile, proving it belongs to this account. Every endpoint taking
   * a profile id from the client goes through here — an id in a request body
   * is never trusted on its own.
   */
  async assertOwned(
    patientId: string,
    profileId: string,
  ): Promise<PatientProfile> {
    const profile = await this.profileModel.findByPk(profileId);
    if (!profile || profile.patient_id !== patientId || profile.archived_at) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'Patient not found.',
      });
    }
    return profile;
  }

  /**
   * Always creates. An identical name on the same account is not a duplicate
   * to be resolved — the caller declined to pick an existing patient, so this
   * is a different person.
   */
  async createForAccount(
    patientId: string,
    dto: PatientDetailsDto,
  ): Promise<PatientProfile> {
    return this.profileModel.create({
      patient_id: patientId,
      patient_code: await this.generatePatientCode(),
      name: dto.name.trim(),
      relation: dto.relation ?? null,
      gender: dto.gender ?? null,
      address_line: dto.address_line.trim(),
      city: dto.city.trim(),
      state: dto.state.trim(),
      pincode: dto.pincode,
    } as any);
  }

  async update(
    patientId: string,
    profileId: string,
    dto: UpdatePatientProfileDto,
  ): Promise<PatientProfile> {
    const profile = await this.assertOwned(patientId, profileId);
    if (dto.name?.trim()) profile.name = dto.name.trim();
    if (dto.relation !== undefined) profile.relation = dto.relation;
    if (dto.gender !== undefined) profile.gender = dto.gender;
    if (dto.address_line !== undefined)
      profile.address_line = dto.address_line.trim();
    if (dto.city !== undefined) profile.city = dto.city.trim();
    if (dto.state !== undefined) profile.state = dto.state.trim();
    if (dto.pincode !== undefined) profile.pincode = dto.pincode;
    await profile.save();
    return profile;
  }

  /** Keep the profile's address current, so the next booking prefills right. */
  async refreshAddressFromBooking(
    profileId: string,
    address: {
      address_line?: string | null;
      city?: string | null;
      state?: string | null;
      pincode?: string | null;
      gender?: string | null;
    },
  ): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (address.address_line) patch.address_line = address.address_line;
    if (address.city) patch.city = address.city;
    if (address.state) patch.state = address.state;
    if (address.pincode) patch.pincode = address.pincode;
    if (address.gender) patch.gender = address.gender;
    if (Object.keys(patch).length === 0) return;
    await this.profileModel.update(patch, { where: { id: profileId } });
  }

  /**
   * Delete a patient created by mistake — the recovery path for booking under
   * the wrong person, since nothing in this system merges records.
   *
   * Allowed only while no OPD has been completed. One finished consultation
   * makes the record permanent: there is a prescription and a clinical history
   * attached to it by then, and deleting that is not an undo.
   */
  async remove(patientId: string, profileId: string): Promise<void> {
    const profile = await this.assertOwned(patientId, profileId);

    const consulted = await this.appointmentModel.count({
      where: {
        patient_profile_id: profile.id,
        consultation_status: ConsultationStatus.DONE,
      },
    });
    if (consulted > 0) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message:
          'This patient has a completed OPD and can no longer be deleted.',
      });
    }

    // Cancel anything still on the books so the slots go back into circulation.
    await this.appointmentModel.update(
      { status: AppointmentStatus.CANCELLED } as any,
      {
        where: {
          patient_profile_id: profile.id,
          status: AppointmentStatus.CONFIRMED,
        },
      },
    );

    // Their reports go with them; nothing else references these files.
    const reports = await this.reportModel.findAll({
      where: { patient_profile_id: profile.id },
    });
    for (const report of reports) {
      await this.storage.delete(report.file_key).catch(() => undefined);
    }
    await this.reportModel.destroy({
      where: { patient_profile_id: profile.id },
    });
    await this.notificationModel.destroy({
      where: { patient_profile_id: profile.id },
    });

    // The cancelled appointments stay for the clinic's record, detached.
    await this.appointmentModel.update(
      { patient_profile_id: null } as any,
      { where: { patient_profile_id: profile.id } },
    );

    await profile.destroy();
    this.logger.log(`Deleted patient ${profile.patient_code} (no completed OPD).`);
  }

  // ── internals ──────────────────────────────────────────────

  private async summarise(
    profile: PatientProfile,
  ): Promise<PatientProfileSummary> {
    const visits = await this.appointmentModel.findAll({
      where: {
        patient_profile_id: profile.id,
        status: { [Op.ne]: AppointmentStatus.CANCELLED },
      },
      order: [
        ['appointment_date', 'DESC'],
        ['start_time', 'DESC'],
      ],
    });
    const consulted = visits.some(
      (v) => v.consultation_status === ConsultationStatus.DONE,
    );
    const latest = visits[0];
    return {
      id: profile.id,
      patient_code: profile.patient_code,
      name: profile.name,
      relation: profile.relation,
      gender: profile.gender,
      address_line: profile.address_line,
      city: profile.city,
      state: profile.state,
      pincode: profile.pincode,
      last_age: latest?.patient_age ?? null,
      last_visit_date: latest?.appointment_date ?? null,
      visit_count: visits.length,
      can_delete: !consulted,
    };
  }

  /**
   * `PT-` plus six unambiguous characters. Collisions are vanishingly rare at
   * clinic scale but the column is unique, so retry rather than fail a booking.
   */
  private async generatePatientCode(): Promise<string> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const body = Array.from({ length: 6 }, () => {
        const i = Math.floor(
          Math.random() * PatientProfilesService.CODE_ALPHABET.length,
        );
        return PatientProfilesService.CODE_ALPHABET[i];
      }).join('');
      const code = `PT-${body}`;
      const taken = await this.profileModel.count({
        where: { patient_code: code },
      });
      if (!taken) return code;
    }
    throw new AppException(ErrorCode.INTERNAL_ERROR, {
      message: 'Could not allocate a patient code. Please try again.',
    });
  }
}
