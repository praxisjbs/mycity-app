"use strict";
/**
 * May this caller do this, and over which records?
 *
 *   route(router, "get", "/", contract, requirePermission("people", "view"), controller.list);
 *
 * Four layers (SYSTEM_ARCHITECTURE §8):
 *
 *   1. module   one of the 15 keys in shared/access/access.catalog.js
 *   2. action   view create edit delete approve export   (`edit`, never `update`)
 *   3. scope    all | team | own, from the grant, widest wins across the caller's roles
 *   4. field    restricted fields masked in responses (shared/rbac/field-mask.js)
 *
 * After a pass:
 *
 *   req.scope       "all" | "team" | "own"
 *   req.scope_ids   null for all; employee ids for team (the caller first); [own employee id] for own
 *   req.permission  { key, action }
 *
 * The repo turns req.scope into SQL through shared/rbac/scope.js. A module that
 * is always own-scope (ess) is own whatever the grant says.
 *
 * The CEO (app_user.is_ceo) passes every check with scope all, by design.
 * Compared with `=== true`: the flag skips everything and must not be laxer than
 * the checks it skips.
 *
 * Grant model: one `permission` row per role and module, a boolean per action and one scope (grants-cache.js
 * documents the columns). requirePermission refuses an unknown key or action when
 * the route is DEFINED, so a typo fails at boot instead of denying everyone.
 */
const { pool } = require("../config/db");
const { logger } = require("../config/logger");
const { AppError } = require("../shared/errors");
const catalog = require("../shared/access/access.catalog");
const grantsCache = require("../shared/rbac/grants-cache");
const metrics = require("../shared/observability/metrics");

const COLUMN = Object.freeze({
  view: "can_view",
  create: "can_create",
  edit: "can_edit",
  delete: "can_delete",
  approve: "can_approve",
  export: "can_export",
});

function checkSpec(where, key, action) {
  if (!catalog.isModule(key)) {
    throw new Error(
      `${where}: "${key}" is not a permission key (shared/access/access.catalog.js)`,
    );
  }
  if (!catalog.isAction(action)) {
    throw new Error(
      `${where}: "${action}" is not an action; use one of ${catalog.ACTIONS.join(", ")}`,
    );
  }
}

function requireUser(req) {
  if (!req.user)
    throw new AppError("AUTH_REQUIRED", "Sign in to continue", 401);
}

/** Widest scope among the grant rows that allow `action`, or null when none does. */
function scopeFromGrants(rows, action) {
  let scope = null;
  for (const row of rows) {
    if (row[COLUMN[action]] === true)
      scope = catalog.widerScope(
        scope,
        catalog.isScope(row.scope) ? row.scope : "own",
      );
  }
  return scope;
}

async function idsFor(scope, user) {
  if (scope === "all") return null;
  if (!user.employee_id) return [];
  if (scope === "own") return [user.employee_id];
  return grantsCache.getTeamEmployeeIds(pool, user.employee_id);
}

async function settle(req, key, action, scope) {
  const effective = catalog.OWN_ONLY.has(key) ? "own" : scope;
  req.scope = effective;
  req.scope_ids = await idsFor(effective, req.user);
  req.permission = { key, action };
}

function deny(req, label, labels) {
  metrics.inc(
    "mycity_rbac_denials_total",
    labels,
    1,
    "Permission denials by module and action.",
  );
  logger.warn(
    { user_id: req.user.user_id, permission: label },
    "permission denied",
  );
  return new AppError(
    "PERMISSION_DENIED",
    "You do not have access to this",
    403,
  );
}

/**
 * @param {string} key     module key
 * @param {string} action  view | create | edit | delete | approve | export
 */
function requirePermission(key, action) {
  checkSpec("requirePermission", key, action);

  const mw = async function permissionCheck(req, _res, next) {
    requireUser(req);
    if (req.user.is_ceo === true) {
      await settle(req, key, action, "all");
      return next();
    }
    const rows = await grantsCache.getGrants(pool, {
      role_ids: req.user.role_ids,
      module: key,
    });
    const scope = scopeFromGrants(rows, action);
    if (!scope) throw deny(req, `${key}.${action}`, { module: key, action });
    await settle(req, key, action, scope);
    return next();
  };
  mw.permission = { key, action };
  return mw;
}

/**
 * Pass when the caller holds ANY of several grants. Only for routes where the
 * members are equal in power; OR-ing a weak grant with a strong one hands the
 * weak one the strong surface. The scope is the widest among the grants held.
 *
 * @param {Array<[string, string]>} specs  [[key, action], ...]
 */
function requireAnyPermission(specs) {
  if (!Array.isArray(specs) || specs.length === 0)
    throw new Error("requireAnyPermission: give [key, action] pairs");
  for (const [key, action] of specs)
    checkSpec("requireAnyPermission", key, action);

  const mw = async function anyPermissionCheck(req, _res, next) {
    requireUser(req);
    if (req.user.is_ceo === true) {
      await settle(req, specs[0][0], specs[0][1], "all");
      return next();
    }
    let best = null;
    let bestSpec = null;
    for (const [key, action] of specs) {
      const rows = await grantsCache.getGrants(pool, {
        role_ids: req.user.role_ids,
        module: key,
      });
      const scope = scopeFromGrants(rows, action);
      if (
        scope &&
        catalog.widerScope(best, scope) === scope &&
        scope !== best
      ) {
        best = scope;
        bestSpec = [key, action];
      }
    }
    if (!best)
      throw deny(req, specs.map(([k, a]) => `${k}.${a}`).join(" or "), {
        module: "any",
        action: "any",
      });
    await settle(req, bestSpec[0], bestSpec[1], best);
    return next();
  };
  mw.permission = { any: specs.map(([key, action]) => ({ key, action })) };
  return mw;
}

/**
 * Demand a capability held by the user directly, on top of the module grant
 * (segregation of duties: the person who approves a spend is not the one who
 * disburses it). Codes live in the `capability` table.
 * @param {string} code
 */
function requireCapability(code) {
  if (!code || typeof code !== "string")
    throw new Error("requireCapability: give a capability code");
  return async function capabilityCheck(req, _res, next) {
    requireUser(req);
    if (req.user.is_ceo === true) return next();
    const held = await grantsCache.getCapabilities(pool, req.user.user_id);
    if (!held.includes(code)) {
      throw new AppError(
        "CAPABILITY_REQUIRED",
        "This needs an authority you do not hold",
        403,
      );
    }
    return next();
  };
}

/** Only the CEO. */
function requireCeo() {
  return function ceoCheck(req, _res, next) {
    requireUser(req);
    if (req.user.is_ceo !== true)
      throw new AppError("PERMISSION_DENIED", "Only the CEO can do this", 403);
    return next();
  };
}

/**
 * Would the caller pass these checks? For shaping a screen (show a button or
 * not), NEVER for authorising: the destination route checks for itself.
 * @param {object} req
 * @param {Array<[string, string]>} specs
 * @returns {Promise<boolean[]>}
 */
async function readPermissions(req, specs) {
  if (!req || !req.user) return specs.map(() => false);
  if (req.user.is_ceo === true) return specs.map(() => true);
  try {
    const out = [];
    for (const [key, action] of specs) {
      if (!catalog.isModule(key) || !catalog.isAction(action)) {
        out.push(false);
        continue;
      }
      const rows = await grantsCache.getGrants(pool, {
        role_ids: req.user.role_ids,
        module: key,
      });
      out.push(Boolean(scopeFromGrants(rows, action)));
    }
    return out;
  } catch {
    return specs.map(() => false);
  }
}

/**
 * The same decision as requirePermission, for code that is not a route: the AI's
 * reads (shared/ai/authorise.js) and search (shared/search/search.service.js). One
 * answer to "may this person do this, and over which records", wherever it is asked.
 *
 * @param {{user_id: string, employee_id?: string, role_ids?: string[], is_ceo?: boolean}|null} user
 * @param {string} key     module key
 * @param {string} action  view | create | edit | delete | approve | export
 * @returns {Promise<{scope: string, scope_ids: string[]|null, employee_id: string|null}|null>}
 *   null when the user holds no such grant
 */
async function scopeFor(user, key, action) {
  checkSpec("scopeFor", key, action);
  if (!user || !user.user_id) return null;
  let scope = "all";
  if (user.is_ceo !== true) {
    const rows = await grantsCache.getGrants(pool, {
      role_ids: user.role_ids || [],
      module: key,
    });
    scope = scopeFromGrants(rows, action);
    if (!scope) return null;
  }
  const effective = catalog.OWN_ONLY.has(key) ? "own" : scope;
  return {
    scope: effective,
    scope_ids: await idsFor(effective, user),
    employee_id: user.employee_id || null,
  };
}

module.exports = {
  requirePermission,
  scopeFor,
  requireAnyPermission,
  requireCapability,
  requireCeo,
  readPermissions,
  scopeFromGrants,
  COLUMN,
};
