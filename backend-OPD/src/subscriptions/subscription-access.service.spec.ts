import { Op } from 'sequelize';
import { SubscriptionAccessService } from './subscription-access.service';
import { UserType } from '../common/enums';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

/**
 * This service is the licence. Getting it wrong is not a visible bug — it is a
 * doctor using the product for free, or a paying clinic locked out mid-clinic —
 * so who it lets through, and what it tells the ones it refuses, is asserted
 * here rather than trusted.
 *
 * The regression it exists to prevent: gating used to be read off
 * `users.subscription_required`, which left every doctor account that did not
 * come in through the pricing page both ungated and unable to buy a plan.
 */
describe('SubscriptionAccessService', () => {
  /** Rows the fake models answer from. */
  let subscriptions: any[];
  let users: any[];

  const service = () => {
    const subscriptionModel: any = {
      findOne: async ({ where }: any) =>
        subscriptions.find(
          (s) => s.user_id === where.user_id && s.status === 'active' && s.ends_at > new Date(),
        ) ?? null,
      count: async ({ where }: any) =>
        subscriptions.filter((s) => {
          // `user_id` arrives either as an id or as an Op.in list of them —
          // assertAccess asks about every owner of a tenant in one query.
          const ids = where.user_id?.[Op.in] ?? [where.user_id];
          if (!ids.includes(s.user_id)) return false;
          if (where.status && s.status !== where.status) return false;
          if (where.ends_at && !(s.ends_at > new Date())) return false;
          if (where.paid_at && s.paid_at == null) return false;
          return true;
        }).length,
    };
    const userModel: any = {
      findByPk: async (id: string) => users.find((u) => u.id === id) ?? null,
      findAll: async ({ where }: any) =>
        users.filter((u) => u.doctor_id === where.doctor_id && u.type === where.type),
    };
    const config: any = { get: () => 'https://mydigitalopd.test' };
    return new SubscriptionAccessService(subscriptionModel, userModel, config);
  };

  const tomorrow = new Date(Date.now() + 86_400_000);

  const refusal = async (user: any): Promise<AppException> => {
    try {
      await service().assertAccess(user);
    } catch (err) {
      return err as AppException;
    }
    throw new Error('expected the account to be refused');
  };

  beforeEach(() => {
    subscriptions = [];
    users = [];
  });

  it('lets the super admin through, plan or no plan', async () => {
    await expect(
      service().assertAccess({ id: 'sa', type: UserType.SUPER_ADMIN, doctor_id: null } as any),
    ).resolves.toBeUndefined();
  });

  it('refuses a doctor with no plan, whichever door the account came in through', async () => {
    users = [{ id: 'doc', type: UserType.DOCTOR, doctor_id: 'tenant', invited_by: null }];
    const err = await refusal(users[0]);
    expect(err.code).toBe(ErrorCode.SUBSCRIPTION_REQUIRED);
  });

  it('lets a doctor on a live plan through', async () => {
    users = [{ id: 'doc', type: UserType.DOCTOR, doctor_id: 'tenant' }];
    subscriptions = [{ user_id: 'doc', status: 'active', ends_at: tomorrow, paid_at: new Date() }];
    await expect(service().assertAccess(users[0] as any)).resolves.toBeUndefined();
  });

  it("refuses a clinic's staff when the doctor's plan has lapsed", async () => {
    users = [
      { id: 'doc', type: UserType.DOCTOR, doctor_id: 'tenant', invited_by: null },
      { id: 'staff', type: UserType.ADMIN, doctor_id: 'tenant' },
    ];
    subscriptions = [
      { user_id: 'doc', status: 'expired', ends_at: new Date(0), paid_at: new Date(0) },
    ];
    const err = await refusal(users[1]);
    expect(err.message).toContain('ask the doctor');
    // The plan is not theirs to buy, so they are never offered a checkout.
    expect(err.details).toBeUndefined();
  });

  it("lets a clinic's staff through on the doctor's live plan", async () => {
    users = [
      { id: 'doc', type: UserType.DOCTOR, doctor_id: 'tenant' },
      { id: 'staff', type: UserType.ADMIN, doctor_id: 'tenant' },
    ];
    subscriptions = [{ user_id: 'doc', status: 'active', ends_at: tomorrow, paid_at: new Date() }];
    await expect(service().assertAccess(users[1] as any)).resolves.toBeUndefined();
  });

  it('leaves an account belonging to no tenant alone', async () => {
    users = [{ id: 'ops', type: UserType.ADMIN, doctor_id: null }];
    await expect(service().assertAccess(users[0] as any)).resolves.toBeUndefined();
  });

  describe('what the refused doctor is told', () => {
    beforeEach(() => {
      users = [{ id: 'doc', type: UserType.DOCTOR, doctor_id: 'tenant', invited_by: null }];
    });

    it('says the plan ended when one was paid for and has run out', async () => {
      subscriptions = [
        { user_id: 'doc', status: 'expired', ends_at: new Date(0), paid_at: new Date(0) },
      ];
      const err = await refusal(users[0]);
      expect(err.message).toContain('subscription has ended');
    });

    it('says the payment did not complete when a checkout was abandoned', async () => {
      subscriptions = [{ user_id: 'doc', status: 'pending', ends_at: null, paid_at: null }];
      const err = await refusal(users[0]);
      expect(err.message).toContain('payment did not complete');
    });

    it('tells an account we opened that its plan is ours to map — and still offers one', async () => {
      users[0].invited_by = 'sa';
      const err = await refusal(users[0]);
      expect(err.message).toContain('contact the myDigitalOPD team');
      expect((err.details as any).canSubscribe).toBe(true);
    });

    it('offers a plan to a doctor who never had one', async () => {
      const err = await refusal(users[0]);
      expect(err.message).toContain('Choose a plan');
    });

    it('offers the checkout on every refusal a doctor can act on', async () => {
      const cases: any[][] = [
        [{ user_id: 'doc', status: 'expired', ends_at: new Date(0), paid_at: new Date(0) }],
        [{ user_id: 'doc', status: 'pending', ends_at: null, paid_at: null }],
        [],
      ];
      for (const rows of cases) {
        subscriptions = rows;
        const err = await refusal(users[0]);
        expect((err.details as any).canSubscribe).toBe(true);
        expect((err.details as any).planUrl).toContain('#pricing');
      }
    });
  });

  describe('isUnfinishedSignup — may a new sign-up take this email over?', () => {
    const signup = {
      id: 'd1',
      type: UserType.DOCTOR,
      doctor_id: null,
      invited_by: null,
      is_active: true,
    };

    it('yes for a pricing-page account whose payment failed', async () => {
      subscriptions = [{ user_id: 'd1', status: 'failed', paid_at: null }];
      await expect(service().isUnfinishedSignup(signup as any)).resolves.toBe(true);
    });

    it('no once the account has ever held a plan, even a lapsed one', async () => {
      subscriptions = [{ user_id: 'd1', status: 'active', paid_at: new Date(), ends_at: new Date(0) }];
      await expect(service().isUnfinishedSignup(signup as any)).resolves.toBe(false);
    });

    it('no for an account with a practice, an invite, or a deactivation', async () => {
      const s = service();
      await expect(s.isUnfinishedSignup({ ...signup, doctor_id: 'doc' } as any)).resolves.toBe(false);
      await expect(s.isUnfinishedSignup({ ...signup, invited_by: 'sa' } as any)).resolves.toBe(false);
      await expect(s.isUnfinishedSignup({ ...signup, is_active: false } as any)).resolves.toBe(false);
    });

    it('no for anything that is not a doctor account', async () => {
      await expect(
        service().isUnfinishedSignup({ ...signup, type: UserType.SUPER_ADMIN } as any),
      ).resolves.toBe(false);
    });
  });
});
