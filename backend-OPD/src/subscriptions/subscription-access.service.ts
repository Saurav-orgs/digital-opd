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
 * Who is gated: an account opened through the paid flow or by a super admin
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

    // Three different situations wear the same face — a gated account with no
    // live plan — and the doctor can only act on one of them, so the message
    // has to say which. A plan that ran out is theirs to renew; a checkout
    // they abandoned is theirs to finish; an account somebody opened for them
    // and never mapped a plan to is ours to fix, and saying so saves them
    // hunting for a payment screen that was never meant for them.
    // `paid_at` is set both when money arrives and when a plan is granted, and
    // never on an order that was only opened — so it is the honest test of
    // "this account has held a plan before" and keeps an abandoned checkout
    // out of the renewal message.
    const [everHad, owner] = await Promise.all([
      this.subscriptionModel.count({
        where: { user_id: ownerId, paid_at: { [Op.ne]: null } },
      }),
      this.userModel.findByPk(ownerId, { attributes: ['id', 'invited_by'] }),
    ]);

    if (everHad > 0) {
      throw new AppException(ErrorCode.SUBSCRIPTION_REQUIRED, {
        message: 'Your subscription has ended. Please renew your plan to keep using myDigitalOPD.',
      });
    }
    throw new AppException(ErrorCode.SUBSCRIPTION_REQUIRED, {
      message: owner?.invited_by
        ? 'No plan has been added to your account yet, so you cannot sign in. Please contact the myDigitalOPD team.'
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
