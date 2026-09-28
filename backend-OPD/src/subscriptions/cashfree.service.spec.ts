import { CashfreeService } from './cashfree.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

/**
 * A 504 from Cashfree's edge used to reach the doctor as "the payment gateway
 * rejected the request", which sent them looking for a fault in their card or
 * their details when the gateway had simply timed out. Telling those two
 * apart is what this covers, along with the key/environment pairing that
 * decides whether a payment is real money at all.
 */
describe('CashfreeService', () => {
  const service = (over: Partial<Record<string, string>> = {}) =>
    new CashfreeService({
      get: () => ({
        appId: 'app',
        secretKey: 'cfsk_ma_test_x',
        env: 'sandbox',
        apiVersion: '2023-08-01',
        notifyUrl: 'https://example.test/payment/webhook',
        ...over,
      }),
    } as any);

  const reply = (status: number, body: string) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: status < 400,
      status,
      text: async () => body,
    }) as any;
  };

  const thrownBy = async (fn: () => Promise<unknown>): Promise<AppException> => {
    try {
      await fn();
    } catch (err) {
      return err as AppException;
    }
    throw new Error('expected the call to throw');
  };

  const order = () =>
    service().createOrder({
      orderId: 'sub_1',
      amount: 2358.82,
      customer: { id: 'u1', email: 'doctor@example.test', phone: '9876543210' },
      returnUrl: 'https://example.test/done?order_id={order_id}',
    });

  afterEach(() => jest.restoreAllMocks());

  it('treats a gateway 504 as "try again", not as a rejection', async () => {
    reply(504, '<html><title>504 Gateway Time-out</title></html>');
    const err = await thrownBy(order);
    expect(err.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(err.getResponse()).toMatchObject({
      message: expect.stringContaining('Nothing was charged'),
    });
  });

  it('quotes Cashfree back when it genuinely refuses the request', async () => {
    reply(400, JSON.stringify({ message: 'order_amount is invalid' }));
    const err = await thrownBy(order);
    expect(err.code).toBe(ErrorCode.BAD_REQUEST);
    expect(err.getResponse()).toMatchObject({ message: 'order_amount is invalid' });
  });

  it('warns when the environment and the key disagree', () => {
    const spy = jest.spyOn(require('@nestjs/common').Logger.prototype, 'error');
    service({ env: 'production', secretKey: 'cfsk_ma_test_x' });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('production'));
  });

  it('says nothing when they agree', () => {
    const spy = jest.spyOn(require('@nestjs/common').Logger.prototype, 'error');
    service({ env: 'production', secretKey: 'cfsk_ma_prod_x' });
    expect(spy).not.toHaveBeenCalled();
  });
});
