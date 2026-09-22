'use strict';

const { randomUUID } = require('crypto');

/**
 * Plans become data, and every payment step becomes a record.
 *
 *   plans — the price list the super admin edits. It used to be a hardcoded
 *     constant, which meant a price change was a deploy. `code` is the
 *     stable identifier the landing page and old subscriptions refer to;
 *     `is_active` hides a plan from the public list without deleting it,
 *     because a plan somebody is still paying for must not disappear.
 *
 *   subscriptions.plan_ref — the plan row a subscription was bought from, for
 *     joins and reporting. The existing `plan_id` / `months` / amount columns
 *     stay as they are: they are the snapshot of what was actually sold, and
 *     editing a plan must never rewrite an invoice that has been paid.
 *     `granted_by` / `grant_note` mark a subscription an admin gave out
 *     rather than one that was paid for online.
 *
 *   payment_events — the audit trail. Every webhook Cashfree sends (including
 *     ones with a bad signature, or for an order we do not know: those are
 *     exactly the ones worth seeing), every status poll that changed
 *     something, and every manual grant or cancellation. Append-only; the raw
 *     payload is kept so a dispute can be answered from our own records.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, UUIDV4, STRING, INTEGER, DECIMAL, DATE, BOOLEAN, TEXT, JSONB } = Sequelize;

    await queryInterface.createTable('plans', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      code: { type: STRING(30), allowNull: false, unique: true },
      name: { type: STRING(60), allowNull: false },
      tagline: { type: STRING(160), allowNull: true },
      /** Rupees per month, before GST. */
      monthly_amount: { type: DECIMAL(10, 2), allowNull: false },
      /** Billing cycle length. The amount charged is monthly_amount * months. */
      months: { type: INTEGER, allowNull: false },
      is_active: { type: BOOLEAN, allowNull: false, defaultValue: true },
      /** The one the pricing page highlights. At most one, enforced in the service. */
      is_recommended: { type: BOOLEAN, allowNull: false, defaultValue: false },
      sort_order: { type: INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      deleted_at: { type: DATE, allowNull: true },
    });

    await queryInterface.addColumn('subscriptions', 'plan_ref', {
      type: UUID,
      allowNull: true,
      references: { model: 'plans', key: 'id' },
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('subscriptions', 'granted_by', {
      type: UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('subscriptions', 'grant_note', {
      type: TEXT,
      allowNull: true,
    });

    await queryInterface.createTable('payment_events', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      // Nullable on purpose: a webhook for an order we have never heard of is
      // still worth recording, and is the loudest possible sign of a
      // misconfigured dashboard.
      subscription_id: {
        type: UUID,
        allowNull: true,
        references: { model: 'subscriptions', key: 'id' },
        onDelete: 'SET NULL',
      },
      user_id: {
        type: UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      doctor_id: {
        type: UUID,
        allowNull: true,
        references: { model: 'doctors', key: 'id' },
        onDelete: 'SET NULL',
      },
      /** 'webhook' | 'poll' | 'admin' | 'system' — who or what produced this row. */
      source: { type: STRING(20), allowNull: false },
      /** Cashfree's own event name, or ours for a manual action. */
      event_type: { type: STRING(60), allowNull: false },
      /** Where the subscription stood after this event. */
      status: { type: STRING(20), allowNull: true },
      cf_order_id: { type: STRING(64), allowNull: true },
      cf_payment_id: { type: STRING(64), allowNull: true },
      amount: { type: DECIMAL(10, 2), allowNull: true },
      /** False for a webhook whose HMAC did not match — it is kept, not acted on. */
      signature_valid: { type: BOOLEAN, allowNull: true },
      /** True when this event is what actually moved the subscription. */
      applied: { type: BOOLEAN, allowNull: false, defaultValue: false },
      /** One readable line for the log screen. */
      message: { type: TEXT, allowNull: true },
      /** The webhook body as received, so a dispute can be answered from our records. */
      payload: { type: JSONB, allowNull: true },
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    });
    await queryInterface.addIndex('payment_events', ['created_at'], {
      name: 'payment_events_created_idx',
    });
    await queryInterface.addIndex('payment_events', ['cf_order_id'], {
      name: 'payment_events_order_idx',
    });
    await queryInterface.addIndex('payment_events', ['doctor_id'], {
      name: 'payment_events_doctor_idx',
    });

    // Seed the three plans that were hardcoded, so nothing changes for a
    // deployment that is already selling them. The ids are generated here:
    // `defaultValue: UUIDV4` is applied by Sequelize on a model create, not
    // by the column, so a bulkInsert has to supply its own.
    const now = new Date();
    await queryInterface.bulkInsert('plans', [
      {
        id: randomUUID(),
        code: 'monthly',
        name: 'Monthly',
        tagline: 'Try it with no long commitment.',
        monthly_amount: 1999,
        months: 1,
        is_active: true,
        is_recommended: false,
        sort_order: 1,
        created_at: now,
        updated_at: now,
      },
      {
        id: randomUUID(),
        code: 'quarterly',
        name: 'Quarterly',
        tagline: 'A season of OPD at a lower rate.',
        monthly_amount: 1799,
        months: 3,
        is_active: true,
        is_recommended: true,
        sort_order: 2,
        created_at: now,
        updated_at: now,
      },
      {
        id: randomUUID(),
        code: 'yearly',
        name: 'Yearly',
        tagline: 'Best rate for an established practice.',
        monthly_amount: 1699,
        months: 12,
        is_active: true,
        is_recommended: false,
        sort_order: 3,
        created_at: now,
        updated_at: now,
      },
    ]);

    // Point the subscriptions that already exist at their plan row.
    await queryInterface.sequelize.query(
      'UPDATE subscriptions s SET plan_ref = p.id FROM plans p WHERE p.code = s.plan_id',
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('payment_events');
    await queryInterface.removeColumn('subscriptions', 'grant_note');
    await queryInterface.removeColumn('subscriptions', 'granted_by');
    await queryInterface.removeColumn('subscriptions', 'plan_ref');
    await queryInterface.dropTable('plans');
  },
};
