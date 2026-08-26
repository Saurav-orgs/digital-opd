import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { BlockedNumber } from '../database/models/blocked-number.model';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { BlockNumberDto } from './dto/blocked-number.dto';

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

  async list(user: AuthUser): Promise<BlockedNumber[]> {
    return this.model.findAll({
      where: { doctor_id: this.tenant(user) },
      order: [['created_at', 'DESC']],
    });
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

    return this.model.create({
      doctor_id: doctorId,
      mobile: dto.mobile,
      reason: dto.reason?.trim() || null,
      blocked_by_user_id: user.id,
    } as any);
  }

  async unblock(id: string, user: AuthUser): Promise<void> {
    const row = await this.model.findByPk(id);
    if (!row || row.doctor_id !== this.tenant(user)) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'This number is not on your blocked list.',
      });
    }
    await row.destroy();
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
