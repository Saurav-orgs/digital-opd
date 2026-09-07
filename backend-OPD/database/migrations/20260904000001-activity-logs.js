'use strict';

/**
 * Permanent record of what people did — who acted, on what, and when.
 *
 * Written through `ActivityLogService`, which batches routine rows and writes
 * security- and medical-record events straight through. Rows are immutable:
 * there is no updated_at because nothing ever edits one.
 *
 * Kept forever by decision, which makes the indexes the whole design. Every
 * one below backs a query the read API actually issues; the table will become
 * the largest in the schema, and an unindexed scan over it would get slower
 * every week it exists.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, UUIDV4, STRING, TEXT, JSONB, DATE, literal } = Sequelize;

    await queryInterface.createTable('activity_logs', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true, allowNull: false },

      // ── who ──
      actor_type: { type: STRING(16), allowNull: false },
      // No foreign key on purpose. A log row must outlive the account that
      // made it — an FK would either block deleting a user or delete their
      // history with them, and losing the trail is the one thing this table
      // exists to prevent.
      actor_id: { type: UUID, allowNull: true },
      // Denormalised so a row still reads as a sentence years later, after
      // the name has changed or the account is gone.
      actor_label: { type: STRING(160), allowNull: false },

      // ── tenant ──
      // Which clinic this belongs to; null for platform-level acts by the
      // super admin. Also the scope filter for a doctor reading their own log.
      doctor_id: { type: UUID, allowNull: true },

      // ── what ──
      action: { type: STRING(64), allowNull: false },
      entity_type: { type: STRING(40), allowNull: true },
      // STRING, not UUID: most entities are UUIDs but not all of them are
      // (app_settings is keyed by name), and a log should never fail to write
      // because the thing it describes has an unusual key.
      entity_id: { type: STRING(80), allowNull: true },
      summary: { type: TEXT, allowNull: false },
      metadata: { type: JSONB, allowNull: true },

      // ── context ──
      ip: { type: STRING(64), allowNull: true },

      created_at: { type: DATE, allowNull: false, defaultValue: literal('NOW()') },
    });

    // One clinic's timeline, newest first — the default read.
    await queryInterface.addIndex('activity_logs', ['doctor_id', 'created_at'], {
      name: 'activity_logs_doctor_created_idx',
    });
    // "What has this person been doing?"
    await queryInterface.addIndex('activity_logs', ['actor_type', 'actor_id', 'created_at'], {
      name: 'activity_logs_actor_created_idx',
    });
    // "Show me every issued prescription."
    await queryInterface.addIndex('activity_logs', ['action', 'created_at'], {
      name: 'activity_logs_action_created_idx',
    });
    // "What happened to this appointment?"
    await queryInterface.addIndex('activity_logs', ['entity_type', 'entity_id'], {
      name: 'activity_logs_entity_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('activity_logs');
  },
};
