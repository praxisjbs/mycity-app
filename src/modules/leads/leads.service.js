"use strict";
/**
 * Leads (docs/guides/partnerships.md §3 steps 1 and 6, §6.2, §6.4): the one write path for a lead.
 *
 *   New Lead          the organisation, its primary contact and its first deal, in one transaction;
 *                     the deal opens at the first stage unless an open one is given
 *   Edit Lead         its own fields; a converted lead is read only and links to its partner
 *   status            read from its deal's stage, never typed, kept in step by every stage move
 *                     (syncStatus): On Hold keeps the status it had
 *   Close as Lost     its deal to the first Closed Lost stage, with the reason
 *   Convert to        a deal signed outside the hub: its signed copy, then the deal to the first
 *   Partner           signed stage, which converts it (partners.convert.js); idempotent
 *
 * An owner outside the reader's scope is refused: a lead made for someone else would vanish from
 * the person who made it (§6.1). createIn writes a lead in a caller's transaction, for New Lead and
 * for the Partnership Tracker import (M7 PR 4, source `import`).
 */
const { pool } = require("../../config/db");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const numbering = require("../../shared/numbering/numbering");
const lagos = require("../../shared/time/lagos");
const { EVENTS } = require("./leads.events");
const repo = require("./leads.repo");
const pipeline = require("../partner_pipeline/partner_pipeline.service");
const lists = require("../partner_pipeline/partner_pipeline.lists");
const fields = require("../partner_pipeline/partner_pipeline.fields");
const dealRepo = require("../partner_pipeline/partner_pipeline.repo");

const notFound = () => new AppError("NOT_FOUND", "That lead does not exist, or you cannot see it.", 404);
const invalid = (field, message) => new AppError("VALIDATION_FAILED", "Check the highlighted fields", 422, { [field]: [message] });

/** An owner the reader may give a record to: anyone with `all`, else someone in their scope (§6.1). */
const assertOwner = (scope, ownerId, field) => pipeline.assertOwner(scope, ownerId, field);

const partnersService = () => require("../partners/partners.service");

/** The lead's region: its scope and, for `cities`, the place rows of lead.cities. */
async function saveRegion(client, id, region, field = "region") {
  await partnersService().saveCities(client, "lead.cities", id, region.scope === "cities" ? region.cities || [] : [], `${field}.cities`);
  return region.scope;
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/** A page of leads the reader may see (GET /leads). */
async function list(query, scope) {
  const params = [];
  const customSql = await fields.filterSql(pool, "lead", query.custom, "l.custom", params);
  return repo.list(pool, query, scope, { customSql, params });
}

/** The figures above Leads (GET /leads/summary). */
function summary(scope) {
  const today = lagos.today();
  return repo.summary(pool, scope, { monthStart: lagos.startOfDay(`${today.slice(0, 7)}-01`) });
}

/** The Lead 360 (GET /leads/:id). */
function get360(id, scope, actor) {
  return require("./leads.360").one(pool, id, scope, actor);
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

/**
 * A lead, its primary contact and its first deal, in the caller's transaction: New Lead, and a row of
 * the Partnership Tracker import (M7 PR 4), whose row may name no contact. The caller has checked the
 * owners against the reader's scope.
 * @param {object} body  LeadCreate (`contact` optional here)
 * @param {{held: boolean, source?: "person"|"import"}} opts
 * @returns {Promise<{lead_id: string, number: string, deal_id: string}>}
 */
async function createIn(client, actor, body, { held, source = "person" }) {
  // A source and impacts by name or code: a name the list does not hold joins it (§6.3).
  const sourceCode = await lists.codeFor(client, actor, "lead_source", body.source);
  const impact = body.impact === undefined || body.impact === null ? null : await lists.codesFor(client, actor, "partnership_impact", body.impact);
  const custom = await fields.checkCustom(client, { appliesTo: "lead", categoryId: body.partner_category_id, values: body.custom });
  const { number } = await numbering.allocate(client, "lead");
  const identifiedOn = body.identified_on ?? lagos.today();
  const leadId = await repo.insert(client, {
    number,
    status: "new",
    name: body.name,
    partner_category_id: body.partner_category_id,
    industry: body.industry ?? null,
    region_scope: body.region.scope,
    website: body.website ?? null,
    objective: body.objective ?? null,
    source: sourceCode,
    owner_id: body.owner_id,
    identified_on: identifiedOn,
    impact,
    impact_rating: body.impact_rating ?? null,
    impact_note: body.impact_note ?? null,
    comments: body.comments ?? null,
    custom,
  });
  await saveRegion(client, leadId, body.region);
  if (body.contact) await partnersService().contactIn(client, actor, { kind: "lead", id: leadId }, body.contact, { primary: true, field: "contact" });
  const deal = await pipeline.createIn(client, actor, { kind: "lead", id: leadId, categoryId: body.partner_category_id }, body.deal, {
    held,
    field: "deal",
    source,
    identifiedOn,
  });
  await repo.update(client, leadId, { status: lists.leadStatusOf(deal.stage.meaning, "new") });
  await emit(client, {
    key: EVENTS.LEAD_CREATED,
    entity: { type: "lead", id: leadId },
    actor,
    after: { number, name: body.name, owner_id: body.owner_id },
    payload: { lead_id: leadId, number, deal_id: deal.deal_id, owner_id: body.owner_id, source },
  });
  return { lead_id: leadId, number, deal_id: deal.deal_id };
}

/** New Lead (POST /leads): the lead, its primary contact and its first deal. */
async function create(actor, scope, body) {
  assertOwner(scope, body.owner_id);
  assertOwner(scope, body.deal.owner_id, "deal.owner_id");
  const held = await pipeline.holdsMoney(actor);
  const made = await pipeline.tx((client) => createIn(client, actor, body, { held }));
  return get360(made.lead_id, scope, actor);
}

/** A lead the reader may see, locked for a change; a converted one is read only. */
async function lockSeen(client, id, scope) {
  if (!(await repo.get(client, id, scope))) throw notFound();
  const lead = await repo.lock(client, id);
  if (lead.status === "converted") throw new AppError("LEAD_CONVERTED", "This lead is now a partner; open the partner.", 409);
  return lead;
}

/** Edit Lead (PATCH /leads/:id). */
async function update(actor, scope, id, body) {
  if (body.owner_id) assertOwner(scope, body.owner_id);
  await pipeline.tx(async (client) => {
    const lead = await lockSeen(client, id, scope);
    const changes = {};
    for (const k of ["name", "partner_category_id", "industry", "website", "objective", "source", "owner_id", "identified_on", "impact", "impact_rating", "impact_note", "comments"]) {
      if (body[k] !== undefined) changes[k] = body[k];
    }
    // A source and impacts by name or code: a name the list does not hold joins it (§6.3).
    if (body.source !== undefined) changes.source = await lists.codeFor(client, actor, "lead_source", body.source);
    if (Array.isArray(body.impact)) changes.impact = await lists.codesFor(client, actor, "partnership_impact", body.impact);
    if (body.region) changes.region_scope = await saveRegion(client, id, body.region);
    if (body.custom !== undefined) {
      changes.custom = await fields.checkCustom(client, { appliesTo: "lead", categoryId: body.partner_category_id || lead.partner_category_id, values: body.custom, had: lead.custom });
    }
    await repo.update(client, id, changes);
    await emit(client, {
      key: EVENTS.LEAD_UPDATED,
      entity: { type: "lead", id },
      actor,
      before: { name: lead.name, owner_id: lead.owner_id },
      after: { name: changes.name ?? lead.name, owner_id: changes.owner_id ?? lead.owner_id },
      payload: { lead_id: id, number: lead.number, fields: Object.keys(body) },
    });
  });
  return get360(id, scope, actor);
}

/**
 * Keep a lead's status in step with its deal's new stage, in the stage move's transaction (§6.4).
 * @param {string} meaning  the new stage's
 * @param {string|null} reason  Closed Lost's
 */
async function syncStatus(client, actor, leadId, meaning, reason) {
  const lead = await repo.lock(client, leadId);
  if (!lead || lead.status === "converted") return;
  const status = lists.leadStatusOf(meaning, lead.status);
  const changes = { status };
  if (status === "lost") changes.lost_reason = reason || lead.lost_reason || "Closed lost";
  // A lost lead reopened by its deal's move is no longer lost (§6.4).
  else if (lead.lost_reason) changes.lost_reason = null;
  if (status === lead.status && status !== "lost") return;
  await repo.update(client, leadId, changes);
  await emit(client, {
    key: status === "lost" ? EVENTS.LEAD_LOST : EVENTS.LEAD_UPDATED,
    entity: { type: "lead", id: leadId },
    actor,
    before: { status: lead.status },
    after: { status },
    payload: { lead_id: leadId, number: lead.number, status, owner_id: lead.owner_id },
  });
}

/** Close as Lost (POST /leads/:id/lose): its deal to the first Closed Lost stage with the reason. */
async function lose(actor, scope, id, body) {
  await pipeline.tx(async (client) => {
    await lockSeen(client, id, scope);
    const stages = await lists.stagesOf(client);
    const lost = lists.firstOf(stages, "closed_lost");
    if (!lost) throw invalid("reason", "Set up a Closed Lost stage");
    const deal = await dealRepo.ofLead(client, id);
    if (!deal) throw invalid("reason", "This lead has no deal");
    if (String(deal.stage) === lost.code) throw invalid("reason", "Already lost");
    await require("../partner_pipeline/partner_pipeline.stages").moveIn(client, actor, await dealRepo.lock(client, deal.deal_id), { stage: lost.code, reason: body.reason });
  });
  return get360(id, scope, actor);
}

/**
 * Convert to Partner (POST /leads/:id/convert): for a deal signed outside the hub, with its signed
 * copy. Converts once: a second press, a second tab or a repeated signature answers the same partner.
 */
async function convert(actor, scope, id, body) {
  return pipeline.tx(async (client) => {
    if (!(await repo.get(client, id, scope))) throw notFound();
    const lead = await repo.lock(client, id);
    if (lead.status === "converted") return { partner_id: lead.converted_partner_id };
    const deal = await dealRepo.ofLead(client, id);
    if (!deal) throw invalid("signed_copy_document_id", "This lead has no deal");
    if (!body.signed_copy_document_id && !(await dealRepo.hasSignedAgreement(client, deal.deal_id))) {
      throw new AppError("SIGNED_COPY_REQUIRED", "Check the highlighted fields", 422, { signed_copy_document_id: ["Attach the signed copy"] });
    }
    const stages = await lists.stagesOf(client);
    const signed = lists.firstOf(stages, "signed") || lists.firstOf(stages, "active");
    if (!signed) throw invalid("signed_copy_document_id", "Set up a signed stage");
    const locked = await dealRepo.lock(client, deal.deal_id);
    const moved = await require("../partner_pipeline/partner_pipeline.stages").moveIn(
      client,
      actor,
      locked,
      { stage: signed.code, reason: null, signed_copy_document_id: body.signed_copy_document_id || null },
      { source: "conversion" },
    );
    return { partner_id: moved.converted_partner_id };
  });
}

/**
 * Remove a lead the Partnership Tracker import made, reverting that import, in its transaction: its
 * deal, contacts and region go with it. The importer has checked that nothing uses it.
 */
async function removeImportedIn(client, actor, id) {
  const lead = await repo.lock(client, id);
  if (!lead) return;
  await dealRepo.removeDealsOf(client, { kind: "lead", id });
  await partnersService().saveCities(client, "lead.cities", id, [], "region.cities");
  await repo.remove(client, id);
  await emit(client, {
    key: EVENTS.LEAD_REMOVED,
    entity: { type: "lead", id },
    actor,
    before: { number: lead.number, name: lead.name },
    payload: { lead_id: id, number: lead.number },
  });
}

module.exports = { removeImportedIn, assertOwner, list, summary, get360, createIn, create, update, syncStatus, lose, convert };
