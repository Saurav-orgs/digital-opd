import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Subscription } from '../database/models/subscription.model';
import { User } from '../database/models/user.model';
import { SubscriptionStatus, UserType } from '../common/enums';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

/**
 * The one question login and the JWT strategy ask: may this account use the
 * product right now?
 *
 * Kept apart from the sign-up service so AuthModule can import it without a
 * cycle — the sign-up flow needs AuthService, and AuthService needs this.
 *
 * Who is gated: an account opened through the paid flow
 * (`subscription_required`), and any staff login inside such a doctor's
 * tenant — the clinic's subscription is the doctor's. Everyone else (super
 * admin, doctors who predate plans and their staff) passes untouched.
 */
@Injectable()
export class SubscriptionAccessService {
  constructor(
    @InjectModel(Subscription) private readonly subscriptionModel: typeof Subscription,
    @InjectModel(User) private readonly userModel: typeof User,
  ) {}

  /** Throws SUBSCRIPTION_REQUIRED unless the account's plan is paid up. */
  async assertAccess(user: Pick<User, 'id' | 'type' | 'doctor_id' | 'subscription_required'>): Promise<void> {
    if (user.type === UserType.SUPER_ADMIN) return;
    const ownerId = await this.owningUserId(user);
    if (!ownerId) return;
    const active = await this.activeFor(ownerId);
    if (active) return;

    const everPaid = await this.subscriptionModel.count({
      where: { user_id: ownerId, status: SubscriptionStatus.ACTIVE },
    });
    throw new AppException(ErrorCode.SUBSCRIPTION_REQUIRED, {
      message: everPaid
        ? 'Your subscription has ended. Please renew your plan to keep using myDigitalOPD.'
        : 'Your subscription payment is still pending. Please complete the payment to sign in.',
    });
  }

  /** The active subscription an account is covered by, if any. */
  async activeFor(userId: string): Promise<Subscription | null> {
    return this.subscriptionModel.findOne({
      where: {
        user_id: userId,
        status: SubscriptionStatus.ACTIVE,
        ends_at: { [Op.gt]: new Date() },
      },
      order: [['ends_at', 'DESC']],
    });
  }

  /**
   * Whose subscription applies: the account itself when it was opened through
   * the paid flow, else the paid doctor its tenant belongs to, else nobody.
   */
  private async owningUserId(
    user: Pick<User, 'id' | 'doctor_id' | 'subscription_required'>,
  ): Promise<string | null> {
    if (user.subscription_required) return user.id;
    if (!user.doctor_id) return null;
    const owner = await this.userModel.findOne({
      attributes: ['id'],
      where: { doctor_id: user.doctor_id, type: UserType.DOCTOR, subscription_required: true },
    });
    return owner?.id ?? null;
  }
}
