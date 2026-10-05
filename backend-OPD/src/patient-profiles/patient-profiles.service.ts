import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Patient } from '../database/models/patient.model';
import { PatientProfile } from '../database/models/patient-profile.model';
import { Appointment } from '../database/models/appointment.model';
import { PatientReport } from '../database/models/patient-report.model';
import { Notification } from '../database/models/notification.model';
import { EPrescription } from '../database/models/e-prescription.model';
import { EPrescriptionMedicine } from '../database/models/e-prescription-medicine.model';
import { StorageService } from '../uploads/storage.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AppointmentStatus, ConsultationStatus } from '../common/enums';
import { ageFromDob, dobFromAge } from '../common/utils/age';
import { nowInClinic } from '../common/utils/clinic-time';
import {
  StaffCreatePatientDto,
  StaffUpdatePatientDto,
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
  /** YYYY-MM-DD when known; age is derived from it rather than stored. */
  dob: string | null;
  /**
   * Age as of their most recent visit — the fallback when there is no `dob`.
   * A patient who has not visited yet gets their age today from `dob`, so a
   * fresh registration still prefills its first booking.
   */
  last_age: number | null;
  last_visit_date: string | null;
  visit_count: number;
  /** False once any OPD is done: the record is permanent from then on. */
  can_delete: boolean;
}

/**
 * A patient as the clinic's own list shows them — the summary above plus the
 * number they are registered under, which the account holds rather than the
 * profile.
 */
export interface ClinicPatient extends PatientProfileSummary {
  mobile: string;
  dob: string | null;
  /** The clinical summary the clinic keeps by hand — see the model. */
  blood_group: string | null;
  conditions: string[];
  long_term_medicines: string[];
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
/**
 * What creating a profile actually needs.
 *
 * Looser than `PatientDetailsDto` on purpose: that DTO guards the public
 * booking form, where the patient has their address to hand and should give
 * it. A walk-in is registered at the desk with a queue waiting, so the address
 * can arrive later — the columns are nullable and the next booking fills them
 * in. Validation stays where it belongs, at the request boundary.
 */
export interface NewProfileDetails {
  name: string;
  relation?: string | null;
  gender?: string | null;
  /** YYYY-MM-DD. Age is derived from it so it cannot go stale between visits. */
  dob?: string | null;
  /**
   * What the registration forms ask for instead of a birth date. Used only
   * when `dob` is absent, and kept as an estimated `dob` — see `dobFromAge`.
   */
  age?: number | null;
  address_line?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}

/**
 * How many people one mobile number may register.
 *
 * A family shares a number; a clinic's front desk does not get to turn one
 * number into an unbounded patient list. Archived profiles do not count — the
 * cap is on who is currently registered, so removing someone frees a place.
 */
export const MAX_PROFILES_PER_NUMBER = 5;

/**
 * Trim, drop blanks and de-duplicate a free-text list before it is stored.
 *
 * The clinical lists are typed as comma-separated text in the UI, so a trailing
 * comma or a doubled entry is routine input, not an error — clean it here once
 * rather than guard every read.
 */
function cleanList(values?: string[] | null): string[] {
  if (!values) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = (v ?? '').trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

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
    @InjectModel(EPrescription)
    private readonly prescriptionModel: typeof EPrescription,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  /** Today's date on the clinic's wall clock — what an age is measured against. */
  private today(): string {
    return nowInClinic(
      this.config.get<string>('clinicTimezone') ?? 'Asia/Kolkata',
    ).date;
  }

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
   * Refuse a sixth patient on one number.
   *
   * Checked here rather than at each caller because this is the only place a
   * profile is ever created — self-booking, the patient app and the clinic's
   * walk-in desk all arrive through it, and a cap enforced in one of the three
   * would not be a cap.
   */
  private async assertBelowProfileCap(patientId: string): Promise<void> {
    const registered = await this.profileModel.count({
      where: { patient_id: patientId, archived_at: null },
    });
    if (registered >= MAX_PROFILES_PER_NUMBER) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message:
          `This number already has ${MAX_PROFILES_PER_NUMBER} registered patients, ` +
          'which is the maximum. Remove one to add another.',
      });
    }
  }

  /**
   * Always creates. An identical name on the same account is not a duplicate
   * to be resolved — the caller declined to pick an existing patient, so this
   * is a different person.
   */
  async createForAccount(
    patientId: string,
    dto: NewProfileDetails,
  ): Promise<PatientProfile> {
    await this.assertBelowProfileCap(patientId);
    return this.profileModel.create({
      patient_id: patientId,
      patient_code: await this.generatePatientCode(),
      name: dto.name.trim(),
      relation: dto.relation ?? null,
      gender: dto.gender ?? null,
      // The patient app and site ask for an age, the clinic's desk for a birth
      // date. Dropping the age here left a new patient's first booking with
      // the age field blank, since there was no earlier visit to take it from.
      dob: dto.dob || dobFromAge(dto.age, this.today()),
      // A walk-in may be registered before the desk has the address; the
      // columns are nullable and the next booking fills them in.
      address_line: dto.address_line?.trim() || null,
      city: dto.city?.trim() || null,
      state: dto.state?.trim() || null,
      pincode: dto.pincode || null,
    } as any);
  }

  /**
   * Register a patient from the clinic's own desk.
   *
   * The number is the account — a new one is created on the spot — and the
   * profile is stamped with `registered_by_doctor_id` so it shows on this
   * clinic's list before the first visit. The 5-per-number cap is enforced
   * through the same gate every other create goes through. An identical name is
   * never a merge: the desk chose "new patient", so this is a new person.
   */
  async createForDoctor(
    doctorId: string,
    dto: StaffCreatePatientDto,
  ): Promise<PatientProfile> {
    const account = await this.findOrCreateAccount(dto.mobile);
    await this.assertBelowProfileCap(account.id);
    return this.profileModel.create({
      patient_id: account.id,
      patient_code: await this.generatePatientCode(),
      name: dto.name.trim(),
      relation: dto.relation ?? null,
      gender: dto.gender ?? null,
      dob: dto.dob || dobFromAge(dto.age, this.today()),
      address_line: dto.address_line?.trim() || null,
      city: dto.city?.trim() || null,
      state: dto.state?.trim() || null,
      pincode: dto.pincode || null,
      blood_group: dto.blood_group ?? null,
      conditions: cleanList(dto.conditions),
      long_term_medicines: cleanList(dto.long_term_medicines),
      registered_by_doctor_id: doctorId,
    } as any);
  }

  /** Edit a clinic patient from the desk, after proving it is this clinic's. */
  async updateForDoctor(
    doctorId: string,
    profileId: string,
    dto: StaffUpdatePatientDto,
  ): Promise<PatientProfile> {
    const profile = await this.assertOwnedByDoctor(doctorId, profileId);
    if (dto.name?.trim()) profile.name = dto.name.trim();
    if (dto.relation !== undefined) profile.relation = dto.relation ?? null;
    if (dto.gender !== undefined) profile.gender = dto.gender ?? null;
    if (dto.dob !== undefined) profile.dob = dto.dob || null;
    if (dto.address_line !== undefined)
      profile.address_line = dto.address_line?.trim() || null;
    if (dto.city !== undefined) profile.city = dto.city?.trim() || null;
    if (dto.state !== undefined) profile.state = dto.state?.trim() || null;
    if (dto.pincode !== undefined) profile.pincode = dto.pincode || null;
    if (dto.blood_group !== undefined)
      profile.blood_group = dto.blood_group ?? null;
    if (dto.conditions !== undefined)
      profile.conditions = cleanList(dto.conditions);
    if (dto.long_term_medicines !== undefined)
      profile.long_term_medicines = cleanList(dto.long_term_medicines);
    await profile.save();
    return profile;
  }

  /**
   * Load a profile, proving it is this clinic's — either registered at its desk
   * or seen in at least one of its appointments. The doctor id comes from the
   * caller's token, never the request body, so an id alone grants nothing.
   */
  async assertOwnedByDoctor(
    doctorId: string,
    profileId: string,
  ): Promise<PatientProfile> {
    const profile = await this.profileModel.findByPk(profileId);
    if (!profile || profile.archived_at) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'Patient not found.',
      });
    }
    if (profile.registered_by_doctor_id !== doctorId) {
      const seen = await this.appointmentModel.count({
        where: {
          patient_profile_id: profileId,
          doctor_id: doctorId,
          status: { [Op.ne]: AppointmentStatus.CANCELLED },
        },
      });
      if (!seen) {
        throw new AppException(ErrorCode.NOT_FOUND, {
          message: 'Patient not found.',
        });
      }
    }
    return profile;
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

  /**
   * Every patient this doctor has actually seen, most recent first.
   *
   * Scoped by appointment rather than by account: a clinic's patient list is
   * the people who came to *it*, and the profile rows are shared across the
   * platform. Anyone whose only booking was cancelled is left out — they were
   * never a patient here.
   *
   * Deliberately not built on `summarise`, which runs a query per profile: that
   * is fine for the handful on one number and quadratic for a clinic's whole
   * list. The visit rows are read once and folded in memory instead.
   */
  async listForDoctor(
    doctorId: string,
    search?: string,
  ): Promise<ClinicPatient[]> {
    const visits = await this.appointmentModel.findAll({
      where: {
        doctor_id: doctorId,
        status: { [Op.ne]: AppointmentStatus.CANCELLED },
        patient_profile_id: { [Op.ne]: null },
      },
      attributes: [
        'patient_profile_id',
        'appointment_date',
        'start_time',
        'patient_age',
        'consultation_status',
      ],
      order: [
        ['appointment_date', 'DESC'],
        ['start_time', 'DESC'],
      ],
    });

    // Rows arrive newest first, so the first one seen for a profile is its
    // latest visit and nothing needs re-sorting per patient.
    const stats = new Map<
      string,
      { count: number; latest: (typeof visits)[number]; consulted: boolean }
    >();
    for (const visit of visits) {
      const id = visit.patient_profile_id as string;
      const entry = stats.get(id);
      if (entry) {
        entry.count++;
        entry.consulted ||=
          visit.consultation_status === ConsultationStatus.DONE;
      } else {
        stats.set(id, {
          count: 1,
          latest: visit,
          consulted: visit.consultation_status === ConsultationStatus.DONE,
        });
      }
    }

    // The list is everyone this clinic has *seen* plus everyone it has
    // *registered* but not seen yet — without the second clause a patient the
    // desk just added would vanish until their first booking.
    const profiles = await this.profileModel.findAll({
      where: {
        archived_at: null,
        [Op.or]: [
          ...(stats.size ? [{ id: [...stats.keys()] }] : []),
          { registered_by_doctor_id: doctorId },
        ],
      },
    });
    if (!profiles.length) return [];

    const accounts = await this.patientModel.findAll({
      where: { id: [...new Set(profiles.map((p) => p.patient_id))] },
      attributes: ['id', 'mobile'],
    });
    const mobileOf = new Map(accounts.map((a) => [a.id, a.mobile]));

    const needle = search?.trim().toLowerCase() ?? '';
    const digits = needle.replace(/\D/g, '');

    const rows = profiles.map((profile) => {
      // A desk-registered patient may have no visit yet — then the stat is
      // absent and the visit facts fall back to "not seen".
      const stat = stats.get(profile.id);
      return {
        id: profile.id,
        patient_code: profile.patient_code,
        name: profile.name,
        relation: profile.relation,
        gender: profile.gender,
        dob: profile.dob,
        address_line: profile.address_line,
        city: profile.city,
        state: profile.state,
        pincode: profile.pincode,
        mobile: mobileOf.get(profile.patient_id) ?? '',
        blood_group: profile.blood_group ?? null,
        conditions: profile.conditions ?? [],
        long_term_medicines: profile.long_term_medicines ?? [],
        last_age: stat?.latest.patient_age ?? ageFromDob(profile.dob, this.today()),
        last_visit_date: stat?.latest.appointment_date ?? null,
        visit_count: stat?.count ?? 0,
        can_delete: !stat?.consulted,
      };
    });

    const matched = needle
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(needle) ||
            r.patient_code.toLowerCase().includes(needle) ||
            (!!digits && r.mobile.includes(digits)) ||
            r.conditions.some((c) => c.toLowerCase().includes(needle)),
        )
      : rows;

    return matched.sort((a, b) =>
      (b.last_visit_date ?? '').localeCompare(a.last_visit_date ?? ''),
    );
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
      dob: profile.dob,
      address_line: profile.address_line,
      city: profile.city,
      state: profile.state,
      pincode: profile.pincode,
      last_age: latest?.patient_age ?? ageFromDob(profile.dob, this.today()),
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
    throw new AppException(ErrorCode.SERVICE_BUSY, {
      message:
        'We could not assign a patient number just now. Please try saving again.',
    });
  }
  /**
   * Everything one patient's record adds up to, for the full-history screen.
   *
   * Three queries, not three-per-visit. The visit list already available from
   * `appointments.history` fetches reports and the prescription separately for
   * each row, which is fine for the three visits a consultation shows and
   * quadratic for a patient with forty. This reads the visits, their issued
   * prescriptions with medicines, and the reports, then derives the rest in
   * memory.
   *
   * **The derived sections are read off free text.** A diagnosis is whatever
   * the doctor typed, so "Viral fever" and "viral fever with myalgia" are two
   * different conditions here. Matching is a trim and a lowercase and nothing
   * cleverer: guessing that two phrasings mean one condition would put a
   * disease on a patient's record that no doctor wrote down. The screen says
   * where these come from for the same reason.
   */
  async overview(profileId: string, user: { doctorId?: string | null }) {
    const doctorId = user.doctorId;
    if (!doctorId) {
      throw new AppException(ErrorCode.FORBIDDEN, {
        message: 'A patient record belongs to a clinic.',
      });
    }

    const profile = await this.profileModel.findByPk(profileId);
    if (!profile) {
      throw new AppException(ErrorCode.PATIENT_NOT_FOUND, {
        message: 'Patient not found.',
      });
    }

    // The number is the account's, not the profile's — needed for the profile
    // screen's "book", "family on this number" and block controls.
    const account = await this.patientModel.findByPk(profile.patient_id, {
      attributes: ['mobile'],
    });
    const mobile = account?.mobile ?? null;

    const visits = await this.appointmentModel.findAll({
      where: { patient_profile_id: profileId, doctor_id: doctorId },
      order: [
        ['appointment_date', 'DESC'],
        ['start_time', 'DESC'],
      ],
    });
    const visitIds = visits.map((v) => v.id);

    if (!visitIds.length) {
      return this.emptyOverview(profile, mobile);
    }

    const [prescriptions, reports] = await Promise.all([
      this.prescriptionModel.findAll({
        where: { appointment_id: { [Op.in]: visitIds }, status: 'issued' },
        include: [{ model: EPrescriptionMedicine }],
      }),
      this.reportModel.findAll({
        where: { appointment_id: { [Op.in]: visitIds } },
        order: [['created_at', 'DESC']],
      }),
    ]);

    const rxByVisit = new Map(prescriptions.map((p) => [p.appointment_id, p]));
    const dateOf = new Map(visits.map((v) => [v.id, v.appointment_date]));

    /* ── Conditions ──────────────────────────────────────────
       A diagnosis the doctor wrote, with how often and how recently. */
    const conditions = new Map<
      string,
      { label: string; visits: number; firstSeen: string; lastSeen: string }
    >();
    /* ── Medicines ───────────────────────────────────────────
       Counted per visit, not per line: the same drug twice on one
       prescription is one visit's worth of it, not two. */
    const medicines = new Map<
      string,
      {
        label: string;
        strength: string | null;
        visits: number;
        lastPrescribed: string;
        longestDays: number | null;
      }
    >();

    for (const visit of visits) {
      const date = visit.appointment_date;
      const rx = rxByVisit.get(visit.id);
      if (!rx) continue;

      const dx = (rx.diagnosis ?? '').trim();
      if (dx) {
        const key = dx.toLowerCase();
        const seen = conditions.get(key);
        if (seen) {
          seen.visits += 1;
          // Rows arrive newest first, so an older date only moves `firstSeen`.
          if (date < seen.firstSeen) seen.firstSeen = date;
          if (date > seen.lastSeen) seen.lastSeen = date;
        } else {
          conditions.set(key, { label: dx, visits: 1, firstSeen: date, lastSeen: date });
        }
      }

      const seenThisVisit = new Set<string>();
      for (const m of rx.medicines ?? []) {
        const name = (m.medicine_name ?? '').trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (seenThisVisit.has(key)) continue;
        seenThisVisit.add(key);

        const held = medicines.get(key);
        if (held) {
          held.visits += 1;
          if (date > held.lastPrescribed) held.lastPrescribed = date;
          if ((m.duration_days ?? 0) > (held.longestDays ?? 0)) {
            held.longestDays = m.duration_days ?? held.longestDays;
          }
        } else {
          medicines.set(key, {
            label: name,
            strength: m.strength ?? null,
            visits: 1,
            lastPrescribed: date,
            longestDays: m.duration_days ?? null,
          });
        }
      }
    }

    const allMedicines = [...medicines.values()];

    return {
      profile: {
        id: profile.id,
        patient_code: profile.patient_code,
        name: profile.name,
        gender: profile.gender,
        dob: profile.dob,
        age: ageFromDob(profile.dob, this.today()),
        relation: profile.relation,
        mobile,
        registered_at: profile.createdAt ?? null,
        // The clinical summary the clinic keeps by hand — distinct from the
        // `conditions`/`long_term_medicines` below, which are derived from
        // issued prescriptions. Both are shown, labelled for what they are.
        blood_group: profile.blood_group ?? null,
        recorded_conditions: profile.conditions ?? [],
        recorded_long_term_medicines: profile.long_term_medicines ?? [],
      },
      visit_count: visits.length,
      first_visit: visits[visits.length - 1]?.appointment_date ?? null,
      last_visit: visits[0]?.appointment_date ?? null,

      /* Seen more than once, or written at the most recent visit — the two
         ways something is still going on rather than closed. */
      conditions: [...conditions.values()]
        .filter((c) => c.visits > 1 || c.lastSeen === visits[0]?.appointment_date)
        .sort((a, b) => b.visits - a.visits || b.lastSeen.localeCompare(a.lastSeen)),

      /* On it long-term: prescribed across several visits, or for a month or
         more at a stretch. One 5-day course is not a long-term medicine. */
      long_term_medicines: allMedicines
        .filter((m) => m.visits > 1 || (m.longestDays ?? 0) >= 30)
        .sort((a, b) => b.visits - a.visits || b.lastPrescribed.localeCompare(a.lastPrescribed)),

      most_prescribed: [...allMedicines]
        .sort((a, b) => b.visits - a.visits || a.label.localeCompare(b.label))
        .slice(0, 8),

      reports: await Promise.all(
        reports.map(async (r) => ({
          id: r.id,
          title: r.title,
          url: await this.storage.presignedGetUrl(r.file_key),
          created_at: r.createdAt,
          visit_date: dateOf.get(r.appointment_id ?? '') ?? null,
        })),
      ),

      visits: visits.map((v) => {
        const rx = rxByVisit.get(v.id);
        return {
          id: v.id,
          date: v.appointment_date,
          start_time: v.start_time,
          consultation_status: v.consultation_status,
          status: v.status,
          reason: v.description,
          diagnosis: rx?.diagnosis ?? null,
          advice: rx?.advice ?? null,
          medicines: (rx?.medicines ?? []).map((m) => ({
            medicine_name: m.medicine_name,
            strength: m.strength,
            dosage: m.dosage,
            duration_days: m.duration_days,
            instructions: m.instructions,
          })),
        };
      }),
    };
  }

  /** A patient the clinic has registered but not yet seen. */
  private emptyOverview(profile: PatientProfile, mobile: string | null = null) {
    return {
      profile: {
        id: profile.id,
        patient_code: profile.patient_code,
        name: profile.name,
        gender: profile.gender,
        dob: profile.dob,
        age: ageFromDob(profile.dob, this.today()),
        relation: profile.relation,
        mobile,
        registered_at: profile.createdAt ?? null,
        blood_group: profile.blood_group ?? null,
        recorded_conditions: profile.conditions ?? [],
        recorded_long_term_medicines: profile.long_term_medicines ?? [],
      },
      visit_count: 0,
      first_visit: null,
      last_visit: null,
      conditions: [],
      long_term_medicines: [],
      most_prescribed: [],
      reports: [],
      visits: [],
    };
  }

}
