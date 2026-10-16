"use strict";
/**
 * Access: roles and who holds them. The one write path for a person's roles, so
 * the audit ledger records every change and the grant cache never serves a stale
 * answer for longer than the request that made it.
 *
 * Grants (what a role allows) are reference data in this milestone
 * (seeds/reference/0101); editing them is Settings · Roles & Permissions, M9.
 */
const { pool } = require("../../config/db");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const grantsCache = require("../../shared/rbac/grants-cache");
const repo = require("./access.repo");
const { EVENTS } = require("./access.events");

const findRoleByCode = (client, code) => repo.findRoleByCode(client, code);
const listRoles = (client) => repo.allRoles(client);
const countActiveUsersWithRole = (client, roleId) =>
  repo.countActiveUsersWithRole(client, roleId);
const roleCodesOf = (client, userId) => repo.roleCodesOf(client, userId);

/** GET /access/roles */
const rolePage = (query) => repo.rolePage(pool, query);

/**
 * Give a person one more role. Runs in the caller's transaction.
 * @param {import("pg").PoolClient} client
 * @param {{user_id: string, role_id: string}} input
 * @param {object} actor
 */
async function assignRole(client, { user_id, role_id }, actor) {
  const before = await repo.roleCodesOf(client, user_id);
  await repo.insertUserRole(client, {
    userId: user_id,
    roleId: role_id,
    grantedBy: actor && actor.user_id ? actor.user_id : null,
  });
  const after = await repo.roleCodesOf(client, user_id);
  if (after.join() !== before.join()) {
    await emit(client, {
      key: EVENTS.ACCESS_ROLES_SET,
      entity: { type: "app_user", id: user_id },
      actor,
      before: { roles: before },
      after: { roles: after },
      payload: { roles: after },
    });
  }
  await grantsCache.invalidateUser(user_id);
}

/**
 * Set exactly which roles a person holds. Runs in the caller's transaction.
 * @param {import("pg").PoolClient} client
 * @param {string} userId
 * @param {string[]} codes  at least one
 * @param {object} actor
 * @returns {Promise<string[]>} the codes held afterwards
 */
async function setRoles(client, userId, codes, actor) {
  const unique = [...new Set(codes)];
  const roles = [];
  for (const code of unique) {
    const role = await repo.findRoleByCode(client, code);
    if (!role)
      throw new AppError("ROLE_NOT_FOUND", `There is no role "${code}".`, 422, {
        role_codes: ["Unknown role"],
      });
    roles.push(role);
  }
  if (roles.length === 0)
    throw new AppError("ROLE_REQUIRED", "Pick at least one role.", 422, {
      role_codes: ["Pick a role"],
    });

  const before = await repo.roleCodesOf(client, userId);
  await repo.removeUserRolesExcept(client, userId, roles.map((r) => r.role_id));
  for (const role of roles) {
    await repo.insertUserRole(client, {
      userId,
      roleId: role.role_id,
      grantedBy: actor && actor.user_id ? actor.user_id : null,
    });
  }
  const after = await repo.roleCodesOf(client, userId);
  if (after.join() !== before.join()) {
    await emit(client, {
      key: EVENTS.ACCESS_ROLES_SET,
      entity: { type: "app_user", id: userId },
      actor,
      before: { roles: before },
      after: { roles: after },
      payload: { roles: after },
    });
  }
  await grantsCache.invalidateUser(userId);
  return after;
}

module.exports = {
  findRoleByCode,
  listRoles,
  countActiveUsersWithRole,
  roleCodesOf,
  rolePage,
  assignRole,
  setRoles,
};
