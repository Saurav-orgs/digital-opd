'use strict';

/**
 * What every AI call cost, against the appointment that caused it.
 *
 * The sidecar already knew these numbers — it wrote them to a JSONL file on
 * its own disk. That file is lost on redeploy, invisible to this service, and
 * keyed by consultation session, which is not the unit anybody bills or
 * budgets in. One appointment can carry a voice prescription AND several
 * report summaries AND a progress note; the question is always what the
 * appointment cost, not what one call did.
 *
 * So the sidecar now returns its usage with each response and this service
 * writes it down here.
 *
 * `appointment_id` is nullable on purpose. A report summarised before it is
 * attached to an appointment still costs money, and a row recording the spend
 * without the link is worth far more than no row at all. ON DELETE SET NULL
 * for the same reason: deleting an appointment must not erase the record that
 * money was spent.
 *
 * Both currencies are stored because the providers do not share one. Sarvam
 * prices speech in rupees per hour of audio; Gemini and Claude price tokens in
 * dollars per million. Converting either way at write time would freeze one
 * day's exchange rate into a permanent record.
 *
 * `appointments.ai_cost_*` is a running total kept for convenience — sortable
 * and summable without a join. This table is the source of truth; the total is
 * derived, and can be rebuilt from it at any time.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ai_usage_events', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      appointment_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'appointments', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      // The consultation this came from, when it was one. Lets a voice
      // prescription's chunks be told apart from the rest of the appointment.
      session_id: { type: Sequelize.UUID, allowNull: true },
      // The report this summarised, when it was one.
      report_id: { type: Sequelize.UUID, allowNull: true },

      // 'stt' | 'prescription' | 'report-summary' | 'report-summary-image'
      // | 'consolidate' | 'progress'
      route: { type: Sequelize.STRING(32), allowNull: false },
      // 'sarvam' | 'gemini' | 'claude' | 'ollama'
      provider: { type: Sequelize.STRING(16), allowNull: false },
      model: { type: Sequelize.STRING(64), allowNull: false, defaultValue: '' },

      // Speech is billed by audio length, per second. Null on a text call.
      audio_seconds: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      // Text is billed by tokens. Null on a speech call. Thinking tokens bill
      // at the OUTPUT rate, so they are kept apart but are never free.
      input_tokens: { type: Sequelize.INTEGER, allowNull: true },
      output_tokens: { type: Sequelize.INTEGER, allowNull: true },
      thinking_tokens: { type: Sequelize.INTEGER, allowNull: true },

      cost_inr: { type: Sequelize.DECIMAL(12, 6), allowNull: false, defaultValue: 0 },
      // What was actually billed. Zero on the Gemini free tier.
      cost_usd: { type: Sequelize.DECIMAL(14, 8), allowNull: false, defaultValue: 0 },
      // What a paid key WOULD charge — the number to plan with, because "free
      // today" is not an answer to "what does this cost to run".
      would_cost_usd: { type: Sequelize.DECIMAL(14, 8), allowNull: false, defaultValue: 0 },
      free_tier: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      elapsed_seconds: { type: Sequelize.DECIMAL(8, 3), allowNull: false, defaultValue: 0 },

      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    await queryInterface.addIndex('ai_usage_events', ['appointment_id']);
    await queryInterface.addIndex('ai_usage_events', ['created_at']);
    await queryInterface.addIndex('ai_usage_events', ['session_id']);

    // Running totals. NOT NULL with a default of 0 so every existing
    // appointment reads as "nothing spent" rather than "unknown" — none of
    // them have any recorded spend, which is exactly what 0 means here.
    // Same scale as ai_usage_events.cost_inr on purpose. A coarser column
    // here would round on every increment, so the total would sit a fraction
    // away from the sum of its own rows — and a billing figure that does not
    // add up invites doubt about the whole table.
    await queryInterface.addColumn('appointments', 'ai_cost_inr', {
      type: Sequelize.DECIMAL(12, 6),
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('appointments', 'ai_cost_usd', {
      type: Sequelize.DECIMAL(14, 8),
      allowNull: false,
      defaultValue: 0,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('appointments', 'ai_cost_usd');
    await queryInterface.removeColumn('appointments', 'ai_cost_inr');
    await queryInterface.dropTable('ai_usage_events');
  },
};
