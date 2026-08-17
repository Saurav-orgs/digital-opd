'use strict';

const bcrypt = require('bcrypt');
const { randomUUID } = require('crypto');

const MODULES = [
  'users',
  'roles',
  'doctors',
  'opd_schedules',
  'appointments',
  'dashboard',
];
const ACTIONS = ['create', 'read', 'update', 'delete'];

/**
 * Seeds the full permission catalog, a protected SuperAdmin role, and the
 * SuperAdmin login (credentials from env). Idempotent — safe to re-run.
 */
module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const now = new Date();

    // ── 1. Permissions (module × action) ─────────────────────
    const [existingPerms] = await sequelize.query(
      'SELECT id, module, action FROM permissions;',
    );
    const permKey = (m, a) => `${m}:${a}`;
    const existingSet = new Set(existingPerms.map((p) => permKey(p.module, p.action)));
    const permIdByKey = new Map(
      existingPerms.map((p) => [permKey(p.module, p.action), p.id]),
    );

    const toInsert = [];
    for (const module of MODULES) {
      for (const action of ACTIONS) {
        if (!existingSet.has(permKey(module, action))) {
          const id = randomUUID();
          permIdByKey.set(permKey(module, action), id);
          toInsert.push({
            id,
            module,
            action,
            created_at: now,
            updated_at: now,
          });
        }
      }
    }
    if (toInsert.length) {
      await queryInterface.bulkInsert('permissions', toInsert);
    }

    // ── 2. SuperAdmin role (is_system) ───────────────────────
    const [roleRows] = await sequelize.query(
      "SELECT id FROM roles WHERE name = 'SuperAdmin' LIMIT 1;",
    );
    let roleId = roleRows[0]?.id;
    if (!roleId) {
      roleId = randomUUID();
      await queryInterface.bulkInsert('roles', [
        {
          id: roleId,
          name: 'SuperAdmin',
          description: 'Full access. Cannot be modified or deleted.',
          is_system: true,
          created_at: now,
          updated_at: now,
        },
      ]);
    }

    // Grant every permission to SuperAdmin.
    const [linked] = await sequelize.query(
      'SELECT permission_id FROM role_permissions WHERE role_id = :roleId;',
      { replacements: { roleId } },
    );
    const linkedSet = new Set(linked.map((r) => r.permission_id));
    const links = [];
    for (const id of permIdByKey.values()) {
      if (!linkedSet.has(id)) links.push({ role_id: roleId, permission_id: id });
    }
    if (links.length) {
      await queryInterface.bulkInsert('role_permissions', links);
    }

    // ── 3. SuperAdmin user ───────────────────────────────────
    const email = (process.env.SUPERADMIN_EMAIL || 'superadmin@opd.local').toLowerCase();
    const [userRows] = await sequelize.query(
      'SELECT id FROM users WHERE email = :email LIMIT 1;',
      { replacements: { email } },
    );
    if (!userRows[0]) {
      const password = process.env.SUPERADMIN_PASSWORD || 'change-me';
      const password_hash = await bcrypt.hash(password, 10);
      await queryInterface.bulkInsert('users', [
        {
          id: randomUUID(),
          name: process.env.SUPERADMIN_NAME || 'Super Admin',
          email,
          password_hash,
          type: 'super_admin',
          role_id: roleId,
          doctor_id: null,
          is_active: true,
          created_at: now,
          updated_at: now,
        },
      ]);
    }
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const email = (process.env.SUPERADMIN_EMAIL || 'superadmin@opd.local').toLowerCase();
    await sequelize.query('DELETE FROM users WHERE email = :email;', {
      replacements: { email },
    });
    await sequelize.query(
      "DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE name = 'SuperAdmin');",
    );
    await sequelize.query("DELETE FROM roles WHERE name = 'SuperAdmin';");
    await queryInterface.bulkDelete('permissions', null, {});
  },
};
