'use strict';

/**
 * Paid sign-up: a doctor picks a plan on the landing page, pays through
 * Cashfree, and only then may sign in.
 *
 *   users.subscription_required — true for accounts opened through the paid
 *     flow. Login and every authenticated request check that such an account
 *     (or the doctor a staff login belongs to) holds an active subscription.
 *     Doctors who were on the platform before plans existed keep the default
 *     `false` and are not gated; there is nothing to sell them retroactively.
 *
 *   subscriptions — one row per payment attempt. A row is `pending` from the
 *     moment the Cashfree order is created, `active` once the payment is
 *     confirmed (webhook, or the status poll re-checking the order), and
 *     `failed` / `expired` otherwise. `ends_at` is what the access check
 *     reads; a renewal is simply a newer row.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, UUIDV4, STRING, INTEGER, DECIMAL, DATE, BOOLEAN, TEXT } = Sequelize;

    await queryInterface.addColumn('users', 'subscription_required', {
      type: BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    await queryInterface.createTable('subscriptions', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      user_id: {
        type: UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      // Set once the doctor completes their profile and the tenant exists.
      doctor_id: {
        type: UUID,
        allowNull: true,
        references: { model: 'doctors', key: 'id' },
        onDelete: 'SET NULL',
      },
      plan_id: { type: STRING(20), allowNull: false },
      months: { type: INTEGER, allowNull: false },
      base_amount: { type: DECIMAL(10, 2), allowNull: false },
      gst_rate: { type: DECIMAL(5, 2), allowNull: false },
      gst_amount: { type: DECIMAL(10, 2), allowNull: false },
      total_amount: { type: DECIMAL(10, 2), allowNull: false },
      currency: { type: STRING(3), allowNull: false, defaultValue: 'INR' },
      status: { type: STRING(20), allowNull: false, defaultValue: 'pending' },
      cf_order_id: { type: STRING(64), allowNull: false, unique: true },
      cf_payment_id: { type: STRING(64), allowNull: true },
      payment_session_id: { type: TEXT, allowNull: true },
      starts_at: { type: DATE, allowNull: true },
      ends_at: { type: DATE, allowNull: true },
      paid_at: { type: DATE, allowNull: true },
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    });
    await queryInterface.addIndex('subscriptions', ['user_id', 'status'], {
      name: 'subscriptions_user_status_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('subscriptions');
    await queryInterface.removeColumn('users', 'subscription_required');
  },
};
