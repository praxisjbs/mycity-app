"use strict";
/**
 * The Document Centre (docs/guides/document-centre.md): the documents a reader may open, from every
 * module that gives the library its own (shared/documents/library.js), in one list; and the
 * company's own documents, kept here in categories with an audience.
 *
 *   list()      one page of 25, searched (in the files' text too), filtered and sorted on the server
 *   summary()   the four figures above it, over everything the reader may see
 *   get()       one document; an earlier version's id answers its current version
 *   filters()   the areas and types the reader holds a document of, for the Area and Type filters
 *
 *   create(), update(), addVersion(), archive(), restore()           company documents (§6.5)
 *   listCategories(), createCategory(), updateCategory(),
 *   archiveCategory(), restoreCategory()                            categories (§6.4)
 *   tags()                                                          the tags in use, for the tag field
 *   requestLetterhead()                                             Download Letterhead (§6.8)
 *   remindersDue(), reminderCheck()                                 the expiry reminder (§6.9)
 *
 * A document of another module is only read here: its writes stay with its owner. A document is
 * listed for a reader the vault would let open it and for nobody else (§6.3), and its bytes are
 * still served by the vault's own routes, where that rule is checked once more. The `documents`
 * grant opens the screen; for a company document it is also part of the audience rule (§6.4).
 */
const crypto = require("node:crypto");
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { config } = require("../../config/env");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { oneNamedIn } = require("../../shared/ai/named");
const catalog = require("../../shared/access/access.catalog");
const deliveryPlan = require("../../shared/delivery-plan");
const library = require("../../shared/documents/library");
const vault = require("../../shared/documents/vault");
const documents = require("../../shared/documents/generate");
const exportFiles = require("../../shared/documents/exports");
const numbering = require("../../shared/numbering/numbering");
const routeMap = require("../../shared/route-map");
const { exportFilename } = require("../../shared/spreadsheet/cells");
const lagos = require("../../shared/time/lagos");
const access = require("./library.access");
const repo = require("./library.repo");
const { EVENTS, DOC_TYPE, ENTITY, LETTERHEAD, EXPIRY_REMINDER } = require("./library.events");

const EXPIRING_DAYS = c.documents.EXPIRING_WITHIN_DAYS;
/** How far ahead of an expiry, in days, the reminder tells (§6.9): then on the day itself. */
const AHEAD = Object.freeze([60, 30, 7, 0]);
/** The hour a reminder goes out, Lagos time. */
const REMIND_AT = "09:00";

const scopeFor = (...args) => require("../../middleware/rbac").scopeFor(...args);
const notFound = () => new AppError("NOT_FOUND", "Document not found", 404);
const categoryNotFound = () => new AppError("NOT_FOUND", "Category not found", 404);
const invalid = (field, message, code = "VALIDATION_FAILED") => new AppError(code, message, 422, { [field]: [message] });

async function tx(fn, db = pool) {
  const client = await db.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

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
 * grant. A Self-Service screen shows only the reader's own; a company document's category opens
 * on Categories, which is for those who keep the library.
 */
function linker(user, { manages = false } = {}) {
  const held = new Map();
  const holds = async (module) => {
    if (!held.has(module)) held.set(module, Boolean(await scopeFor(user, module, "view")));
    return held.get(module);
  };
  return async (row) => {
    if (!row.record_type || !row.record_id) return null;
    const route = routeMap.ENTITY_ROUTES[row.record_type];
    if (!route) return null;
    if (row.record_type === "document_category" && !manages) return null;
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

/** What the reader may do with a company document: Edit Details and Upload New Version; Archive. */
async function rightsOf(user, row, manages) {
  if (!row.company_document_id) return { may_edit: false, may_archive: false };
  const own = Boolean(row.company_created_by && row.company_created_by === user.user_id);
  const edit = Boolean(await scopeFor(user, "documents", "edit"));
  const del = Boolean(await scopeFor(user, "documents", "delete"));
  return { may_edit: edit && (manages || own), may_archive: del && (manages || own) };
}

/** A row as the contract's LibraryDocument. */
async function shape(row, link, user, manages) {
  const company = row.company_document_id
    ? {
        company_document_id: row.company_document_id,
        category: { document_category_id: row.document_category_id, name: row.category_name },
        tags: row.tags || [],
        description: row.description || null,
        archived_at: row.archived_at,
        ...(await rightsOf(user, row, manages)),
      }
    : null;
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
    status: row.archived_at ? "archived" : row.expiring ? "expiring" : row.locked_at ? "signed" : null,
    expires_on: row.expires_on,
    locked_at: row.locked_at,
    created_at: row.created_at,
    added_by_name: row.added_by_name,
    company,
    matched_text: row.matched_text || null,
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
  const manages = await access.manages(db, user);
  const page = await repo.list(db, seen, query, {
    types: query.area ? typesIn(query.area, seen.sources) : null,
    since: sinceOf(query.added),
    // Archived company documents, with the Archived filter (§6.1): only those who keep the library read any.
    archived: query.archived === "true",
    expiringWithinDays: EXPIRING_DAYS,
  });
  const link = linker(user, { manages });
  const data = [];
  for (const row of page.data) data.push(await shape(row, link, user, manages));
  return { ...page, data };
}

/** The four figures, over every current document the reader may see. */
async function summary(user, db = pool) {
  const seen = await seenBy(user, db);
  return repo.summary(db, seen, { monthStart: sinceOf("this_month"), expiringWithinDays: EXPIRING_DAYS });
}

/** One document. A superseded version's id answers the version that replaced it. 404 when the reader may not see it. */
async function get(documentId, user, db = pool) {
  const seen = await seenBy(user, db);
  const row = await repo.get(db, seen, await repo.headOf(db, documentId), { expiringWithinDays: EXPIRING_DAYS });
  if (!row) throw notFound();
  const manages = await access.manages(db, user);
  return shape(row, linker(user, { manages }), user, manages);
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

/* ------------------------------------------------------------------ *
 * Company documents (§6.4, §6.5)
 * ------------------------------------------------------------------ */

/** A category the person may file a document in: not archived, and seen by them. 422 on the field otherwise. */
async function assertCategoryOpen(client, user, categoryId) {
  const category = await repo.getCategory(client, categoryId);
  if (!category || category.archived_at) throw invalid("document_category_id", "Pick another category");
  if (!(await access.manages(client, user)) && !(await repo.categoryVisible(client, categoryId, user.role_ids || [])))
    throw invalid("document_category_id", "Pick another category");
  return category;
}

/** The same file twice is refused: a current, unarchived company document with these bytes. */
async function assertNewFile(client, documentId, { except = null } = {}) {
  const staged = await vault.get(client, documentId);
  if (!staged || staged.doc_type !== vault.STAGED_DOC_TYPE) return;
  if (staged.content_hash && (await repo.sameFile(client, staged.content_hash, { except })))
    throw invalid("document_id", "Already in library", "DUPLICATE_DOCUMENT");
}

/**
 * Upload Document: the staged file claimed as a company document, numbered DOC-0001, in one
 * transaction (§6.5). The category must be one the uploader sees.
 * @param {object} body  the validated CompanyDocumentCreate
 * @param {object} user  req.user, with its actor fields
 */
async function create(body, user) {
  const documentId = await tx(async (client) => {
    await assertCategoryOpen(client, user, body.document_category_id);
    await assertNewFile(client, body.document_id);
    const { number } = await numbering.allocate(client, "document");
    const row = await repo.insertCompany(client, {
      number,
      document_id: body.document_id,
      document_category_id: body.document_category_id,
      title: body.title,
      description: body.description || null,
      tags: body.tags || [],
      created_by: user.user_id,
    });
    await vault.claim(client, {
      document_id: body.document_id,
      doc_type: DOC_TYPE,
      entity: { type: ENTITY, id: row.company_document_id },
      subject_employee_id: null,
      actor: user,
      field: "document_id",
      sensitivity: "normal",
    });
    await vault.setDetails(client, body.document_id, { title: body.title, expires_on: body.expires_on || null });
    await emit(client, {
      key: EVENTS.COMPANY_DOCUMENT_UPLOADED,
      entity: { type: ENTITY, id: row.company_document_id },
      actor: user,
      after: row,
      payload: { company_document_id: row.company_document_id, number, document_id: body.document_id, title: body.title },
    });
    return body.document_id;
  });
  return get(documentId, user);
}

/**
 * The company document a write names by any version of its file, locked: 404 when the reader may
 * not see it, DOCUMENT_NOT_YOURS for another module's document, 403 when it is neither theirs nor
 * theirs to keep.
 */
async function writable(client, user, documentId, { archived = null } = {}) {
  const seen = await seenBy(user, client);
  const head = await repo.headOf(client, documentId);
  const row = await repo.get(client, seen, head, { expiringWithinDays: EXPIRING_DAYS });
  if (!row) throw notFound();
  const company = await repo.companyByFile(client, head, { lock: true });
  if (!company)
    throw new AppError("DOCUMENT_NOT_YOURS", "This document is changed where it was made", 409);
  const manages = await access.manages(client, user);
  if (!manages && company.created_by !== user.user_id)
    throw new AppError("FORBIDDEN", "Only its uploader or a document manager may change it", 403);
  if (archived === false && company.archived_at) throw new AppError("DOCUMENT_ARCHIVED", "This document is archived", 409);
  return { company, current: await vault.get(client, company.document_id), manages };
}

/** Edit Details: title, category, tags, expiry and description; only what the body names. */
async function update(documentId, body, user) {
  const head = await tx(async (client) => {
    const { company, current } = await writable(client, user, documentId, { archived: false });
    if (body.document_category_id !== undefined && body.document_category_id !== company.document_category_id)
      await assertCategoryOpen(client, user, body.document_category_id);
    const after = await repo.updateCompany(client, company.company_document_id, {
      title: body.title,
      document_category_id: body.document_category_id,
      tags: body.tags,
      description: body.description === undefined ? undefined : body.description || null,
    });
    await vault.setDetails(client, current.document_id, {
      ...(body.title !== undefined && { title: body.title }),
      ...(body.expires_on !== undefined && { expires_on: body.expires_on || null }),
    });
    await emit(client, {
      key: EVENTS.COMPANY_DOCUMENT_UPDATED,
      entity: { type: ENTITY, id: company.company_document_id },
      actor: user,
      before: company,
      after,
      payload: { company_document_id: company.company_document_id, document_id: current.document_id },
    });
    return current.document_id;
  });
  return get(head, user);
}

/**
 * Upload New Version: the staged file claimed onto the same company document and made the next
 * version of its current file (vault.follow); the number, category, tags, title and expiry carry
 * over. The old file stays in its versions.
 */
async function addVersion(documentId, body, user) {
  const next = await tx(async (client) => {
    const { company, current } = await writable(client, user, documentId, { archived: false });
    await assertNewFile(client, body.document_id);
    await vault.claim(client, {
      document_id: body.document_id,
      doc_type: DOC_TYPE,
      entity: { type: ENTITY, id: company.company_document_id },
      subject_employee_id: null,
      actor: user,
      field: "document_id",
      sensitivity: "normal",
    });
    if (body.document_id !== current.document_id) {
      await vault.follow(client, { document_id: body.document_id, supersedes_id: current.document_id, actor: user });
      await vault.setDetails(client, body.document_id, { title: company.title, expires_on: current.expires_on || null });
      await repo.updateCompany(client, company.company_document_id, { document_id: body.document_id });
      await emit(client, {
        key: EVENTS.COMPANY_DOCUMENT_VERSION_ADDED,
        entity: { type: ENTITY, id: company.company_document_id },
        actor: user,
        payload: { company_document_id: company.company_document_id, document_id: body.document_id, supersedes_id: current.document_id },
      });
    }
    return body.document_id;
  });
  return get(next, user);
}

/** Archive Document and Restore Document: reversible; nothing is deleted. */
async function setArchived(documentId, user, archived) {
  const head = await tx(async (client) => {
    const { company, current } = await writable(client, user, documentId);
    if (Boolean(company.archived_at) === archived) return current.document_id;
    await repo.updateCompany(client, company.company_document_id, archived ? { archived_at: new Date(), archived_by: user.user_id } : { archived_at: null, archived_by: null });
    await emit(client, {
      key: archived ? EVENTS.COMPANY_DOCUMENT_ARCHIVED : EVENTS.COMPANY_DOCUMENT_RESTORED,
      entity: { type: ENTITY, id: company.company_document_id },
      actor: user,
      payload: { company_document_id: company.company_document_id, document_id: current.document_id },
    });
    return current.document_id;
  });
  return get(head, user);
}

const archive = (documentId, user) => setArchived(documentId, user, true);
const restore = (documentId, user) => setArchived(documentId, user, false);

/* ------------------------------------------------------------------ *
 * Categories (§6.4)
 * ------------------------------------------------------------------ */

/** Who is asking, for the categories: whether they keep the library, and their roles. */
async function categoryReader(user, db = pool) {
  return { all: await access.manages(db, user), role_ids: user.role_ids || [] };
}

const shapeCategory = (row) => ({
  document_category_id: row.document_category_id,
  name: row.name,
  description: row.description || null,
  audience: row.audience,
  roles: row.roles || [],
  documents: Number(row.documents || 0),
  archived_at: row.archived_at,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

/** One page of categories: the ones the reader sees; archived ones for those who keep the library. */
async function listCategories(query, user, db = pool) {
  const reader = await categoryReader(user, db);
  const page = await repo.listCategories(db, query, reader);
  return { ...page, data: page.data.map(shapeCategory) };
}

async function getCategory(id, user, db = pool) {
  const reader = await categoryReader(user, db);
  const row = await repo.getCategory(db, id);
  if (!row || (!reader.all && (row.archived_at || !(await repo.categoryVisible(db, id, reader.role_ids))))) throw categoryNotFound();
  return shapeCategory(row);
}

/** The roles a `roles` audience names: at least one, each a role that exists. */
async function rolesFor(client, audience, roleIds) {
  if (audience !== "roles") return [];
  const ids = await repo.rolesThatExist(client, roleIds || []);
  if (ids.length === 0) throw invalid("role_ids", "Pick a role");
  return ids;
}

const nameTaken = () => invalid("name", "Name already used", "CATEGORY_NAME_TAKEN");

/** New Category. */
async function createCategory(body, user) {
  const id = await tx(async (client) => {
    if (await repo.categoryNamed(client, body.name)) throw nameTaken();
    const roles = await rolesFor(client, body.audience, body.role_ids);
    const categoryId = await repo.insertCategory(client, {
      name: body.name,
      description: body.description || null,
      audience: body.audience,
      created_by: user.user_id,
    });
    await repo.setCategoryRoles(client, categoryId, roles);
    await emit(client, {
      key: EVENTS.DOCUMENT_CATEGORY_CREATED,
      entity: { type: "document_category", id: categoryId },
      actor: user,
      after: { name: body.name, audience: body.audience, role_ids: roles },
      payload: { document_category_id: categoryId, name: body.name },
    });
    return categoryId;
  });
  return getCategory(id, user);
}

/** Edit Category: only what the body names changes; narrowing an audience hides its documents at once. */
async function updateCategory(id, body, user) {
  await tx(async (client) => {
    const before = await repo.getCategory(client, id, { lock: true });
    if (!before) throw categoryNotFound();
    if (body.name !== undefined && (await repo.categoryNamed(client, body.name, id))) throw nameTaken();
    const audience = body.audience ?? before.audience;
    const roleIds = body.role_ids ?? (before.roles || []).map((r) => r.role_id);
    const roles = await rolesFor(client, audience, roleIds);
    await repo.updateCategory(client, id, {
      name: body.name,
      description: body.description === undefined ? undefined : body.description || null,
      audience: body.audience,
    });
    await repo.setCategoryRoles(client, id, roles);
    await emit(client, {
      key: EVENTS.DOCUMENT_CATEGORY_UPDATED,
      entity: { type: "document_category", id },
      actor: user,
      before: { name: before.name, audience: before.audience, role_ids: (before.roles || []).map((r) => r.role_id) },
      after: { name: body.name ?? before.name, audience, role_ids: roles },
      payload: { document_category_id: id },
    });
  });
  return getCategory(id, user);
}

/** Archive Category and Restore Category: its documents stay; an archived one is no longer offered on Upload Document. */
async function setCategoryArchived(id, user, archived) {
  await tx(async (client) => {
    const before = await repo.getCategory(client, id, { lock: true });
    if (!before) throw categoryNotFound();
    if (Boolean(before.archived_at) === archived) return;
    await repo.updateCategory(client, id, { archived_at: archived ? new Date() : null });
    await emit(client, {
      key: archived ? EVENTS.DOCUMENT_CATEGORY_ARCHIVED : EVENTS.DOCUMENT_CATEGORY_RESTORED,
      entity: { type: "document_category", id },
      actor: user,
      payload: { document_category_id: id, name: before.name },
    });
  });
  return getCategory(id, user);
}

const archiveCategory = (id, user) => setCategoryArchived(id, user, true);
const restoreCategory = (id, user) => setCategoryArchived(id, user, false);

/* ------------------------------------------------------------------ *
 * Tags
 * ------------------------------------------------------------------ */

/** The tags in use on the documents the reader sees, the most used first: the tag field's suggestions. */
async function tags(query, user, db = pool) {
  return repo.listTags(db, await seenBy(user, db), query);
}

/* ------------------------------------------------------------------ *
 * The letterhead (§6.8)
 * ------------------------------------------------------------------ */

/**
 * Download Letterhead: the blank letterhead as PDF (the worker's PDF render) or Word (the Word
 * writer, in the worker), drawn from Settings · Organisation and the brand files at the press.
 * Answered pending, as every export; the screen waits on GET /exports/:id.
 */
async function requestLetterhead(body, user) {
  return tx(async (client) => {
    const entity = { type: LETTERHEAD, id: crypto.randomUUID() };
    if (body.format === "pdf") {
      const doc = await documents.generate(client, { doc_type: LETTERHEAD, entity, data: {}, actor: user });
      return exportFiles.present(doc);
    }
    const doc = await exportFiles.reserve(client, {
      doc_type: LETTERHEAD,
      entity,
      file_name: exportFilename({ base: "letterhead", env: config.APP_ENV, extension: "docx" }),
      title: "Letterhead",
      actor: user,
    });
    await emit(client, {
      key: EVENTS.LETTERHEAD_REQUESTED,
      entity,
      actor: user,
      payload: { document_id: doc.document_id, requested_by: user.user_id },
    });
    return exportFiles.present(doc);
  });
}

/* ------------------------------------------------------------------ *
 * The expiry reminder (§6.9)
 * ------------------------------------------------------------------ */

/**
 * The reminder's occurrences come due: each current company document's expiry 60, 30 and 7 days
 * ahead and on the day. A day already past is not sent late; each occurrence fires once.
 */
async function remindersDue(db, { now }) {
  const today = lagos.today(now);
  const out = [];
  for (const d of await repo.expiringBetween(db, today, lagos.addDays(today, AHEAD[0]))) {
    for (const days of AHEAD) {
      if (lagos.addDays(d.expires_on, -days) !== today) continue;
      out.push({
        entity_type: ENTITY,
        entity_id: d.company_document_id,
        occurrence: `${d.expires_on}:${days}`,
        due_at: lagos.instant(today, REMIND_AT),
        work_hours: true,
      });
    }
  }
  return out;
}

/** The reminder's check, in its firing's transaction: still current, not archived, and its expiry unchanged. */
async function reminderCheck(client, row, { now }) {
  const d = await repo.expiryFacts(client, row.entity_id);
  if (!d || !d.expires_on) return null;
  const [on] = String(row.occurrence).split(":");
  if (on !== d.expires_on || d.expires_on < lagos.today(now)) return null;
  return {
    entity: { type: ENTITY, id: d.company_document_id },
    payload: {
      company_document_id: d.company_document_id,
      document_id: d.document_id,
      number: d.number,
      title: d.title,
      expires_on: d.expires_on,
      days_left: lagos.daysBetween(lagos.today(now), d.expires_on),
    },
  };
}

/* ------------------------------------------------------------------ *
 * Praxis AI (§9): what a card names and re-checks. Nothing here writes.
 * ------------------------------------------------------------------ */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A category a card names by its words, among those the person sees; null when none or several match. */
async function categoryIdOf(db, words, user) {
  const reader = await categoryReader(user, db);
  const pageOf = async (q) => (await repo.listCategories(db, { page: 1, ...(q && { q }) }, reader)).data || [];
  const said = String(words || "").trim();
  const found = await oneNamedIn([() => pageOf(said.slice(0, 80)), () => pageOf(null)], said, (r) => [r.name], { drop: ["category", "documents", "document"] });
  return found ? found.document_category_id : null;
}

/** The first categories' names the person sees, to tap when a card asks which category. */
async function categoryNames(db, user) {
  const page = await repo.categoryNames(db, await categoryReader(user, db));
  return (page.data || []).map((r) => r.name).slice(0, 6);
}

/** The category a card names, by its name. */
async function cardCategory(db, id) {
  if (!db || !UUID.test(String(id || ""))) return [];
  const row = await repo.getCategory(db, id);
  return row ? [{ type: "document_category", id, label: row.name }] : [];
}

/** A company document a card names by its words, among those the person may change; null when none or several match. */
async function documentIdOf(db, words, user) {
  const said = String(words || "").trim();
  const pageOf = async (q) => (await list({ page: 1, area: "documents", ...(q && { q }) }, user, db)).data.filter((d) => d.company && d.company.may_edit);
  const found = await oneNamedIn([() => pageOf(said.slice(0, 80)), () => pageOf(null)], said, (d) => [d.title, d.number]);
  return found ? found.document_id : null;
}

/** The company documents the person may change, by title, to tap when a card asks which one. */
async function documentNames(db, user) {
  const page = await list({ page: 1, area: "documents" }, user, db);
  return page.data.filter((d) => d.company && d.company.may_edit).map((d) => d.title).slice(0, 6);
}

/** The document a card names, by its title. */
async function cardDocument(db, id, user) {
  if (!db || !UUID.test(String(id || "")) || !user) return [];
  try {
    const d = await get(id, user, db);
    return [{ type: "library_item", id: d.document_id, label: d.title }];
  } catch {
    return [];
  }
}

module.exports = {
  list,
  summary,
  get,
  filters,
  seenBy,
  sinceOf,
  create,
  update,
  addVersion,
  archive,
  restore,
  listCategories,
  getCategory,
  createCategory,
  updateCategory,
  archiveCategory,
  restoreCategory,
  tags,
  requestLetterhead,
  remindersDue,
  reminderCheck,
  AHEAD,
  EXPIRY_REMINDER,
  categoryIdOf,
  categoryNames,
  cardCategory,
  documentIdOf,
  documentNames,
  cardDocument,
};
