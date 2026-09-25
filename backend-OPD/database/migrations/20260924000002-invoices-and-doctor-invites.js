'use strict';

/**
 * A paid subscription becomes a document, and an account can start from the
 * super admin's desk rather than from a payment.
 *
 *   invoices — one row per subscription that money was actually taken for.
 *     It is written once, at the moment the payment is confirmed, and never
 *     rewritten: the issuer's own details, the buyer's, the plan name and
 *     the tax split are all snapshotted into the row, because an invoice has
 *     to keep saying what it said on the day it was issued even after the
 *     company address changes or a plan is retired. The PDF is rendered from
 *     this row on demand rather than stored, so there is nothing to keep in
 *     sync and nothing to lose.
 *
 *     `fy` + `seq` are the numbering series behind `invoice_no` — India's
 *     financial year runs April to March and the series restarts with it, so
 *     the number is only unique within its year and the unique index says so.
 *
 *   users.invited_by — the super admin who opened this account. It is what
 *     tells the login screen apart: an account that signed up and has not
 *     paid is told to finish paying, while one an admin opened and never
 *     mapped a plan to is told to ask the platform for one. Without it both
 *     look identical — a gated account with no subscription row.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, UUIDV4, STRING, INTEGER, DECIMAL, DATE, JSONB } = Sequelize;

    await queryInterface.createTable('invoices', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      /** What the doctor quotes back at us: e.g. MDO/2026-27/0007. */
      invoice_no: { type: STRING(40), allowNull: false, unique: true },
      /** The financial year the number belongs to, as 2026-27. */
      fy: { type: STRING(9), allowNull: false },
      /** Position within that year's series, starting at 1. */
      seq: { type: INTEGER, allowNull: false },

      subscription_id: {
        type: UUID,
        allowNull: false,
        unique: true,
        references: { model: 'subscriptions', key: 'id' },
        onDelete: 'CASCADE',
      },
      user_id: {
        type: UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      doctor_id: {
        type: UUID,
        allowNull: true,
        references: { model: 'doctors', key: 'id' },
        onDelete: 'SET NULL',
      },

      issued_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },

      /** The line item, as sold. Copied, not joined: a retired plan still prints. */
      plan_code: { type: STRING(30), allowNull: false },
      plan_name: { type: STRING(60), allowNull: false },
      months: { type: INTEGER, allowNull: false },
      period_start: { type: DATE, allowNull: true },
      period_end: { type: DATE, allowNull: true },

      currency: { type: STRING(3), allowNull: false, defaultValue: 'INR' },
      base_amount: { type: DECIMAL(10, 2), allowNull: false },
      gst_rate: { type: DECIMAL(5, 2), allowNull: false },
      gst_amount: { type: DECIMAL(10, 2), allowNull: false },
      total_amount: { type: DECIMAL(10, 2), allowNull: false },

      cf_order_id: { type: STRING(60), allowNull: true },
      cf_payment_id: { type: STRING(60), allowNull: true },

      /** Who issued it — name, address, GSTIN, state — as it read that day. */
      issuer: { type: JSONB, allowNull: false, defaultValue: {} },
      /** Who it was issued to — name, email, mobile, GSTIN, place of supply. */
      buyer: { type: JSONB, allowNull: false, defaultValue: {} },

      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    });

    await queryInterface.addIndex('invoices', ['fy', 'seq'], {
      unique: true,
      name: 'invoices_fy_seq_unique',
    });
    await queryInterface.addIndex('invoices', ['user_id'], { name: 'invoices_user_idx' });
    await queryInterface.addIndex('invoices', ['issued_at'], { name: 'invoices_issued_at_idx' });

    await queryInterface.addColumn('users', 'invited_by', {
      type: UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'invited_by');
    await queryInterface.removeIndex('invoices', 'invoices_issued_at_idx');
    await queryInterface.removeIndex('invoices', 'invoices_user_idx');
    await queryInterface.removeIndex('invoices', 'invoices_fy_seq_unique');
    await queryInterface.dropTable('invoices');
  },
};
