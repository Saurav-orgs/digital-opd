import configuration from './configuration';

/**
 * The live keys sat in the environment under `CASHFREE_PROD_*` while the
 * server went on using the sandbox ones, so every payment was still a test
 * payment. Which keys go with which environment is asserted here because
 * getting it wrong is invisible until a doctor's real payment fails.
 */
describe('configuration — Cashfree credentials', () => {
  const saved = process.env;

  beforeEach(() => {
    process.env = {
      ...saved,
      CASHFREE_APP_ID: 'TESTappid',
      CASHFREE_SECRET_KEY: 'cfsk_ma_test_secret',
      CASHFREE_PROD_APP_ID: 'LIVEappid',
      CASHFREE_PROD_SECRET_KEY: 'cfsk_ma_prod_secret',
    };
  });
  afterAll(() => {
    process.env = saved;
  });

  it('uses the sandbox keys by default', () => {
    delete process.env.CASHFREE_ENV;
    expect(configuration().cashfree).toMatchObject({
      env: 'sandbox',
      appId: 'TESTappid',
      secretKey: 'cfsk_ma_test_secret',
    });
  });

  it('uses the live keys when CASHFREE_ENV=production', () => {
    process.env.CASHFREE_ENV = 'production';
    expect(configuration().cashfree).toMatchObject({
      env: 'production',
      appId: 'LIVEappid',
      secretKey: 'cfsk_ma_prod_secret',
    });
  });

  it('falls back to the unprefixed keys when no CASHFREE_PROD_* is set', () => {
    process.env.CASHFREE_ENV = 'production';
    delete process.env.CASHFREE_PROD_APP_ID;
    delete process.env.CASHFREE_PROD_SECRET_KEY;
    expect(configuration().cashfree).toMatchObject({
      env: 'production',
      appId: 'TESTappid',
    });
  });
});
