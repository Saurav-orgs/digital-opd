'use strict';

/**
 * Filing a report moves inside the appointment, and the `reports` permission
 * starts gating it there.
 *
 * `POST /reports/appointment/:id` was gated on `appointments:update`, with a
 * comment saying that was deliberate — it is part of running a consultation,
 * not of managing a reports screen. The standalone Upload reports page is now
 * out of the menu and the upload lives on the visit, so `reports` is the
 * permission that should decide who can do it. The role editor keeps the
 * module, which now gates something a doctor can actually see.
 *
 * Flipping the guard on its own would silently strip the ability from every
 * role holding `appointments:update` without `reports` — somebody's nurse
 * loses a button overnight with nothing to explain it. Counted on the
 * development database before writing this: 24 roles hold
 * `appointments:update`, 23 of them already hold `reports:create`, and one
 * ("Nurse", which has `reports:read` but not `reports:create`) would have
 * lost the upload. One role here; on a production database with more clinics
 * it is however many have built a role that way.
 *
 * So the guard flip ships with this grant: every role that can update an
 * appointment gains `reports:create` and `reports:read`. `read` as well as
 * `create`, because uploading a report you cannot then open is not a usable
 * permission — `GET /reports/:id/file` and the delete beside it are both on
 * the `reports` module already.
 */

/** The pairs every `appointments:update` role ends up holding. */
const GRANTS = [
  { module: 'reports', action: 'create' },
  { module: 'reports', action: 'read' },
];

module.exports = {
  async up(queryInterface) {
    for (const g of GRANTS) {
      // Idempotent on two counts: the insert selects only roles that do not
      // already hold the pair, and `role_permissions` has a composite primary
      // key, so a concurrent grant cannot duplicate a row either.
      await queryInterface.sequelize.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT r.id, target.id
           FROM roles r
           CROSS JOIN LATERAL (
                 SELECT p.id FROM permissions p
                  WHERE p.module = :module AND p.action = :action
                  LIMIT 1
           ) AS target
          WHERE EXISTS (
                SELECT 1 FROM role_permissions rp
                  JOIN permissions p2 ON p2.id = rp.permission_id
                 WHERE rp.role_id = r.id
                   AND p2.module = 'appointments'
                   AND p2.action = 'update'
          )
            AND NOT EXISTS (
                SELECT 1 FROM role_permissions have
                 WHERE have.role_id = r.id AND have.permission_id = target.id
          )`,
        { replacements: { module: g.module, action: g.action } },
      );
    }
  },

  async down() {
    /*
     * Deliberately a no-op.
     *
     * This migration cannot tell which roles already held `reports` before it
     * ran and which it granted, so a revert would have to take the permission
     * from every role that can update an appointment — including the ones
     * that were set up with it on purpose, years before this. Taking a
     * clinic's nurse off report uploads to undo a schema change is worse than
     * leaving a permission granted.
     *
     * Rolling the feature back means reverting the guard in
     * `reports.controller.ts`; the extra grants are then harmless, because
     * the route stops reading them.
     */
  },
};
