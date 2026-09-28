import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
 * Who is gated: **every doctor account**, and every staff login inside a
 * doctor's tenant — the clinic's subscription is the doctor's. Only the
 * platform super admin, and an account belonging to no tenant at all, pass
 * untouched.
 *
 * It is deliberately decided on the account's *type* and tenant rather than on
 * the `users.subscription_required` flag. The flag only ever said "this
 * account arrived through the online plan flow", so a doctor the super admin
 * created with `POST /doctors`, or one who registered themselves before plans
 * existed, was left ungated: they could sign in with no plan at all, and —
 * because the same flag guarded the checkout — could not buy one either.
 * Licensing is a property of being a doctor on this platform, not of the door
 * the account came in through.
 */
@Injectable()
export class SubscriptionAccessService {
  private readonly landingBase: string;

  constructor(
    @InjectModel(Subscription) private readonly subscriptionModel: typeof Subscription,
    @InjectModel(User) private readonly userModel: typeof User,
    config: ConfigService,
  ) {
    this.landingBase = config.get<string>('landingWebBase')!;
  }

  /** Throws SUBSCRIPTION_REQUIRED unless the account's plan is paid up. */
  async assertAccess(user: Pick<User, 'id' | 'type' | 'doctor_id'>): Promise<void> {
    if (user.type === UserType.SUPER_ADMIN) return;
    const owners = await this.owningUserIds(user);
    if (owners.length === 0) return;
    if (await this.anyActiveFor(owners)) return;
    // Staff are refused for their clinic's plan, which is not theirs to buy:
    // a cycle bought on a receptionist's login would cover nobody, and the
    // sign-in screen must not offer them a checkout they cannot complete.
    if (user.type !== UserType.DOCTOR) {
      throw new AppException(ErrorCode.SUBSCRIPTION_REQUIRED, {
        message:
          "This clinic's subscription is not active, so nobody can sign in. Please ask the doctor to choose a plan.",
      });
    }
    await this.refuse(owners[0]);
  }

  /**
   * Is any of these accounts on a live plan? One query and one boolean.
   *
   * This runs on every authenticated request, via the JWT strategy, so it is
   * the cheapest question that answers it: a COUNT rather than the whole
   * subscription row, and one round trip rather than one per owner. It used
   * to `await activeFor(...)` in a loop, which for a clinic with two doctor
   * logins meant two sequential SELECTs of full rows on every API call, to
   * decide something neither row was read for.
   */
  private async anyActiveFor(userIds: string[]): Promise<boolean> {
    if (userIds.length === 0) return false;
    const live = await this.subscriptionModel.count({
      where: {
        user_id: { [Op.in]: userIds },
        status: SubscriptionStatus.ACTIVE,
        ends_at: { [Op.gt]: new Date() },
      },
    });
    return live > 0;
  }

  /**
   * The active subscription an account is covered by, if any.
   *
   * Returns the row, so callers that need its dates — the renewal window, the
   * Billing screen — get them. {@link assertAccess} deliberately does not use
   * it; see `anyActiveFor` above.
   */
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
   * An account the pricing page opened whose payment never went through.
   *
   * The account is created before the checkout, so a failed or abandoned
   * payment leaves it behind — and with it the email address, which then
   * refused the doctor's next attempt as "already exists". Such an account
   * holds nothing: no practice, no plan, no history worth keeping. So signing
   * up again with the same (freshly verified) email takes it over instead.
   *
   * `paid_at` is the test for "ever held a plan", as in {@link refuse}: it is
   * set on payment and on a grant, never on an order that was only opened. An
   * account the super admin invited is excluded — its password is in the
   * doctor's inbox, and it is somebody else's to hand over.
   */
  async isUnfinishedSignup(
    user: Pick<User, 'id' | 'type' | 'doctor_id' | 'invited_by' | 'is_active'>,
  ): Promise<boolean> {
    if (user.type !== UserType.DOCTOR) return false;
    if (user.doctor_id || user.invited_by || !user.is_active) return false;
    const everHad = await this.subscriptionModel.count({
      where: { user_id: user.id, paid_at: { [Op.ne]: null } },
    });
    return everHad === 0;
  }

  /**
   * Four different situations wear the same face — a doctor with no live plan
   * — and the message says which, because "your plan ran out", "your payment
   * never completed" and "we never mapped you a plan" are not the same news.
   * An account somebody here opened is told so too, and offered the team as
   * well as the checkout — its plan is usually ours to map.
   *
   * `paid_at` is set both when money arrives and when a plan is granted, and
   * never on an order that was only opened — so it is the honest test of "this
   * account has held a plan before" and keeps an abandoned checkout out of the
   * renewal message.
   *
   * Every one of them ends in the same offer — `details.canSubscribe`, which
   * the sign-in screen turns into the plan list and a checkout for this very
   * account. The doctor is already at the one screen where the answer is, so
   * being sent somewhere else to find it was the wrong end of the problem.
   * `details.planUrl` is the public pricing page, for a client that would
   * rather link out than show the plans itself.
   */
  private async refuse(ownerId: string): Promise<never> {
    const details = { canSubscribe: true, planUrl: `${this.landingBase}/#pricing` };
    const [everHad, everOrdered, owner] = await Promise.all([
      this.subscriptionModel.count({
        where: { user_id: ownerId, paid_at: { [Op.ne]: null } },
      }),
      this.subscriptionModel.count({ where: { user_id: ownerId } }),
      this.userModel.findByPk(ownerId, { attributes: ['id', 'invited_by'] }),
    ]);

    if (everHad > 0) {
      throw new AppException(ErrorCode.SUBSCRIPTION_REQUIRED, {
        message:
          'Your subscription has ended. Choose a plan below to reactivate your account.',
        details,
      });
    }
    if (everOrdered > 0) {
      throw new AppException(ErrorCode.SUBSCRIPTION_REQUIRED, {
        message:
          'Your subscription payment did not complete, so this account is not active yet. Choose a plan below to finish activating it.',
        details,
      });
    }
    if (owner?.invited_by) {
      throw new AppException(ErrorCode.SUBSCRIPTION_REQUIRED, {
        message:
          'No plan has been added to your account yet. Choose a plan below to activate it, or contact the myDigitalOPD team.',
        details,
      });
    }
    throw new AppException(ErrorCode.SUBSCRIPTION_REQUIRED, {
      message:
        'This account has no active plan. Choose a plan below to activate it.',
      details,
    });
  }

  /**
   * Whose subscription applies: a doctor account is licensed in its own right;
   * a staff login is covered by the doctor account(s) of the tenant it belongs
   * to; anything else (a platform admin with no tenant, a patient) is not
   * licensed at all.
   *
   * A tenant has one doctor login in practice, but the list is returned rather
   * than the first row so a second one cannot silently lock the clinic's staff
   * out of a plan that is genuinely live.
   */
  private async owningUserIds(user: Pick<User, 'id' | 'type' | 'doctor_id'>): Promise<string[]> {
    if (user.type === UserType.DOCTOR) return [user.id];
    if (!user.doctor_id) return [];
    const owners = await this.userModel.findAll({
      attributes: ['id'],
      where: { doctor_id: user.doctor_id, type: UserType.DOCTOR },
      order: [['createdAt', 'ASC']],
    });
    return owners.map((o) => o.id);
  }
}
