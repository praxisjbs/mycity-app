"use strict";
/**
 * Partners and contacts (docs/guides/partnerships.md §3, §6.1, §6.2, §6.6): the one write path for a
 * partner, its status and the contacts of leads and partners.
 *
 *   New Partner     an organisation already signed: its primary contact and its first deal at a
 *                   signed or active stage, with the signed copy or "signed before the hub"
 *   Edit Partner    its own fields; its region's cities and headquarters are places (F27)
 *   Close Partner   a reason; its open and live deals are lost with it, each with that reason
 *   status          `active` while any deal is live, `dormant` when none is, `closed` by Close
 *                   Partner (syncStatus, in every stage move's transaction)
 *   contacts        on a lead or a partner; one primary a record, one email a record; the first
 *                   number given is the contact's phone, every one kept
 *   quiet           a live partner with no contact since the start of the day N days ago (Lagos):
 *                   N the enabled Partner Inactivity rule's threshold on Home · Alerts, else 30
 */
const { pool } = require("../../config/db");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const numbering = require("../../shared/numbering/numbering");
const places = require("../../shared/places/places");
const lagos = require("../../shared/time/lagos");
const { EVENTS } = require("./partners.events");
const repo = require("./partners.repo");
const pipeline = require("../partner_pipeline/partner_pipeline.service");
const lists = require("../partner_pipeline/partner_pipeline.lists");
const fields = require("../partner_pipeline/partner_pipeline.fields");
const dealRepo = require("../partner_pipeline/partner_pipeline.repo");

/** Days without contact that make a live partner quiet when no Partner Inactivity rule is on (Home's 30). */
const QUIET_DAYS = 30;
/** At most this many cities a region (the contract's). */
const MAX_CITIES = 20;

const notFound = () => new AppError("NOT_FOUND", "That partner does not exist, or you cannot see it.", 404);
const invalid = (field, message) => new AppError("VALIDATION_FAILED", "Check the highlighted fields", 422, { [field]: [message] });
const leads = () => require("../leads/leads.service");

/* ------------------------------------------------------------------ *
 * Places
 * ------------------------------------------------------------------ */

/** A region's cities, replaced: each a place row keyed by the record and its place in the list. */
async function saveCities(client, owner, id, cities, field) {
  for (let i = 0; i < MAX_CITIES; i += 1) await client.query("DELETE FROM place WHERE owner = $1 AND owner_key = $2", [owner, `${id}:${i}`]);
  for (let i = 0; i < cities.length; i += 1) await places.save(client, owner, `${id}:${i}`, cities[i], { field: `${field}.${i}` });
}

/** A record's region as the contract reads it (RegionView). */
async function regionViewOf(db, owner, id, scope, label) {
  const keys = Array.from({ length: MAX_CITIES }, (_, i) => `${id}:${i}`);
  const found = await places.views(db, owner, keys);
  return { scope: scope || null, cities: keys.filter((k) => found.has(k)).map((k) => found.get(k)), label: label || null };
}

/** The instant contact must be on or after for a live partner not to be quiet. */
async function quietFrom(db) {
  const { rows } = await db.query("SELECT min(threshold)::int AS n FROM home_alert_rule WHERE metric = 'partner_inactivity' AND enabled");
  const days = rows[0] && rows[0].n ? rows[0].n : QUIET_DAYS;
  return lagos.startOfDay(lagos.addDays(lagos.today(), -days));
}

/* ------------------------------------------------------------------ *
 * Contacts
 * ------------------------------------------------------------------ */

/** A record's first 25 contacts. */
const contactsOf = (db, record) => repo.contactsOf(db, record);

/**
 * Add a contact to a lead or a partner, in the caller's transaction.
 * @param {{kind: "lead"|"partner", id: string}} record
 * @param {object} body  ContactInput (and primary_contact on Add Contact)
 * @param {{primary?: boolean, field?: string}} [opts]
 */
async function contactIn(client, actor, record, body, { primary = false, field = null } = {}) {
  const at = (k) => (field ? `${field}.${k}` : k);
  if (await repo.emailTaken(client, record, body.email)) throw invalid(at("email"), "Already a contact");
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM partner_contact WHERE ${record.kind}_id = $1`, [record.id]);
  const isPrimary = primary || Boolean(body.primary_contact) || rows[0].n === 0;
  const id = await repo.insertContact(client, {
    [`${record.kind}_id`]: record.id,
    first_name: body.first_name,
    last_name: body.last_name,
    job_title: body.job_title,
    email: body.email,
    phones: body.phones,
    primary_contact: isPrimary,
    signatory: body.signatory,
  });
  if (isPrimary) await repo.clearPrimary(client, record, id);
  await emit(client, {
    key: EVENTS.PARTNER_CONTACT_CREATED,
    entity: { type: "partner_contact", id },
    actor,
    payload: { partner_contact_id: id, [`${record.kind}_id`]: record.id },
  });
  return id;
}

/** The record a contact is on, seen by the reader; a converted lead is read only. */
async function contactRecord(client, { partner_id, lead_id }, scope) {
  const kind = partner_id ? "partner" : "lead";
  const id = partner_id || lead_id;
  const alias = kind === "partner" ? "p" : "l";
  const params = [id];
  const seen = dealRepo.recordSeen(scope, { alias, kind }, params);
  const { rows } = await client.query(`SELECT ${alias}.status FROM ${kind} ${alias} WHERE ${alias}.${kind}_id = $1 ${seen}`, params);
  if (!rows[0]) throw invalid(kind === "partner" ? "partner_id" : "lead_id", `No such ${kind}`);
  if (kind === "lead" && rows[0].status === "converted") throw invalid("lead_id", "Now a partner");
  return { kind, id };
}

/** Add Contact (POST /contacts). */
async function createContact(actor, scope, body) {
  const id = await pipeline.tx(async (client) => contactIn(client, actor, await contactRecord(client, body, scope), body));
  return repo.contact(pool, id);
}

/** Edit Contact (PATCH /contacts/:id). */
async function updateContact(actor, scope, id, body) {
  await pipeline.tx(async (client) => {
    const was = await repo.contact(client, id);
    if (!was) throw new AppError("NOT_FOUND", "That contact does not exist, or you cannot see it.", 404);
    const record = await contactRecord(client, was, scope);
    if (body.email && (await repo.emailTaken(client, record, body.email, id))) throw invalid("email", "Already a contact");
    const changes = {};
    for (const k of ["first_name", "last_name", "job_title", "email", "signatory", "primary_contact"]) if (body[k] !== undefined) changes[k] = body[k];
    if (body.phones !== undefined) Object.assign(changes, { phones: body.phones.length ? body.phones : null, phone: body.phones[0] || null });
    await repo.updateContact(client, id, changes);
    if (body.primary_contact) await repo.clearPrimary(client, record, id);
    await emit(client, {
      key: EVENTS.PARTNER_CONTACT_UPDATED,
      entity: { type: "partner_contact", id },
      actor,
      payload: { partner_contact_id: id, [`${record.kind}_id`]: record.id, fields: Object.keys(body) },
    });
  });
  return repo.contact(pool, id);
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/** A page of partners the reader may see (GET /partners). */
async function list(query, scope) {
  const params = [];
  const customSql = await fields.filterSql(pool, "partner", query.custom, "p.custom", params);
  return repo.list(pool, query, scope, { quietFrom: await quietFrom(pool), customSql, params });
}

/** The cards above Partners (GET /partners/summary). */
async function summary(scope) {
  return repo.summary(pool, scope, { quietFrom: await quietFrom(pool) });
}

/** The Partner 360 (GET /partners/:id). */
function get360(id, scope, actor) {
  return require("./partners.360").one(pool, id, scope, actor);
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

/**
 * Keep a partner's status in step with its deals (§6.6), in the caller's transaction: `active` while
 * any is live, `dormant` when none is; a closed partner stays closed.
 */
async function syncStatus(client, actor, partnerId) {
  const p = await repo.lock(client, partnerId);
  if (!p || p.status === "closed") return;
  const { rows } = await client.query("SELECT EXISTS (SELECT 1 FROM partnership_opportunity WHERE partner_id = $1 AND status = 'live') AS live", [partnerId]);
  const status = rows[0].live ? "active" : "dormant";
  if (status === p.status) return;
  await repo.update(client, partnerId, { status });
  await emit(client, {
    key: EVENTS.PARTNER_STATUS_CHANGED,
    entity: { type: "partner", id: partnerId },
    actor,
    before: { status: p.status },
    after: { status },
    payload: { partner_id: partnerId, number: p.number, status },
  });
}

/**
 * Write a new partner's own row, region and headquarters, in the caller's transaction (New Partner,
 * a conversion). Returns its id.
 */
async function insertIn(client, actor, row, { region, headquarters, field = null, metadata = {} }) {
  const { number } = await numbering.allocate(client, "partner");
  const id = await repo.insert(client, { ...row, number, status: "dormant", metadata });
  if (region) await saveCities(client, "partner.cities", id, region.scope === "cities" ? region.cities || [] : [], field ? `${field}.cities` : "region.cities");
  if (headquarters) await places.save(client, "partner.headquarters", id, headquarters, { field: "headquarters" });
  return { partner_id: id, number };
}

/** New Partner (POST /partners): already signed, with its first deal at a signed or active stage. */
async function create(actor, scope, body) {
  leads().assertOwner(scope, body.owner_id);
  leads().assertOwner(scope, body.deal.owner_id, "deal.owner_id");
  const held = await pipeline.holdsMoney(actor);
  const id = await pipeline.tx(async (client) => {
    const custom = await fields.checkCustom(client, { appliesTo: "partner", categoryId: body.partner_category_id, values: body.custom });
    const made = await insertIn(
      client,
      actor,
      {
        name: body.name,
        legal_name: body.legal_name ?? null,
        partner_category_id: body.partner_category_id,
        region_scope: body.region.scope,
        industry: body.industry ?? null,
        website: body.website ?? null,
        logo_document_id: body.logo_document_id ?? null,
        owner_id: body.owner_id,
        since: body.since ?? lagos.today(),
        custom,
      },
      { region: body.region, headquarters: body.headquarters, metadata: body.signed_before_hub ? { signed_before_hub: true } : {} },
    );
    const record = { kind: "partner", id: made.partner_id };
    await contactIn(client, actor, record, body.contact, { primary: true, field: "contact" });
    const deal = await pipeline.createIn(client, actor, { ...record, categoryId: body.partner_category_id }, body.deal, { held, field: "deal", allowSigned: true });
    if (body.signed_copy_document_id) {
      await require("./partners.documents").attachIn(client, actor, {
        record,
        deal_id: deal.deal_id,
        document_id: body.signed_copy_document_id,
        origin: "signed_copy",
        field: "signed_copy_document_id",
      });
    }
    await syncStatus(client, actor, made.partner_id);
    await emit(client, {
      key: EVENTS.PARTNER_CREATED,
      entity: { type: "partner", id: made.partner_id },
      actor,
      after: { number: made.number, name: body.name, owner_id: body.owner_id },
      payload: { partner_id: made.partner_id, number: made.number, deal_id: deal.deal_id, owner_id: body.owner_id },
    });
    return made.partner_id;
  });
  return get360(id, scope, actor);
}

/** A partner the reader may see, locked. */
async function lockSeen(client, id, scope) {
  if (!(await repo.get(client, id, scope))) throw notFound();
  return repo.lock(client, id);
}

/** Edit Partner (PATCH /partners/:id). */
async function update(actor, scope, id, body) {
  if (body.owner_id) leads().assertOwner(scope, body.owner_id);
  await pipeline.tx(async (client) => {
    const p = await lockSeen(client, id, scope);
    const changes = {};
    for (const k of ["name", "legal_name", "partner_category_id", "industry", "website", "logo_document_id", "owner_id", "since"]) if (body[k] !== undefined) changes[k] = body[k];
    if (body.region) {
      changes.region_scope = body.region.scope;
      await saveCities(client, "partner.cities", id, body.region.scope === "cities" ? body.region.cities || [] : [], "region.cities");
    }
    if (body.headquarters !== undefined) {
      if (body.headquarters) await places.save(client, "partner.headquarters", id, body.headquarters, { field: "headquarters" });
      else await places.remove(client, "partner.headquarters", id);
    }
    if (body.custom !== undefined) {
      changes.custom = await fields.checkCustom(client, { appliesTo: "partner", categoryId: body.partner_category_id || p.partner_category_id, values: body.custom, had: p.custom });
    }
    await repo.update(client, id, changes);
    await emit(client, {
      key: EVENTS.PARTNER_UPDATED,
      entity: { type: "partner", id },
      actor,
      before: { name: p.name, owner_id: p.owner_id },
      after: { name: changes.name ?? p.name, owner_id: changes.owner_id ?? p.owner_id },
      payload: { partner_id: id, number: p.number, fields: Object.keys(body) },
    });
  });
  return get360(id, scope, actor);
}

/** Close Partner (POST /partners/:id/close): its open and live deals lost with it, each with the reason. */
async function close(actor, scope, id, body) {
  await pipeline.tx(async (client) => {
    const p = await lockSeen(client, id, scope);
    if (p.status === "closed") throw invalid("reason", "Already closed");
    const unfinished = await dealRepo.unfinishedOf(client, { kind: "partner", id });
    if (unfinished.length) {
      const lost = lists.firstOf(await lists.stagesOf(client), "closed_lost");
      if (!lost) throw invalid("reason", "Set up a Closed Lost stage");
      const stages = require("../partner_pipeline/partner_pipeline.stages");
      for (const dealId of unfinished) {
        const deal = await dealRepo.lock(client, dealId);
        if (String(deal.stage) !== lost.code) await stages.moveIn(client, actor, deal, { stage: lost.code, reason: body.reason });
      }
    }
    await repo.update(client, id, { status: "closed", closed_at: new Date(), close_reason: body.reason });
    await emit(client, {
      key: EVENTS.PARTNER_CLOSED,
      entity: { type: "partner", id },
      actor,
      before: { status: p.status },
      after: { status: "closed" },
      payload: { partner_id: id, number: p.number, deals_lost: unfinished.length },
    });
  });
  return get360(id, scope, actor);
}

module.exports = {
  QUIET_DAYS,
  saveCities,
  regionViewOf,
  quietFrom,
  contactsOf,
  contactIn,
  createContact,
  updateContact,
  list,
  summary,
  get360,
  syncStatus,
  insertIn,
  create,
  update,
  close,
};
