"use strict";
/**
 * The Document Centre's Library (docs/guides/document-centre.md): the documents a reader may open,
 * from every module that gives the library its own (shared/documents/library.js), in one list.
 *
 *   list()      one page of 25, searched, filtered and sorted on the server
 *   summary()   the four figures above it, over everything the reader may see
 *   get()       one document; an earlier version's id answers its current version
 *   filters()   the areas and types the reader holds a document of, for the Area and Type filters
 *
 * It only reads. A document is listed for a reader the vault would let open it and for nobody else
 * (§6.3), and its bytes are still served by the vault's own routes, where that rule is checked once
 * more. The `documents` grant opens the screen; it never opens a file.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { AppError } = require("../../shared/errors");
const catalog = require("../../shared/access/access.catalog");
const deliveryPlan = require("../../shared/delivery-plan");
const library = require("../../shared/documents/library");
const routeMap = require("../../shared/route-map");
const lagos = require("../../shared/time/lagos");
const repo = require("./library.repo");

const EXPIRING_DAYS = c.documents.EXPIRING_WITHIN_DAYS;

const scopeFor = (...args) => require("../../middleware/rbac").scopeFor(...args);
const notFound = () => new AppError("NOT_FOUND", "Document not found", 404);

/** What this reader may see, worked out once for the request: the condition, its parameters and its sources. */
async function seenBy(user, db = pool) {
  const params = [];
  const { sql, sources } = library.readable(await library.reach(db, user), params);
  return { sql, params, sources };
}

/** The first instant a document counts as added "since", Lagos time; null for any time. */
function sinceOf(added, today = lagos.today()) {
  if (added === "this_month") return lagos.startOfDay(lagos.monthBounds(today).first);
  if (added === "this_year") return lagos.startOfDay(`${today.slice(0, 4)}-01-01`);
  if (added === "last_90_days") return lagos.startOfDay(lagos.addDays(today, -90));
  return null;
}

/**
 * Where a row's record opens for this reader, or null when they may not open that screen: their
 * own record on its Self-Service screen, another's on its module's, held by the module's `view`
 * grant. A Self-Service screen shows only the reader's own.
 */
function linker(user) {
  const held = new Map();
  const holds = async (module) => {
    if (!held.has(module)) held.set(module, Boolean(await scopeFor(user, module, "view")));
    return held.get(module);
  };
  return async (row) => {
    if (!row.record_type || !row.record_id) return null;
    const route = routeMap.ENTITY_ROUTES[row.record_type];
    if (!route) return null;
    const mine = Boolean(user.employee_id && row.subject_employee_id === user.employee_id);
    const self = mine && Boolean(route.self);
    const target = self ? route.self : route;
    if (catalog.OWN_ONLY.has(target.module) && !mine) return null;
    if (!deliveryPlan.screenOpen(target.module, target.tab)) return null;
    if (!(await holds(self ? target.module : routeMap.moduleOf(row.record_type)))) return null;
    const link = routeMap.linkFor(row.record_type, row.record_id, { self });
    return link ? link.path : null;
  };
}

/** A row as the contract's LibraryDocument. */
async function shape(row, link) {
  return {
    document_id: row.document_id,
    title: row.title,
    original_name: row.original_name,
    doc_type: row.doc_type,
    type_label: row.type_label,
    area: row.area,
    area_label: row.area_label,
    record: row.record_type && row.record_id
      ? { type: row.record_type, id: String(row.record_id), label: row.record_label || null, ref: row.record_ref || null, link: await link(row) }
      : null,
    number: row.number,
    mime: row.mime,
    bytes: Number(row.bytes),
    page_count: row.page_count,
    version: row.version,
    status: row.expiring ? "expiring" : row.locked_at ? "signed" : null,
    expires_on: row.expires_on,
    locked_at: row.locked_at,
    created_at: row.created_at,
    added_by_name: row.added_by_name,
  };
}

/** The doc types an Area filter narrows to: those of the sources the reader reaches in that module. */
function typesIn(area, sources) {
  return sources.filter((s) => s.area === area).flatMap((s) => s.doc_types);
}

/**
 * One page of the library.
 * @param {object} query  the validated LibraryListQuery
 * @param {object} user   req.user
 */
async function list(query, user, db = pool) {
  const seen = await seenBy(user, db);
  const page = await repo.list(db, seen, query, {
    types: query.area ? typesIn(query.area, seen.sources) : null,
    since: sinceOf(query.added),
    expiringWithinDays: EXPIRING_DAYS,
  });
  const link = linker(user);
  const data = [];
  for (const row of page.data) data.push(await shape(row, link));
  return { ...page, data };
}

/** The four figures, over every document the reader may see. */
async function summary(user, db = pool) {
  const seen = await seenBy(user, db);
  return repo.summary(db, seen, { monthStart: sinceOf("this_month"), expiringWithinDays: EXPIRING_DAYS });
}

/** One document. A superseded version's id answers the version that replaced it. 404 when the reader may not see it. */
async function get(documentId, user, db = pool) {
  const seen = await seenBy(user, db);
  const row = await repo.get(db, seen, await repo.headOf(db, documentId), { expiringWithinDays: EXPIRING_DAYS });
  if (!row) throw notFound();
  return shape(row, linker(user));
}

/** The Area and Type filters' options: the types the reader holds a document of, and their areas. */
async function filters(user, db = pool) {
  const seen = await seenBy(user, db);
  if (seen.sources.length === 0) return { areas: [], types: [] };
  const held = new Set(await repo.typesHeld(db, seen));
  const all = library.options(seen.sources);
  const types = all.types.filter((t) => held.has(t.doc_type));
  return { areas: all.areas.filter((a) => types.some((t) => t.area === a.area)), types };
}

module.exports = { list, summary, get, filters, seenBy, sinceOf };
