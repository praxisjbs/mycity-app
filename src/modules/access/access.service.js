"use strict";
/**
 * Access: roles, who holds them, and what each grants (MILESTONES §14, four layers:
 * module, action, record scope, field), with the capabilities a role holds beside
 * its grants. The one write path for all of it, so the audit ledger records every
 * change and the grants cache never serves a stale answer for longer than the
 * request that made it.
 *
 * Settings · Roles & Permissions saves a role whole: its name and Home, one grant
 * per module, which restricted fields it sees, which capabilities it holds. Each part
 * that changed is its own security event (role.updated, permission.changed,
 * field_visibility.changed, capability.changed), so the Audit Log says exactly what
 * moved. Built-in roles keep their names and cannot be deleted; a role somebody
 * holds cannot be deleted either. Nobody but the CEO can save a change that would
 * take away their own Settings edit: they would be locked out of the screen that
 * undoes it.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const catalog = require("../../shared/access/access.catalog");
const { FIELD_KEYS } = require("../../shared/rbac/field-mask");
const grantsCache = require("../../shared/rbac/grants-cache");
const repo = require("./access.repo");
const { EVENTS } = require("./access.events");

const COLUMNS = Object.freeze({
  view: "can_view",
  create: "can_create",
  edit: "can_edit",
  delete: "can_delete",
  approve: "can_approve",
  export: "can_export",
});
const FIELDS = FIELD_KEYS.map((f) => f.key);

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "Not found", 404);
const invalid = (message, fields) => new AppError("VALIDATION_FAILED", message, 422, fields);

const findRoleByCode = (client, code) => repo.findRoleByCode(client, code);
const listRoles = (client) => repo.allRoles(client);
const countActiveUsersWithRole = (client, roleId) =>
  repo.countActiveUsersWithRole(client, roleId);
const roleCodesOf = (client, userId) => repo.roleCodesOf(client, userId);

/** GET /access/roles */
const rolePage = (query) => repo.rolePage(pool, query);

/* ------------------------------------------------------------------ *
 * Reading roles
 * ------------------------------------------------------------------ */

/** A permission row as the wire carries it: the actions that are true. */
function grantOf(row) {
  return {
    module_key: row.module_key,
    scope: catalog.isScope(row.scope) ? row.scope : "own",
    actions: catalog.ACTIONS.filter((a) => row[COLUMNS[a]] === true),
  };
}

/** GET /settings/roles */
const roleRows = (query) => repo.roleRowPage(pool, query, [...catalog.OWN_ONLY]);

/** GET /settings/roles/:id */
async function roleDetail(roleId, db = pool) {
  const role = await repo.findRole(db, roleId);
  if (!role) throw notFound();
  const [grants, fields, capabilities] = await Promise.all([
    repo.grantsOf(db, roleId),
    repo.fieldsOf(db, roleId),
    repo.capabilitiesOf(db, roleId),
  ]);
  return {
    role_id: role.role_id,
    code: role.code,
    name: role.name,
    description: role.description,
    home_view: role.home_view,
    rank: role.rank,
    is_system: role.is_system,
    two_step_required: role.two_step_required,
    users: role.users,
    grants: grants.map(grantOf).filter((g) => g.actions.length > 0),
    // A field a role has no row for is not masked by it (field-mask.js), so it reads as visible.
    visible_fields: FIELDS.filter((key) => {
      const row = fields.find((f) => f.field_key === key);
      return !row || row.visibility === "visible";
    }),
    capabilities,
  };
}

/** GET /settings/roles/catalogue: what a role can be given. */
async function catalogue() {
  return {
    modules: catalog.MODULE_CATALOG.map((m) => ({
      key: m.key,
      label: m.label,
      area: m.area,
      description: m.description,
      own_only: catalog.OWN_ONLY.has(m.key),
    })),
    actions: [...catalog.ACTIONS],
    scopes: [...catalog.RECORD_SCOPES],
    fields: FIELD_KEYS.map((f) => ({ key: f.key, label: f.label })),
    capabilities: await repo.allCapabilities(pool),
  };
}

/** GET /settings/roles/matrix: every active role against every module. */
async function matrix() {
  const { roles, grants } = await repo.matrix(pool);
  const byCell = new Map(grants.map((g) => [`${g.role_id}:${g.module_key}`, grantOf(g)]));
  return {
    roles: roles.map((r) => ({ role_id: r.role_id, code: r.code, name: r.name, is_system: r.is_system })),
    rows: catalog.MODULE_CATALOG.map((m) => ({
      module_key: m.key,
      label: m.label,
      cells: roles.map((r) => {
        const g = byCell.get(`${r.role_id}:${m.key}`);
        return g && g.actions.length
          ? { role_id: r.role_id, actions: g.actions, scope: g.scope }
          : { role_id: r.role_id, actions: [], scope: null };
      }),
    })),
  };
}

/* ------------------------------------------------------------------ *
 * Saving a role
 * ------------------------------------------------------------------ */

/** The permission rows a role's grants become, checked against the catalogue. */
function grantRows(grants) {
  const seen = new Set();
  const rows = [];
  for (const g of grants || []) {
    if (!catalog.isModule(g.module_key))
      throw invalid("A grant names a module that does not exist.", { grants: ["Unknown module"] });
    if (seen.has(g.module_key))
      throw invalid("A module is granted twice.", { grants: ["A module twice"] });
    seen.add(g.module_key);
    const actions = [...new Set(g.actions || [])];
    if (actions.length === 0) continue;
    if (!actions.includes("view"))
      throw invalid(`${catalog.MODULE_META[g.module_key].label}: every action needs view.`, {
        grants: ["Every action needs View"],
      });
    const row = {
      module_key: g.module_key,
      scope: catalog.OWN_ONLY.has(g.module_key) ? "own" : g.scope,
    };
    for (const a of catalog.ACTIONS) row[COLUMNS[a]] = actions.includes(a);
    rows.push(row);
  }
  if (rows.length === 0) throw invalid("Grant at least one module.", { grants: ["Grant a module"] });
  return rows.sort((a, b) => a.module_key.localeCompare(b.module_key));
}

/** Grants as the audit ledger shows them: module → "view, edit · team". */
const grantsText = (rows) =>
  Object.fromEntries(
    rows.map((r) => {
      const g = grantOf(r);
      return [g.module_key, `${g.actions.join(", ")} · ${g.scope}`];
    }),
  );

const fieldsText = (visible) =>
  Object.fromEntries(FIELDS.map((k) => [k, visible.includes(k) ? "visible" : "masked"]));

const capsText = (codes) => Object.fromEntries([...codes].sort().map((c) => [c, "held"]));

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A role's code, from its name: lower case words joined by "_", never one used before. */
async function codeFor(client, name) {
  let base = String(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  if (!/^[a-z]/.test(base)) base = `role_${base}`.slice(0, 40);
  if (base.length < 2) base = "role";
  for (let n = 1; n < 1000; n += 1) {
    const code = n === 1 ? base : `${base}_${n}`;
    if (!(await repo.codeTaken(client, code))) return code;
  }
  throw new AppError("ROLE_CODE_TAKEN", "Choose another name for this role.", 409);
}

/** Refuse a change that would leave the person saving it without Settings edit over everything. */
async function assertNoLockout(client, actor, roleId, nextSettingsRow) {
  if (!actor || !actor.user_id || actor.is_ceo === true) return;
  const held = await repo.roleIdsOf(client, actor.user_id);
  if (!held.includes(roleId)) return;
  const others = await repo.settingsGrantsOf(client, held.filter((id) => id !== roleId));
  const keeps = [...others, ...(nextSettingsRow ? [nextSettingsRow] : [])].some(
    (g) => g.can_edit === true && g.scope === "all",
  );
  if (!keeps)
    throw new AppError(
      "LOCKOUT",
      "This would take away your own access to Settings. Ask the CEO or another administrator.",
      422,
      { grants: ["You would lose Settings"] },
    );
}

/** Capability ids for codes, refusing a code that is not a capability. */
async function capabilityIds(client, codes) {
  const unique = [...new Set(codes || [])];
  const found = await repo.capabilitiesByCode(client, unique);
  if (found.length !== unique.length)
    throw invalid("A capability does not exist.", { capabilities: ["Unknown capability"] });
  return found;
}

async function checkName(client, name, exceptRoleId) {
  if (await repo.roleNamed(client, name, exceptRoleId))
    throw new AppError("ROLE_NAME_TAKEN", "Another role has this name.", 409, { name: ["Name already used"] });
}

/**
 * POST /settings/roles: a new role with its grants, fields and capabilities.
 * @param {object} body   RoleSave
 * @param {object} actor  req.user
 */
async function createRole(body, actor) {
  const rows = grantRows(body.grants);
  const visible = [...new Set(body.visible_fields || [])];
  const roleId = await tx(async (client) => {
    const caps = await capabilityIds(client, body.capabilities);
    await checkName(client, body.name, null);
    const code = await codeFor(client, body.name);
    const created = await repo.insertRole(client, {
      code,
      name: body.name,
      description: body.description || null,
      homeView: body.home_view || "staff",
    });
    if (!created) throw new AppError("ROLE_CODE_TAKEN", "Choose another name for this role.", 409);
    const id = created.role_id;
    await repo.replaceGrants(client, id, rows);
    await repo.replaceFields(client, id, FIELDS, visible);
    await repo.replaceCapabilities(client, id, caps.map((c) => c.capability_id), actor.user_id || null);
    await emit(client, {
      key: EVENTS.ROLE_CREATED,
      entity: { type: "role", id },
      actor,
      after: {
        code,
        name: body.name,
        description: body.description || null,
        home_view: body.home_view || "staff",
        grants: grantsText(rows),
        fields: fieldsText(visible),
        capabilities: capsText(caps.map((c) => c.code)),
      },
      payload: { role_id: id, code },
    });
    return id;
  });
  await grantsCache.invalidateGrants();
  return roleDetail(roleId);
}

/**
 * PUT /settings/roles/:id: the role as it should be from now on.
 * @param {string} roleId
 * @param {object} body   RoleSave
 * @param {object} actor  req.user
 */
async function updateRole(roleId, body, actor) {
  const rows = grantRows(body.grants);
  const visible = [...new Set(body.visible_fields || [])];
  await tx(async (client) => {
    const role = await repo.findRole(client, roleId, { lock: true });
    if (!role) throw notFound();
    if (role.is_system && body.name !== role.name)
      throw invalid("A built-in role keeps its name.", { name: ["Built-in name stays"] });
    await checkName(client, body.name, roleId);
    const caps = await capabilityIds(client, body.capabilities);
    await assertNoLockout(client, actor, roleId, rows.find((r) => r.module_key === "settings") || null);

    const entity = { type: "role", id: roleId };
    const payload = { role_id: roleId, code: role.code };

    const head = { name: role.name, description: role.description, home_view: role.home_view };
    const nextHead = {
      name: body.name,
      description: body.description === undefined ? role.description : body.description || null,
      home_view: body.home_view || role.home_view,
    };
    if (!same(head, nextHead)) {
      await repo.updateRole(client, roleId, {
        name: nextHead.name,
        description: nextHead.description,
        homeView: nextHead.home_view,
      });
      await emit(client, { key: EVENTS.ROLE_UPDATED, entity, actor, before: head, after: nextHead, payload });
    }

    const before = grantsText(await repo.grantsOf(client, roleId));
    const after = grantsText(rows);
    if (!same(before, after)) {
      await repo.replaceGrants(client, roleId, rows);
      await emit(client, { key: EVENTS.PERMISSION_CHANGED, entity, actor, before, after, payload });
    }

    const fieldRows = await repo.fieldsOf(client, roleId);
    const fieldsBefore = Object.fromEntries(
      FIELDS.map((k) => {
        const row = fieldRows.find((f) => f.field_key === k);
        return [k, row ? row.visibility : "visible"];
      }),
    );
    const fieldsAfter = fieldsText(visible);
    if (!same(fieldsBefore, fieldsAfter) || fieldRows.length !== FIELDS.length) {
      await repo.replaceFields(client, roleId, FIELDS, visible);
      if (!same(fieldsBefore, fieldsAfter))
        await emit(client, {
          key: EVENTS.FIELD_VISIBILITY_CHANGED,
          entity,
          actor,
          before: fieldsBefore,
          after: fieldsAfter,
          payload,
        });
    }

    const capsBefore = capsText(await repo.capabilitiesOf(client, roleId));
    const capsAfter = capsText(caps.map((c) => c.code));
    if (!same(capsBefore, capsAfter)) {
      await repo.replaceCapabilities(client, roleId, caps.map((c) => c.capability_id), actor.user_id || null);
      await emit(client, {
        key: EVENTS.CAPABILITY_CHANGED,
        entity,
        actor,
        before: capsBefore,
        after: capsAfter,
        payload,
      });
    }
  });
  await grantsCache.invalidateGrants();
  return roleDetail(roleId);
}

/**
 * DELETE /settings/roles/:id: a role nobody holds, that the product did not ship with.
 * It is retired, not erased: its code is never given out again and the ledger keeps it.
 */
async function deleteRole(roleId, actor) {
  await tx(async (client) => {
    const role = await repo.findRole(client, roleId, { lock: true });
    if (!role) throw notFound();
    if (role.is_system)
      throw new AppError("SYSTEM_ROLE", "A built-in role cannot be deleted.", 409);
    const holders = await repo.countHolders(client, roleId);
    if (holders > 0)
      throw new AppError(
        "ROLE_IN_USE",
        `${holders} ${holders === 1 ? "person holds" : "people hold"} this role. Give them another role first.`,
        409,
      );
    await repo.retireRole(client, roleId);
    await emit(client, {
      key: EVENTS.ROLE_DELETED,
      entity: { type: "role", id: roleId },
      actor,
      before: {
        code: role.code,
        name: role.name,
        grants: grantsText(await repo.grantsOf(client, roleId)),
      },
      payload: { role_id: roleId, code: role.code },
    });
  });
  await grantsCache.invalidateGrants();
}

/* ------------------------------------------------------------------ *
 * Who holds which role
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * Two-step sign-in required by role (edited on Settings · Security)
 * ------------------------------------------------------------------ */

/** Must this person use two-step sign-in, because a role they hold requires it? */
const requiresTwoStep = (db, userId) => repo.requiresTwoStep(db, userId);

/** Every active role with its two-step rule and how many of its people have it on. */
const twoStepRoles = (db = pool) => repo.twoStepRoles(db);

/**
 * Make exactly these roles require two-step sign-in, in the caller's transaction
 * (settings.service records the change as one security event with the other rules).
 * @returns {Promise<{before: string[], after: string[]}>} role codes
 */
async function setTwoStepRoles(client, codes) {
  const unique = [...new Set(codes)];
  const roles = await repo.twoStepRoles(client);
  const known = new Set(roles.map((r) => r.code));
  const unknown = unique.find((c) => !known.has(c));
  if (unknown)
    throw invalid(`There is no role "${unknown}".`, { two_step_roles: ["Unknown role"] });
  const before = roles.filter((r) => r.two_step_required).map((r) => r.code).sort();
  await repo.setTwoStepRoles(client, unique);
  return { before, after: [...unique].sort() };
}

module.exports = {
  findRoleByCode,
  listRoles,
  countActiveUsersWithRole,
  roleCodesOf,
  rolePage,
  roleRows,
  roleDetail,
  catalogue,
  matrix,
  createRole,
  updateRole,
  deleteRole,
  assignRole,
  setRoles,
  requiresTwoStep,
  twoStepRoles,
  setTwoStepRoles,
  grantRows,
};
