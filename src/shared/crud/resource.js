"use strict";
/**
 * The plain parts of a module, built from one description, so a settings list or a
 * simple register is a few lines and still follows every rule: contract on every
 * route, permission on every route, 25 per page, record scope in SQL, one write path
 * through a transaction with emit(), restricted fields masked on the way out.
 *
 * A module still has its six files (BACKEND_STRUCTURE §8); for a simple resource each
 * is short:
 *
 *   // departments.repo.js
 *   module.exports = makeRepo({
 *     table: "department",
 *     pk: "department_id",
 *     columns: "department_id, name, code, head_employee_id, archived_at, created_at, updated_at",
 *     writable: ["name", "code", "head_employee_id"],
 *     search: ["name", "code"],                       // ?q= matches any, accent and case folded
 *     filters: { head_employee_id: "head_employee_id" },  // query key → column, equality
 *     sort: { name: "name", newest: "created_at DESC" },  // ?sort= names, never columns from input
 *     defaultSort: "name",
 *     archive: { column: "archived_at" },              // or { active: "is_active" }, or "hard"
 *     touch: "updated_at",
 *   });
 *
 *   // departments.service.js
 *   module.exports = makeService({
 *     repo, entity: "department",
 *     events: { created: EVENTS.DEPARTMENT_CREATED, updated: EVENTS.DEPARTMENT_UPDATED, archived: EVENTS.DEPARTMENT_ARCHIVED },
 *   });
 *
 *   // departments.controller.js
 *   module.exports = makeController(service, { label: "Department" });
 *
 *   // departments.routes.js
 *   const router = express.Router();
 *   mountResource(router, {
 *     controller, module: "settings",
 *     contract: {
 *       list:    { query: c.organisation.DepartmentListQuery, response: c.organisation.DepartmentPage },
 *       get:     { response: c.organisation.Department },
 *       create:  { body: c.organisation.DepartmentCreate, response: c.organisation.Department },
 *       update:  { body: c.organisation.DepartmentUpdate, response: c.organisation.Department },
 *       archive: { body: c.common.EmptyBody, response: c.organisation.Department },
 *     },
 *   });
 *   module.exports = router;
 *
 * A module needing more (a state machine, numbering with a business date, a
 * workflow) writes those functions itself, beside or instead of these. Nothing here
 * is a framework to bend; it is the rules, already applied.
 *
 * Record scope: `scope: { column: "employee_id" }` names the column saying whose
 * record a row is. Lists filter by req.scope (shared/rbac/scope.js); a get, edit or
 * archive outside scope is a 404. Leave `scope` out for module-wide records
 * (departments, categories), where the module grant alone decides.
 */
const { pool: defaultPool } = require("../../config/db");
const { AppError } = require("../errors");
const { atomically } = require("../db/tx");
const { ident, table: tableName, assertWritable, insertOne, updateOne, getById } = require("../db/query-helpers");
const { pageQuery, TOTAL_COL, sendPaged } = require("../http/paged");
const { ok, created } = require("../http/respond");
const { scopeOf, scopeClause } = require("../rbac/scope");
const { maskForUser } = require("../rbac/field-mask");
const { emit, withActor } = require("../events/emit");
const numbering = require("../numbering/numbering");
const { SCHEMES } = require("../numbering/schemes");

const SORT_RE = /^[a-z_][a-z0-9_]*(\s+(asc|desc))?(\s+nulls\s+(first|last))?(\s*,\s*[a-z_][a-z0-9_]*(\s+(asc|desc))?(\s+nulls\s+(first|last))?)*$/i;
const COLUMNS_RE = /^[a-z_][a-z0-9_]*(\s*,\s*[a-z_][a-z0-9_]*)*$/i;

function fail(msg) {
  throw new Error(`makeRepo: ${msg}`);
}

/* ------------------------------------------------------------------ *
 * Repo
 * ------------------------------------------------------------------ */

/**
 * @param {object} cfg
 * @param {string} cfg.table
 * @param {string} cfg.pk
 * @param {string} cfg.columns           the SELECT list, plain column names, comma separated
 * @param {string[]} cfg.writable        columns a request body may set
 * @param {string[]} [cfg.search]        columns ?q= matches (search_fold, contains)
 * @param {Record<string,string>} [cfg.filters]  query key → column, equality
 * @param {Record<string,string>} [cfg.sort]     sort name → ORDER BY fragment ("last_name, first_name")
 * @param {string} [cfg.defaultSort]     a key of cfg.sort
 * @param {{column: string}} [cfg.scope]  owner employee column for record scope
 * @param {{column: string}|{active: string}|"hard"} [cfg.archive]
 * @param {string} [cfg.touch]           timestamp column set on every update
 */
function makeRepo(cfg) {
  if (!cfg || !cfg.table || !cfg.pk) fail("table and pk are required");
  const table = tableName(cfg.table);
  const pk = ident(cfg.pk);
  if (!COLUMNS_RE.test(String(cfg.columns || ""))) fail(`${cfg.table}: columns is a comma-separated list of column names`);
  const columnList = cfg.columns.split(",").map((c) => c.trim());
  if (!columnList.includes(cfg.pk)) fail(`${cfg.table}: columns must include the primary key`);
  const columns = columnList.map((c) => ident(c)).join(", ");
  if (!Array.isArray(cfg.writable)) fail(`${cfg.table}: writable lists the columns a request may set ([] for none)`);
  const writable = new Set(cfg.writable);
  for (const c of writable) ident(c);
  const search = (cfg.search || []).map((c) => ident(c));
  const filters = Object.fromEntries(Object.entries(cfg.filters || {}).map(([k, c]) => [k, ident(c)]));
  const sorts = cfg.sort || {};
  for (const [name, frag] of Object.entries(sorts)) {
    if (!SORT_RE.test(frag)) fail(`${cfg.table}: sort "${name}" is column names with asc/desc only`);
  }
  const defaultSort = cfg.defaultSort || Object.keys(sorts)[0] || null;
  if (defaultSort && !sorts[defaultSort]) fail(`${cfg.table}: defaultSort "${defaultSort}" is not in sort`);
  const scope = cfg.scope ? { column: `t.${ident(cfg.scope.column)}`, raw: cfg.scope.column } : null;
  const archive = cfg.archive || null;
  if (archive && archive !== "hard" && !archive.column && !archive.active) fail(`${cfg.table}: archive is { column }, { active } or "hard"`);
  const touch = cfg.touch || null;

  function archivedFilter(q) {
    if (!archive || archive === "hard" || q.include_archived === true) return null;
    return archive.column ? `t.${ident(archive.column)} IS NULL` : `t.${ident(archive.active)} = true`;
  }

  return {
    cfg: Object.freeze({ ...cfg }),

    /** One page. `query` is the validated list query; `s` is scopeOf(req). */
    async list(client, query = {}, s = null) {
      const params = [];
      const where = [];
      const af = archivedFilter(query);
      if (af) where.push(af);
      for (const [key, col] of Object.entries(filters)) {
        if (query[key] !== undefined && query[key] !== null && query[key] !== "") {
          params.push(query[key]);
          where.push(`t.${col} = $${params.length}`);
        }
      }
      if (search.length && query.q) {
        params.push(query.q);
        const n = params.length;
        where.push(`(${search.map((c) => `search_fold(t.${c}::text) LIKE '%' || search_fold($${n}) || '%'`).join(" OR ")})`);
      }
      if (scope && s) {
        const sc = scopeClause(s, { column: scope.column }, params);
        if (sc.and) where.push(sc.and.replace(/^AND /, ""));
      }
      const sortKey = query.sort && sorts[query.sort] ? query.sort : defaultSort;
      if (query.sort && !sorts[query.sort]) {
        throw new AppError("INVALID_SORT", `Cannot sort by "${query.sort}"`, 422, { sort: ["is not a sort option here"] });
      }
      const order = sortKey ? `${sorts[sortKey].split(",").map((p) => `t.${p.trim()}`).join(", ")}, t.${pk}` : `t.${pk}`;
      const select = columnList.map((c) => `t.${ident(c)}`).join(", ");
      return pageQuery(
        client,
        `SELECT ${select}, ${TOTAL_COL} FROM ${table} t ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order}`,
        params,
        query,
      );
    },

    /** One row, or null (also null when outside the caller's scope). */
    async get(client, id, s = null, { forUpdate = false } = {}) {
      const row = await getById(client, cfg.table, cfg.pk, id, { columns, forUpdate });
      if (!row) return null;
      if (scope && s && s.scope !== "all") {
        const owner = row[scope.raw];
        if (!owner || !(s.scope_ids || []).includes(owner)) return null;
      }
      return row;
    },

    insert(client, data) {
      return insertOne(client, cfg.table, data, { writable, returning: columns });
    },

    /** System-set columns (number, created_by) on insert; never from a request body. */
    insertTrusted(client, data, trusted) {
      assertWritable(Object.keys(data), writable);
      return insertOne(client, cfg.table, { ...data, ...trusted }, { returning: columns });
    },

    update(client, id, patch) {
      return updateOne(client, cfg.table, cfg.pk, id, patch, { writable, returning: columns, touch });
    },

    /** Archive (soft) or delete (hard), per cfg.archive. Returns the row after, or null when deleted. */
    async archive(client, id) {
      if (!archive) throw new Error(`${cfg.table}: archive is not configured`);
      if (archive === "hard") {
        await client.query(`DELETE FROM ${table} WHERE ${pk} = $1`, [id]);
        return null;
      }
      const set = archive.column ? `${ident(archive.column)} = now()` : `${ident(archive.active)} = false`;
      const extra = touch ? `, ${ident(touch)} = now()` : "";
      const { rows } = await client.query(`UPDATE ${table} SET ${set}${extra} WHERE ${pk} = $1 RETURNING ${columns}`, [id]);
      return rows[0] || null;
    },
  };
}

/* ------------------------------------------------------------------ *
 * Service
 * ------------------------------------------------------------------ */

/**
 * @param {object} opts
 * @param {object} opts.repo      from makeRepo
 * @param {string} opts.entity    snake_case entity type for events and links
 * @param {{created?: string, updated?: string, archived?: string}} opts.events  declared event keys
 * @param {{docType: string, column?: string}} [opts.numbering]  a number on create (column default "number")
 * @param {(data, ctx) => Promise<object>|object} [opts.beforeCreate]  validate or derive; returns the data
 * @param {(patch, before, ctx) => Promise<object>|object} [opts.beforeUpdate]
 * @param {{connect: Function}} [opts.db]  the pool (tests pass their own)
 */
function makeService(opts) {
  const { repo, entity, events = {}, beforeCreate = null, beforeUpdate = null } = opts;
  if (!repo || !repo.cfg) throw new Error("makeService: give the repo from makeRepo");
  if (!/^[a-z][a-z0-9_]*$/.test(String(entity))) throw new Error("makeService: entity is snake_case");
  const db = opts.db || defaultPool;
  const pk = repo.cfg.pk;
  const numberCol = opts.numbering ? opts.numbering.column || "number" : null;
  if (opts.numbering && !SCHEMES[opts.numbering.docType]) {
    throw new Error(`makeService(${entity}): docType "${opts.numbering.docType}" is not in shared/numbering/schemes.js`);
  }

  async function tx(fn) {
    const client = await db.connect();
    try {
      return await atomically(client, () => fn(client));
    } finally {
      client.release();
    }
  }

  const ref = (row) => ({ type: entity, id: row[pk] });

  return {
    repo,
    entity,

    list(query, s) {
      return repo.list(db, query, s);
    },

    async get(id, s) {
      const row = await repo.get(db, id, s);
      if (!row) throw new AppError("NOT_FOUND", "Not found", 404);
      return row;
    },

    create(data, actor) {
      return tx(async (client) => {
        const input = beforeCreate ? await beforeCreate(data, { client, actor }) : data;
        const trusted = {};
        if (numberCol) trusted[numberCol] = (await numbering.allocate(client, opts.numbering.docType)).number;
        const row = Object.keys(trusted).length ? await repo.insertTrusted(client, input, trusted) : await repo.insert(client, input);
        if (events.created) await emit(client, { key: events.created, entity: ref(row), actor, after: row });
        return row;
      });
    },

    update(id, patch, actor, s) {
      return tx(async (client) => {
        const before = await repo.get(client, id, s, { forUpdate: true });
        if (!before) throw new AppError("NOT_FOUND", "Not found", 404);
        const input = beforeUpdate ? await beforeUpdate(patch, before, { client, actor }) : patch;
        const row = await repo.update(client, id, input);
        if (events.updated) await emit(client, { key: events.updated, entity: ref(before), actor, before, after: row });
        return row;
      });
    },

    archive(id, actor, s) {
      return tx(async (client) => {
        const before = await repo.get(client, id, s, { forUpdate: true });
        if (!before) throw new AppError("NOT_FOUND", "Not found", 404);
        const after = await repo.archive(client, id);
        if (events.archived) await emit(client, { key: events.archived, entity: ref(before), actor, before, after: after || undefined });
        return after;
      });
    },
  };
}

/* ------------------------------------------------------------------ *
 * Controller and routes
 * ------------------------------------------------------------------ */

/**
 * @param {object} service  from makeService
 * @param {{label?: string, mask?: boolean, db?: object}} [opts]
 *   mask  apply field masking to every read (default true)
 */
function makeController(service, { label = "Record", mask = true, db = defaultPool } = {}) {
  const shown = (req, data) => (mask ? maskForUser(db, req.user, data) : data);
  const notFound = (err) => {
    if (err && err.code === "NOT_FOUND") throw new AppError("NOT_FOUND", `${label} not found`, 404);
    throw err;
  };
  return {
    list: async (req, res) => sendPaged(res, await shown(req, await service.list(req.validated.query, scopeOf(req)))),
    get: async (req, res) => ok(res, await shown(req, await service.get(req.validated.params.id, scopeOf(req)).catch(notFound))),
    create: async (req, res) => created(res, await shown(req, await service.create(req.validated.body, withActor(req)))),
    update: async (req, res) =>
      ok(res, await shown(req, await service.update(req.validated.params.id, req.validated.body, withActor(req), scopeOf(req)).catch(notFound))),
    archive: async (req, res) => {
      const row = await service.archive(req.validated.params.id, withActor(req), scopeOf(req)).catch(notFound);
      return row ? ok(res, await shown(req, row)) : res.status(204).end();
    },
  };
}

const VERBS = Object.freeze({
  list: { method: "get", path: "/", action: "view" },
  get: { method: "get", path: "/:id", action: "view" },
  create: { method: "post", path: "/", action: "create" },
  update: { method: "patch", path: "/:id", action: "edit" },
  archive: { method: "post", path: "/:id/archive", action: "delete" },
});

/**
 * Mount the verbs the contract names, each with route() and requirePermission().
 * @param {import("express").Router} router
 * @param {{controller: object, module: string, contract: Record<string, object>, actions?: Record<string, string>}} opts
 *   actions  override the permission action per verb ({ archive: "edit" })
 */
function mountResource(router, { controller, module, contract, actions = {} }) {
  const { route } = require("../../http/route");
  const { requirePermission } = require("../../middleware/rbac");
  for (const verb of Object.keys(contract || {})) {
    if (!VERBS[verb]) throw new Error(`mountResource: unknown verb "${verb}"; use ${Object.keys(VERBS).join(", ")}`);
  }
  for (const [verb, v] of Object.entries(VERBS)) {
    if (!contract[verb]) continue;
    route(router, v.method, v.path, contract[verb], requirePermission(module, actions[verb] || v.action), controller[verb]);
  }
}

module.exports = { makeRepo, makeService, makeController, mountResource, VERBS };
