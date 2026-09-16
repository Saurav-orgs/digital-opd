import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { BlockedNumber } from '../database/models/blocked-number.model';
import { Patient } from '../database/models/patient.model';
import { PatientProfile } from '../database/models/patient-profile.model';
import { User } from '../database/models/user.model';
import { Op } from 'sequelize';
import { ActivityLogService } from '../activity/activity-log.service';
import { ActivityAction } from '../common/enums';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { BlockNumberDto } from './dto/blocked-number.dto';

/** One person registered on a blocked number. */
export interface BlockedPatient {
  id: string;
  name: string;
  patient_code: string;
}

/** A blocked number with the people on it, as the Blocked screen lists them. */
export interface BlockedNumberView {
  id: string;
  mobile: string;
  reason: string | null;
  created_at: Date;
  blocked_by: { id: string; name: string } | null;
  patients: BlockedPatient[];
}

/**
 * Numbers a clinic refuses bookings from.
 *
 * Public booking needs only a number, a name and a free slot, so one nuisance
 * caller can fill a whole day with bookings nobody attends. This is the
 * doctor's own lever against that.
 */
@Injectable()
export class BlockedNumbersService {
  private readonly logger = new Logger(BlockedNumbersService.name);

  constructor(
    @InjectModel(BlockedNumber)
    private readonly model: typeof BlockedNumber,
    @InjectModel(Patient) private readonly patientModel: typeof Patient,
    @InjectModel(PatientProfile)
    private readonly profileModel: typeof PatientProfile,
    private readonly activity: ActivityLogService,
  ) {}

  /**
   * The booking guard. Called on every booking attempt for this doctor —
   * deliberately silent about *why* beyond a plain refusal, since telling a
   * spammer they are blocked just invites them to switch numbers.
   */
  async assertNotBlocked(doctorId: string, mobile: string): Promise<void> {
    const blocked = await this.model.findOne({
      where: { doctor_id: doctorId, mobile },
    });
    if (blocked) {
      this.logger.warn(
        `Blocked booking attempt from ${mobile} for doctor ${doctorId}.`,
      );
      throw new AppException(ErrorCode.FORBIDDEN, {
        message:
          'Online booking is not available for this number. Please call the clinic.',
      });
    }
  }

  /**
   * The blocked list as people, not numbers.
   *
   * A number on its own tells the desk nothing a month later; the names
   * registered on it are what make the row recognisable. They are looked up
   * here rather than stored with the block, because a family can add a member
   * after the block and the row should still show everyone it covers. A
   * number nobody has registered on yet simply has no names.
   */
  async list(user: AuthUser): Promise<BlockedNumberView[]> {
    const rows = await this.model.findAll({
      where: { doctor_id: this.tenant(user) },
      order: [['created_at', 'DESC']],
      include: [{ model: User, as: 'blockedBy', attributes: ['id', 'name'] }],
    });
    if (!rows.length) return [];

    const accounts = await this.patientModel.findAll({
      where: { mobile: { [Op.in]: rows.map((r) => r.mobile) } },
      attributes: ['id', 'mobile'],
    });
    const profiles = accounts.length
      ? await this.profileModel.findAll({
          where: {
            patient_id: { [Op.in]: accounts.map((a) => a.id) },
            archived_at: null,
          },
          attributes: ['id', 'patient_id', 'name', 'patient_code'],
          order: [['created_at', 'ASC']],
        })
      : [];
    const byAccount = new Map<string, BlockedPatient[]>();
    for (const p of profiles) {
      const list = byAccount.get(p.patient_id) ?? [];
      list.push({ id: p.id, name: p.name, patient_code: p.patient_code });
      byAccount.set(p.patient_id, list);
    }
    const byMobile = new Map<string, BlockedPatient[]>();
    for (const a of accounts) byMobile.set(a.mobile, byAccount.get(a.id) ?? []);

    return rows.map((r) => ({
      id: r.id,
      mobile: r.mobile,
      reason: r.reason,
      // `underscored` maps the column, but the attribute is still camelCase.
      created_at: (r.get('createdAt') ?? r.get('created_at')) as Date,
      blocked_by: r.blockedBy ? { id: r.blockedBy.id, name: r.blockedBy.name } : null,
      patients: byMobile.get(r.mobile) ?? [],
    }));
  }

  async block(dto: BlockNumberDto, user: AuthUser): Promise<BlockedNumber> {
    const doctorId = this.tenant(user);
    const existing = await this.model.findOne({
      where: { doctor_id: doctorId, mobile: dto.mobile },
    });
    // Blocking an already-blocked number is not an error; refresh the reason.
    if (existing) {
      if (dto.reason !== undefined) {
        existing.reason = dto.reason?.trim() || null;
        await existing.save();
      }
      return existing;
    }

    const created = await this.model.create({
      doctor_id: doctorId,
      mobile: dto.mobile,
      reason: dto.reason?.trim() || null,
      blocked_by_user_id: user.id,
    } as any);

    this.activity.recordForUser(user, {
      action: ActivityAction.NUMBER_BLOCKED,
      summary: `Blocked ${dto.mobile} from booking.`,
      entity_type: 'blocked_number',
      entity_id: created.id,
      doctor_id: doctorId,
      metadata: { mobile: dto.mobile, reason: dto.reason?.trim() || null },
    });

    return created;
  }

  async unblock(id: string, user: AuthUser): Promise<void> {
    const row = await this.model.findByPk(id);
    if (!row || row.doctor_id !== this.tenant(user)) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'This number is not on your blocked list.',
      });
    }
    await row.destroy();

    this.activity.recordForUser(user, {
      action: ActivityAction.NUMBER_UNBLOCKED,
      summary: `Unblocked ${row.mobile}.`,
      entity_type: 'blocked_number',
      entity_id: row.id,
      doctor_id: row.doctor_id,
      metadata: { mobile: row.mobile },
    });
  }

  /** Every clinical row belongs to one doctor; the super admin has no tenant. */
  private tenant(user: AuthUser): string {
    if (!user.doctorId) {
      throw new AppException(ErrorCode.FORBIDDEN, {
        message: 'Only a clinic can manage blocked numbers.',
      });
    }
    return user.doctorId;
  }
}
