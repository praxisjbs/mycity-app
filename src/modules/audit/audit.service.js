"use strict";
/**
 * The Audit Log: every write in every module, as emit() recorded it, read by people
 * who hold Settings view over everything (scope all) and by the CEO.
 *
 * Restricted values (salary, bank, personal details, tax and pension numbers) inside
 * an entry's before and after are masked for a reader whose roles mask them
 * (shared/rbac/field-mask.js), and the entry names what was masked, so the screen can
 * say Restricted rather than show an empty value. An entry about the reader's own
 * employee record is not masked from them. The export is masked the same way.
 *
 * The export is the whole filtered log, not the page on screen: the request records
 * audit.export_requested, and the worker gathers the entries 25 at a time, builds the
 * workbook, keeps it in the vault and emails it to the person who asked, so it
 * arrives in their Mailbox (audit.events.js). At most EXPORT_CEILING entries go into
 * one file; past that the email says so and asks for narrower filters.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pool } = require("../../config/db");
const { logger } = require("../../config/logger");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const catalog = require("../../shared/access/access.catalog");
const catalogue = require("../../shared/events/catalogue");
const fieldMask = require("../../shared/rbac/field-mask");
const routeMap = require("../../shared/route-map");
const repo = require("./audit.repo");
const { EVENTS } = require("./audit.events");

/** The most entries one export file holds. */
const EXPORT_CEILING = 10_000;

let catalogueLoaded = false;

/**
 * Every module's event keys. The API loads a module's events file only when a route
 * needs it, and the log holds entries from every module, so each is read in words.
 */
function loadCatalogue() {
  if (catalogueLoaded) return;
  catalogueLoaded = true;
  const dir = path.resolve(__dirname, "..");
  for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name, `${name}.events.js`);
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 0) require(file);
    } catch (err) {
      logger.warn({ err, file: `${name}.events.js` }, "audit: an events file did not load; its entries show their keys");
    }
  }
}

/** What an entry's action means, from the event catalogue. */
function summaryOf(action) {
  loadCatalogue();
  const entry = catalogue.get(action);
  return entry ? entry.summary : action;
}

/** Where an entry's record opens. A person's own account opens on Settings · Users. */
function linkOf(entityType, entityId) {
  const link = routeMap.linkFor(entityType === "account" ? "app_user" : entityType, entityId);
  return link ? link.path : null;
}

/** Property names under `value` (any depth) that hold a non-empty restricted value. */
function maskedIn(value, props, out = new Set(), depth = 0) {
  if (!value || typeof value !== "object" || depth > 12) return out;
  for (const [k, v] of Object.entries(value)) {
    if (props.has(k) && v !== null && v !== undefined && v !== "") out.add(k);
    else if (v && typeof v === "object") maskedIn(v, props, out, depth + 1);
  }
  return out;
}

/**
 * Entries as a reader may see them.
 * @param {object[]} rows      ledger rows (repo.page)
 * @param {string[]} maskedKeys the reader's masked field keys
 * @param {string|null} ownEmployeeId
 */
function present(rows, maskedKeys, ownEmployeeId) {
  const props = fieldMask.maskedPropsFor(maskedKeys);
  return rows.map((r) => {
    const own = r.entity_type === "employee" && ownEmployeeId && r.entity_id === ownEmployeeId;
    const hide = own ? new Set() : props;
    const masked = hide.size ? [...maskedIn(r.before, hide, maskedIn(r.after, hide))].sort() : [];
    return {
      audit_ledger_id: r.audit_ledger_id,
      occurred_at: r.occurred_at,
      actor_user_id: r.actor_user_id,
      actor_name: r.actor_name,
      actor_email: r.actor_email,
      actor_ip: r.actor_ip,
      action: r.action,
      summary: summaryOf(r.action),
      module_key: r.module_key,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      link: linkOf(r.entity_type, r.entity_id),
      before: masked.length ? fieldMask.applyMask(r.before, hide) : r.before,
      after: masked.length ? fieldMask.applyMask(r.after, hide) : r.after,
      changed_fields: r.changed_fields || [],
      is_sensitive: r.is_sensitive,
      masked,
    };
  });
}

/** Refuse a reader without Settings view over everything; the CEO's scope is always all. */
function assertWholeLog(scope) {
  if (!scope || scope.scope !== "all")
    throw new AppError("PERMISSION_DENIED", "You do not have access to this", 403);
}

/**
 * GET /audit
 * @param {object} query  AuditListQuery
 * @param {object} reader req.user
 * @param {object} scope  scopeOf(req)
 */
async function list(query, reader, scope) {
  assertWholeLog(scope);
  const page = await repo.page(pool, query);
  const keys = await fieldMask.maskedKeysFor(pool, reader);
  return { ...page, data: present(page.data, keys, reader.employee_id || null) };
}

/** GET /audit/summary */
async function summary(scope) {
  assertWholeLog(scope);
  const counts = await repo.summary(pool);
  const label = (key) => (catalog.MODULE_META[key] ? catalog.MODULE_META[key].label : key);
  return {
    ...counts,
    by_module: counts.by_module.map((m) => ({ module_key: m.module_key, label: label(m.module_key), entries: m.entries })),
    modules: catalog.MODULE_CATALOG.map((m) => ({ key: m.key, label: m.label })),
  };
}

/**
 * POST /audit/exports: queue the whole filtered log for the worker, which emails it.
 * @returns {Promise<{queued: true, email: string}>}
 */
async function requestExport(filters, actor, scope) {
  assertWholeLog(scope);
  if (!actor.email) throw new AppError("NO_EMAIL", "Your login has no email to send the export to.", 422);
  const client = await pool.connect();
  try {
    await atomically(client, () =>
      emit(client, {
        key: EVENTS.AUDIT_EXPORT_REQUESTED,
        entity: { type: "audit_export", id: crypto.randomUUID() },
        actor,
        payload: { filters, requested_by: actor.user_id },
      }),
    );
  } finally {
    client.release();
  }
  return { queued: true, email: actor.email };
}

/**
 * Every entry the filters match, masked for `reader`, gathered a page of 25 at a time
 * up to the ceiling. Run by the worker for an export.
 * @returns {Promise<{rows: object[], total: number, capped: boolean}>}
 */
async function gather(db, filters, reader) {
  const keys = await fieldMask.maskedKeysFor(db, reader);
  const rows = [];
  let page = await repo.page(db, { ...filters, page: 1 });
  rows.push(...present(page.data, keys, reader.employee_id || null));
  while (page.page.has_next && rows.length < EXPORT_CEILING) {
    page = await repo.page(db, { ...filters, page: page.page.number + 1 });
    rows.push(...present(page.data, keys, reader.employee_id || null));
  }
  const total = page.page.total;
  return { rows: rows.slice(0, EXPORT_CEILING), total, capped: total > EXPORT_CEILING };
}

module.exports = { list, summary, requestExport, gather, present, EXPORT_CEILING };
