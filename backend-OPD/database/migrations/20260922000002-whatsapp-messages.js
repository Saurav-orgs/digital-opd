'use strict';

/**
 * Every WhatsApp message this server sends, and what Meta said about it.
 *
 * One row per send. `status` starts at `queued`, becomes `accepted` (Meta
 * took it, gave us `wa_message_id`) or `error` (Meta refused — `error_code`
 * / `error_message` say why), and is then driven by the delivery webhook:
 * `sent` → `delivered` → `read`, or `failed`. `status_log` keeps every
 * update Meta sent, in order, with its raw payload, so a "why didn't the
 * patient get the code?" question can be answered from this table alone.
 *
 * `request` is the exact body sent to Meta with the OTP masked — the code
 * is a secret and never lands in the database in the clear.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, UUIDV4, STRING, INTEGER, TEXT, DATE, JSONB } = Sequelize;

    await queryInterface.createTable('whatsapp_messages', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      // What this message is: 'otp' today.
      kind: { type: STRING(32), allowNull: false },
      // Recipient in E.164 without the plus, as sent to Meta.
      to: { type: STRING(20), allowNull: false },
      template: { type: STRING, allowNull: true },
      language: { type: STRING(16), allowNull: true },
      // Meta's id for the message ("wamid.…"); how webhook statuses find the row.
      wa_message_id: { type: STRING, allowNull: true, unique: true },
      status: { type: STRING(16), allowNull: false, defaultValue: 'queued' },
      status_at: { type: DATE, allowNull: true },
      error_code: { type: INTEGER, allowNull: true },
      error_message: { type: TEXT, allowNull: true },
      request: { type: JSONB, allowNull: true },
      response: { type: JSONB, allowNull: true },
      status_log: { type: JSONB, allowNull: false, defaultValue: [] },
      // Free reference back to what triggered the send (the verification row id).
      reference: { type: STRING, allowNull: true },
      created_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    });
    await queryInterface.addIndex('whatsapp_messages', ['to'], {
      name: 'whatsapp_messages_to_idx',
    });
    await queryInterface.addIndex('whatsapp_messages', ['created_at'], {
      name: 'whatsapp_messages_created_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('whatsapp_messages');
  },
};
