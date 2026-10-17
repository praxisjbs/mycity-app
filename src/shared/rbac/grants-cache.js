"use strict";
/**
 * The reads every authenticated request makes, cached for 30 seconds in Redis:
 * who the caller is, what their roles grant, who is in their team, which fields
 * are masked from them.
 *
 * The grant model (BACKEND_STRUCTURE §2, SYSTEM_ARCHITECTURE §8):
 *
 *   module  →  action (view create edit delete approve export)  →  scope (all team own)  →  field
 *
 * Rules:
 *  - Redis is a cache, never the record. Any Redis failure falls through to the
 *    database; a cached value that will not parse is recomputed.
 *  - Short TTLs plus explicit invalidation: a role or grant change calls
 *    invalidateGrants(); deactivating a user calls invalidateUser(); a reporting
 *    line change calls bumpTeamVersion(), which orphans every cached team at once
 *    (one INCR instead of a SCAN over every manager).
 *
 * Tables and columns read (migrations 0010, 0020, 0040; this is their contract):
 *   app_user        user_id, employee_id, email, status ('active' | 'suspended' | 'left'), is_ceo
 *   employee        employee_id, first_name, last_name, line_manager_id
 *   user_role       user_id, role_id
 *   role            role_id, code
 *   permission      role_id, module_key, can_view, can_create, can_edit, can_delete,
 *                   can_approve, can_export, scope ('all' | 'team' | 'own')
 *   field_visibility role_id, field_key, visibility ('visible' | 'masked')
 *   capability      capability_id, code
 *   user_capability user_id, capability_id, expires_at
 *   role_capability role_id, capability_id (migration 0400)
 */
const { tryClient, rkey } = require("../../config/redis");

const TTL_S = 30;
const TEAM_TTL_S = 60;

const keys = {
  auth: (userId) => rkey("idc", "auth", userId),
  grants: (roleIds, moduleKey) =>
    rkey("idc", "grants", moduleKey, [...new Set(roleIds)].sort().join(",")),
  masked: (userId) => rkey("idc", "grants", "masked", userId),
  caps: (userId) => rkey("idc", "caps", userId),
  teamVersion: () => rkey("idc", "team", "version"),
  team: (version, employeeId) => rkey("idc", "team", version, employeeId),
};

async function cached(key, ttl, load) {
  const redis = tryClient();
  if (redis) {
    const hit = await redis.get(key).catch(() => null);
    if (hit) {
      try {
        return JSON.parse(hit);
      } catch {
        /* a cache entry that will not parse is recomputed below */
      }
    }
  }
  const value = await load();
  if (redis && value !== undefined)
    await redis.set(key, JSON.stringify(value), "EX", ttl).catch(() => {});
  return value;
}

/**
 * The caller as auth needs them, or null when there is no such user.
 * @returns {Promise<{user_id, employee_id, email, display_name, status, is_ceo, role_ids: string[]}|null>}
 */
function getAuthUser(client, userId) {
  if (!userId) return Promise.resolve(null);
  return cached(keys.auth(userId), TTL_S, async () => {
    const { rows } = await client.query(
      `SELECT u.user_id,
              u.employee_id,
              u.email,
              u.status,
              u.is_ceo,
              trim(e.first_name || ' ' || e.last_name) AS display_name,
              COALESCE(array_agg(ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL), '{}') AS role_ids
         FROM app_user u
         JOIN employee e ON e.employee_id = u.employee_id
         LEFT JOIN user_role ur ON ur.user_id = u.user_id
        WHERE u.user_id = $1
        GROUP BY u.user_id, e.employee_id`,
      [userId],
    );
    return rows[0] || null;
  });
}

/**
 * Permission rows the caller's roles hold on one module.
 * @returns {Promise<Array<{can_view, can_create, can_edit, can_delete, can_approve, can_export, scope}>>}
 */
function getGrants(client, { role_ids: roleIds, module: moduleKey }) {
  if (!roleIds || roleIds.length === 0) return Promise.resolve([]);
  return cached(keys.grants(roleIds, moduleKey), TTL_S, async () => {
    const { rows } = await client.query(
      `SELECT can_view, can_create, can_edit, can_delete, can_approve, can_export, scope
         FROM permission
        WHERE role_id = ANY($1::uuid[]) AND module_key = $2`,
      [roleIds, moduleKey],
    );
    return rows;
  });
}

async function teamVersion() {
  const redis = tryClient();
  if (!redis) return "0";
  return (await redis.get(keys.teamVersion()).catch(() => null)) || "0";
}

/**
 * The employee and everyone who reports to them, at any depth, through
 * employee.line_manager_id. Depth-capped so a cycle in bad data cannot spin.
 * @returns {Promise<string[]>} employee ids, the employee's own first
 */
async function getTeamEmployeeIds(client, employeeId) {
  if (!employeeId) return [];
  const version = await teamVersion();
  return cached(keys.team(version, employeeId), TEAM_TTL_S, async () => {
    const { rows } = await client.query(
      `WITH RECURSIVE team AS (
         SELECT employee_id, 0 AS depth FROM employee WHERE employee_id = $1
         UNION
         SELECT e.employee_id, team.depth + 1
           FROM employee e
           JOIN team ON e.line_manager_id = team.employee_id
          WHERE team.depth < 20
       )
       SELECT employee_id FROM team ORDER BY depth, employee_id`,
      [employeeId],
    );
    return rows.map((r) => r.employee_id);
  });
}

/**
 * Field keys masked from this user ("employee.bank"). Roles add up, as grants do: a
 * field is masked when every role of theirs that says anything about it masks it, so
 * one role that shows it shows it. A role with no row for a field says nothing.
 */
function getMaskedFieldKeys(client, userId) {
  if (!userId) return Promise.resolve([]);
  return cached(keys.masked(userId), TTL_S, async () => {
    const { rows } = await client.query(
      `SELECT fv.field_key
         FROM field_visibility fv
         JOIN user_role ur ON ur.role_id = fv.role_id
        WHERE ur.user_id = $1
          AND (ur.effective_to IS NULL OR ur.effective_to > CURRENT_DATE)
        GROUP BY fv.field_key
       HAVING bool_and(fv.visibility = 'masked')
        ORDER BY fv.field_key`,
      [userId],
    );
    return rows.map((r) => r.field_key);
  });
}

/**
 * Capability codes the user holds: given to them directly (segregation of duties, e.g.
 * "disburser"), or held by one of their roles ("announcements.post").
 */
function getCapabilities(client, userId) {
  if (!userId) return Promise.resolve([]);
  return cached(keys.caps(userId), TTL_S, async () => {
    const { rows } = await client.query(
      `SELECT c.code::text AS code
         FROM user_capability uc
         JOIN capability c ON c.capability_id = uc.capability_id
        WHERE uc.user_id = $1 AND (uc.expires_at IS NULL OR uc.expires_at > now())
       UNION
       SELECT c.code::text
         FROM role_capability rc
         JOIN user_role ur ON ur.role_id = rc.role_id
         JOIN capability c ON c.capability_id = rc.capability_id
        WHERE ur.user_id = $1
          AND (ur.effective_to IS NULL OR ur.effective_to > CURRENT_DATE)
        ORDER BY 1`,
      [userId],
    );
    return rows.map((r) => r.code);
  });
}

async function scanDelete(redis, pattern) {
  let cursor = "0";
  do {
    const res = await redis
      .scan(cursor, "MATCH", pattern, "COUNT", 500)
      .catch(() => null);
    if (!res) return;
    const [next, found] = res;
    cursor = next;
    for (let i = 0; i < found.length; i += 200) {
      await redis.del(...found.slice(i, i + 200)).catch(() => {});
    }
  } while (cursor !== "0");
}

/** After a user's status, roles, capabilities or employee link change. */
async function invalidateUser(userId) {
  const redis = tryClient();
  if (redis)
    await redis
      .del(keys.auth(userId), keys.caps(userId), keys.masked(userId))
      .catch(() => {});
}

/** After any role, grant, field-visibility or role capability change. */
async function invalidateGrants() {
  const redis = tryClient();
  if (!redis) return;
  await scanDelete(redis, rkey("idc", "grants", "*"));
  await scanDelete(redis, rkey("idc", "caps", "*"));
}

/** After any reporting line change (event employee.reporting_line_changed). */
async function bumpTeamVersion() {
  const redis = tryClient();
  if (redis) await redis.incr(keys.teamVersion()).catch(() => {});
}

module.exports = {
  getAuthUser,
  getGrants,
  getTeamEmployeeIds,
  getMaskedFieldKeys,
  getCapabilities,
  invalidateUser,
  invalidateGrants,
  bumpTeamVersion,
  TTL_S,
};
