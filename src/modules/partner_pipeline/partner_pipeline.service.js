"use strict";
/**
 * Deals (docs/guides/partnerships.md §3, §5, §6.1, §6.5, §6.6): the one write path for a deal's
 * terms, options, team and custom values, and the reads Pipeline, the deals list and the 360s use.
 * The stage moves in partner_pipeline.stages.js, the health in partner_pipeline.health.js, a month
 * of returns in partner_pipeline.returns.js.
 *
 *   a deal is on a lead or a partner; a lead has the one deal it was captured with (§6.4)
 *   it opens at the first active stage of MyCity's list unless an open one is given; a signed,
 *     active or lost stage is reached by moving it (§6.5), New Partner aside (§6.6)
 *   its owner is always on its team (deal_member, `owner`)
 *   its rate defaults to its category's; a rate that differs sets commission_deviates (§6.6)
 *   its validity is 30 days, 60 days or a date, else its category's default; a date is worked
 *     out from the signing for a number of days
 *
 * Money is gated (§6.1): commission rates and amounts and the merchant's take are left out of
 * every response for a reader without `partnerships.money`, and refused from one.
 *
 * It is also the controller's one door to Categories (§6.3, M7 PR 2): categories, their agreement
 * templates and delivery checklists, custom fields, MyCity's lists and Start From Tracker, each in
 * its own file beside this one.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const numbering = require("../../shared/numbering/numbering");
const places = require("../../shared/places/places");
const grantsCache = require("../../shared/rbac/grants-cache");
const lagos = require("../../shared/time/lagos");
const { EVENTS } = require("./partner_pipeline.events");
const repo = require("./partner_pipeline.repo");
const lists = require("./partner_pipeline.lists");
const categories = require("./partner_pipeline.categories");
const checklists = require("./partner_pipeline.checklists");
const fields = require("./partner_pipeline.fields");
const options = require("./partner_pipeline.options");
const setup = require("./partner_pipeline.setup");

const MONEY = "partnerships.money";

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That deal does not exist, or you cannot see it.", 404);
const invalid = (field, message) => new AppError("VALIDATION_FAILED", "Check the highlighted fields", 422, { [field]: [message] });

/**
 * An owner the reader may give a lead, a partner or a deal to (§6.1): anyone with `all`, else someone in
 * their scope, so nothing a person makes or edits vanishes from them.
 */
function assertOwner(scope, ownerId, field = "owner_id") {
  if (!scope || scope.scope === "all") return;
  if (!(scope.scope_ids || []).includes(ownerId)) throw invalid(field, "Outside your team");
}

/** Whether the person sees and enters commission and returns (§6.1): `partnerships.money`, or the CEO. */
async function holdsMoney(actor) {
  if (!actor) return false;
  if (actor.is_ceo === true) return true;
  return (await grantsCache.getCapabilities(pool, actor.user_id)).includes(MONEY);
}

/** Refuse the money fields from a person without `partnerships.money`. */
function refuseMoney(body, held) {
  if (held) return;
  const asked = ["commission_pct"].filter((k) => body[k] !== undefined && body[k] !== null);
  (body.options || []).forEach((o, i) => {
    if (o.commission_amount !== undefined && o.commission_amount !== null) asked.push(`options.${i}.commission_amount`);
    if (o.merchant_take !== undefined && o.merchant_take !== null) asked.push(`options.${i}.merchant_take`);
  });
  if (asked.length) {
    throw new AppError("CAPABILITY_REQUIRED", "Only a holder of See Commission and Returns enters commission.", 403, Object.fromEntries(asked.map((k) => [k, ["Not yours to set"]])));
  }
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/** A deal row as the contract has it (DealRow), from the repo's row. */
const rowOf = (r) => ({
  deal_id: r.deal_id,
  number: r.number,
  title: r.title,
  record: r.record,
  lead_id: r.lead_id,
  partner_id: r.partner_id,
  category: r.category,
  stage: r.stage,
  stage_label: r.stage_label,
  meaning: r.meaning,
  health: r.health,
  status: r.status,
  owner: r.owner,
  estimated_value: r.estimated_value,
  currency: r.currency ? r.currency.trim() : null,
  expected_close_on: r.expected_close_on,
  days_at_stage: r.days_at_stage,
  event_title: r.event_title,
  event_starts_on: r.event_starts_on,
  created_at: r.created_at,
});

/** One deal whole (DealDetail), money left out without `partnerships.money`. */
async function detailOf(db, r, held) {
  const [opts, team, delivered, lines, venue] = await Promise.all([
    repo.options(db, r.deal_id),
    repo.members(db, r.deal_id),
    repo.deliverables(db, [r.deal_id]),
    repo.history(db, r.deal_id),
    places.view(db, "deal.venue", r.deal_id),
  ]);
  const out = {
    ...rowOf(r),
    objective: r.objective,
    event_ends_on: r.event_ends_on,
    venue,
    expected_attendance: r.expected_attendance,
    blockers: r.blockers,
    next_action: r.next_action,
    next_action_on: r.next_action_on,
    validity_days: r.validity_days,
    valid_until: r.valid_until,
    identified_on: r.identified_on,
    signed_at: r.signed_at,
    completed_at: r.completed_at,
    close_reason: r.close_reason,
    signed_value: r.signed_value,
    impact: r.impact || [],
    impact_labels: r.impact_labels || [],
    impact_rating: r.impact_rating,
    impact_note: r.impact_note,
    comments: r.comments,
    custom: r.custom || {},
    options: opts.map((o) => {
      const shown = { ...o };
      if (!held) {
        delete shown.commission_amount;
        delete shown.merchant_take;
      }
      return shown;
    }),
    members: team,
    deliverables: delivered.data,
    history: lines,
  };
  if (held) {
    out.commission_pct = r.commission_pct;
    out.commission_deviates = r.commission_deviates;
  }
  return out;
}

/** A page of deals the reader may see (GET /deals). */
async function list(query, scope) {
  const params = [];
  const customSql = await fields.filterSql(pool, "deal", query.custom, "po.custom", params);
  const page = await repo.list(pool, query, scope, { customSql, params });
  return { ...page, data: page.data.map(rowOf) };
}

/** One deal the reader may see, whole (GET /deals/:id). */
async function get(id, scope, actor) {
  const r = await repo.get(pool, id, scope);
  if (!r) throw notFound();
  return detailOf(pool, r, await holdsMoney(actor));
}

/** One deal whole for a record's 360, or null. */
async function detailFor(db, dealId, held) {
  const r = await repo.get(db, dealId, null);
  return r ? detailOf(db, r, held) : null;
}

/** Pipeline (GET /pipeline): the figures, the stages' bars, the longest at a stage and the stalled, within scope. */
async function pipeline(query, scope) {
  const today = lagos.today();
  const year = { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
  const [kpis, counts, longest, stuck, stages] = await Promise.all([
    repo.pipelineFigures(pool, query, scope, year),
    repo.pipelineByStage(pool, query, scope),
    repo.longestAtStage(pool, query, scope),
    repo.stalled(pool, query, scope),
    lists.stagesOf(pool),
  ]);
  const byCode = new Map(counts.map((c) => [c.stage, c]));
  // Every active stage that is not Closed Lost, in the list's order, and any other holding a deal.
  const by_stage = stages
    .filter((s) => (s.active && s.meaning !== "closed_lost") || byCode.has(s.code))
    .map((s) => ({ stage: s.code, label: s.label, meaning: s.meaning, open: byCode.get(s.code)?.open || 0, value: byCode.get(s.code)?.value || "0.00" }));
  for (const c of counts) if (!stages.some((s) => s.code === c.stage)) by_stage.push({ stage: c.stage, label: c.stage, meaning: null, open: c.open, value: c.value });
  return {
    kpis,
    by_stage,
    longest_at_stage: longest.data.slice(0, 10),
    stalled: stuck.data,
  };
}

/** A category's name and defaults (its commission and validity) for a deal, or null. */
const categoryOf = (db, id) => (id ? repo.getCategory(db, id) : null);

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

/** The validity columns from the contract's Validity, or the category's default. */
function validityOf(validity, category) {
  if (validity === null) return { validity_days: null, valid_until: null };
  if (validity && validity.days) return { validity_days: validity.days, valid_until: null };
  if (validity && validity.until) return { validity_days: null, valid_until: validity.until };
  return { validity_days: category && category.default_validity_days ? category.default_validity_days : null, valid_until: null };
}

/**
 * Open a deal on a lead or a partner, in the caller's transaction (New Deal, New Lead, New Partner).
 * @param {import("pg").PoolClient} client
 * @param {object} actor
 * @param {{kind: "lead"|"partner", id: string, categoryId: string|null}} record
 * @param {object} body  DealFields
 * @param {{held: boolean, field?: string, allowSigned?: boolean, source?: string, identifiedOn?: string|null, signedBeforeHub?: boolean}} opts
 *   field: where a refusal lands ("deal" inside New Lead); allowSigned: New Partner's first deal;
 *   signedBeforeHub: New Partner's "signed before the hub", carried on deal.signed so no delivery
 *   checklist is raised for it (§13.2, In PR 5);
 *   source: where it came from, on its first history line and its events (`person`, or `import` from
 *   the tracker importer, M7 PR 4); identifiedOn: the day it was identified (its lead's), else today
 * @returns {Promise<{deal_id: string, number: string, stage: object}>}
 */
async function createIn(client, actor, record, body, { held, field = null, allowSigned = false, source = "person", identifiedOn = null, signedBeforeHub = false } = {}) {
  const at = (k) => (field ? `${field}.${k}` : k);
  refuseMoney(body, held);
  const stages = await lists.stagesOf(client);
  // New Partner's first deal opens at the first signed stage unless one is given; any other at the first stage.
  const opening = allowSigned ? lists.firstOf(stages, "signed") || lists.firstOf(stages, "active") : lists.firstStage(stages);
  const stage = body.stage ? lists.stageOf(stages, body.stage) : opening;
  if (!stage) throw invalid(at("stage"), stages.some((s) => s.active) ? "Pick a stage" : "Set up the stages first");
  if (!stage.active) throw invalid(at("stage"), "Pick a stage");
  const signed = lists.isSigned(stage.meaning);
  if (signed && !allowSigned) throw invalid(at("stage"), "Pick an open stage");
  if (!signed && allowSigned) throw invalid(at("stage"), "Pick a signed stage");
  if (stage.meaning === "closed_lost") throw invalid(at("stage"), "Pick an open stage");
  const category = await categoryOf(client, record.categoryId);
  const rate = body.commission_pct ?? (category ? category.default_commission_pct : null);
  const custom = await fields.checkCustom(client, { appliesTo: "deal", categoryId: record.categoryId, values: body.custom });
  // Impacts by name or code: a name the list does not hold joins it (§6.3).
  const impact = body.impact === undefined || body.impact === null ? null : await lists.codesFor(client, actor, "partnership_impact", body.impact);
  const { number } = await numbering.allocate(client, "deal");
  const signedAt = signed ? new Date() : null;
  const validity = validityOf(body.validity, category);
  if (signedAt && validity.validity_days && !validity.valid_until) validity.valid_until = lagos.addDays(lagos.today(), validity.validity_days);
  const dealId = await repo.insert(client, {
    number,
    partner_id: record.kind === "partner" ? record.id : null,
    lead_id: record.kind === "lead" ? record.id : null,
    stage: stage.code,
    status: signed ? "live" : "open",
    health: "on_track",
    currency: "NGN",
    identified_on: identifiedOn || lagos.today(),
    signed_at: signedAt,
    title: body.title,
    event_title: body.event_title ?? null,
    event_starts_on: body.event_starts_on ?? null,
    event_ends_on: body.event_ends_on ?? null,
    expected_attendance: body.expected_attendance ?? null,
    objective: body.objective ?? null,
    estimated_value: body.estimated_value ?? null,
    commission_pct: rate,
    commission_deviates: options.deviates(rate, category && category.default_commission_pct),
    ...validity,
    expected_close_on: body.expected_close_on ?? null,
    next_action: body.next_action ?? null,
    next_action_on: body.next_action_on ?? null,
    owner_id: body.owner_id,
    impact,
    impact_rating: body.impact_rating ?? null,
    impact_note: body.impact_note ?? null,
    comments: body.comments ?? null,
    custom,
  });
  if (body.venue) await places.save(client, "deal.venue", dealId, body.venue, { field: at("venue") });
  await repo.replaceOptions(client, dealId, options.withDefaults(body.options, rate));
  await repo.setTeam(client, dealId, body.owner_id, body.member_ids);
  await repo.addHistory(client, { deal_id: dealId, kind: "stage", from: null, to: stage.code, source, user_id: actor ? actor.user_id : null });
  await emit(client, {
    key: EVENTS.DEAL_CREATED,
    entity: { type: "partner_deal", id: dealId },
    actor,
    after: { number, title: body.title, stage: stage.code, owner_id: body.owner_id },
    payload: { deal_id: dealId, number, [`${record.kind}_id`]: record.id, owner_id: body.owner_id, source },
  });
  if (signed) {
    await emit(client, {
      key: EVENTS.DEAL_SIGNED,
      entity: { type: "partner_deal", id: dealId },
      actor,
      payload: { deal_id: dealId, number, partner_id: record.kind === "partner" ? record.id : null, owner_id: body.owner_id, source, ...(signedBeforeHub ? { signed_before_hub: true } : {}) },
    });
  }
  return { deal_id: dealId, number, stage };
}

/** The record a new deal is on, checked: the reader may see it, a lead has no deal yet, a closed partner takes none. */
async function recordFor(client, body, scope) {
  if (body.lead_id) {
    const params = [body.lead_id];
    const seen = repo.recordSeen(scope, { alias: "l", kind: "lead" }, params);
    const { rows } = await client.query(`SELECT l.lead_id, l.status, l.partner_category_id FROM lead l WHERE l.lead_id = $1 ${seen} FOR UPDATE OF l`, params);
    if (!rows[0]) throw invalid("lead_id", "No such lead");
    if (rows[0].status === "converted") throw invalid("lead_id", "Now a partner");
    const { rows: has } = await client.query("SELECT 1 FROM partnership_opportunity WHERE lead_id = $1 LIMIT 1", [body.lead_id]);
    if (has.length) throw invalid("lead_id", "Already has its deal");
    return { kind: "lead", id: body.lead_id, categoryId: rows[0].partner_category_id };
  }
  const params = [body.partner_id];
  const seen = repo.recordSeen(scope, { alias: "p", kind: "partner" }, params);
  const { rows } = await client.query(`SELECT p.partner_id, p.status, p.partner_category_id FROM partner p WHERE p.partner_id = $1 ${seen} FOR UPDATE OF p`, params);
  if (!rows[0]) throw invalid("partner_id", "No such partner");
  if (rows[0].status === "closed") throw invalid("partner_id", "Partner is closed");
  return { kind: "partner", id: body.partner_id, categoryId: rows[0].partner_category_id };
}

/** New Deal (POST /deals): on a partner, or on a lead without one, at the first stage unless an open one is given. */
async function create(actor, scope, body) {
  assertOwner(scope, body.owner_id);
  const held = await holdsMoney(actor);
  const id = await tx(async (client) => {
    const record = await recordFor(client, body, scope);
    return (await createIn(client, actor, record, body, { held })).deal_id;
  });
  return get(id, scope, actor);
}

/** Edit Deal (PATCH /deals/:id): its terms, options, team and custom values. The stage and health move on their own routes. */
async function update(actor, scope, id, body) {
  if (body.owner_id) assertOwner(scope, body.owner_id);
  const held = await holdsMoney(actor);
  refuseMoney(body, held);
  await tx(async (client) => {
    const seen = await repo.get(client, id, scope);
    if (!seen) throw notFound();
    const deal = await repo.lock(client, id);
    const starts = body.event_starts_on !== undefined ? body.event_starts_on : deal.event_starts_on;
    const ends = body.event_ends_on !== undefined ? body.event_ends_on : deal.event_ends_on;
    if (starts && ends && ends < starts) throw invalid("event_ends_on", "Ends before it starts");
    const category = await categoryOf(client, seen.partner_category_id);
    const changes = {};
    for (const k of ["title", "event_title", "event_starts_on", "event_ends_on", "expected_attendance", "objective", "estimated_value", "expected_close_on", "next_action", "next_action_on", "owner_id", "impact", "impact_rating", "impact_note", "comments"]) {
      if (body[k] !== undefined) changes[k] = body[k];
    }
    if (Array.isArray(body.impact)) changes.impact = await lists.codesFor(client, actor, "partnership_impact", body.impact);
    if (body.commission_pct !== undefined) {
      changes.commission_pct = body.commission_pct ?? (category ? category.default_commission_pct : null);
      changes.commission_deviates = options.deviates(changes.commission_pct, category && category.default_commission_pct);
    }
    if (body.validity !== undefined) {
      Object.assign(changes, validityOf(body.validity, category));
      // A signed deal's days are dated from its signing, as the move into a signed stage dates them.
      if (deal.signed_at && changes.validity_days && !changes.valid_until) {
        changes.valid_until = lagos.addDays(lagos.dateOf(deal.signed_at), changes.validity_days);
      }
    }
    if (body.custom !== undefined) changes.custom = await fields.checkCustom(client, { appliesTo: "deal", categoryId: seen.partner_category_id, values: body.custom, had: deal.custom });
    await repo.update(client, id, changes);
    if (body.venue !== undefined) {
      if (body.venue) await places.save(client, "deal.venue", id, body.venue, { field: "venue" });
      else await places.remove(client, "deal.venue", id);
    }
    const rate = changes.commission_pct !== undefined ? changes.commission_pct : deal.commission_pct;
    if (body.options !== undefined) await repo.replaceOptions(client, id, options.withDefaults(body.options, rate));
    const owner = body.owner_id || deal.owner_id;
    if (body.member_ids !== undefined) await repo.setTeam(client, id, owner, body.member_ids);
    else if (body.owner_id) await repo.ensureOwner(client, id, owner);
    await emit(client, {
      key: EVENTS.DEAL_UPDATED,
      entity: { type: "partner_deal", id },
      actor,
      before: { title: deal.title, owner_id: deal.owner_id },
      after: { title: changes.title ?? deal.title, owner_id: owner },
      payload: { deal_id: id, number: deal.number, fields: Object.keys(body) },
    });
  });
  return get(id, scope, actor);
}

/**
 * The daily job's completion (§6.6, agreement-renewals): each live deal past the later of its validity
 * and its event's end is Completed, each in its own transaction, and its partner's status kept (a partner
 * with no live deal left is Dormant). Safe to run twice.
 * @returns {Promise<{completed: number}>}
 */
async function completeLapsed() {
  let completed = 0;
  for (const id of await repo.lapsedLive(pool)) {
    completed += await tx(async (client) => {
      const deal = await repo.lock(client, id);
      if (!deal || deal.status !== "live") return 0;
      const { rowCount } = await client.query(
        `UPDATE partnership_opportunity SET status = 'completed', completed_at = now()
          WHERE partnership_opportunity_id = $1 AND status = 'live'
            AND GREATEST(valid_until, event_ends_on) < (now() AT TIME ZONE 'Africa/Lagos')::date`,
        [id],
      );
      if (rowCount !== 1) return 0;
      await emit(client, {
        key: EVENTS.DEAL_COMPLETED,
        entity: { type: "partner_deal", id },
        actor: null,
        before: { status: "live" },
        after: { status: "completed" },
        payload: { deal_id: id, number: deal.number, partner_id: deal.partner_id, owner_id: deal.owner_id },
      });
      if (deal.partner_id) await require("../partners/partners.service").syncStatus(client, null, deal.partner_id);
      return 1;
    });
  }
  return { completed };
}

/** The deal behind a card or a 360, seen by the reader, or a 404. */
async function assertSeen(db, id, scope) {
  const r = await repo.get(db, id, scope);
  if (!r) throw notFound();
  return r;
}

/**
 * What a Praxis AI card's ids name (decision 32): the owner (a person), and the category, lead,
 * partner, deal or contact it is about.
 * @param {{query: Function}} db
 * @param {{owner_id?: string, partner_category_id?: string, lead_id?: string, partner_id?: string, deal_id?: string, partner_contact_id?: string}} ids
 */
async function cardNames(db, ids) {
  const people = await require("../organisation/organisation.cards").peopleNamed(db, [ids.owner_id].filter(Boolean));
  const records = await repo.cardNames(db, {
    categories: [ids.partner_category_id],
    leads: [ids.lead_id],
    partners: [ids.partner_id],
    deals: [ids.deal_id],
    contacts: [ids.partner_contact_id],
  });
  return [...people, ...records];
}

module.exports = {
  MONEY,
  completeLapsed,
  cardNames,
  assertOwner,
  holdsMoney,
  rowOf,
  detailFor,
  list,
  get,
  pipeline,
  createIn,
  create,
  update,
  assertSeen,
  tx,
  // Categories (M7 PR 2): each lives in its own file beside this one.
  listCategories: categories.list,
  getCategory: categories.get,
  createCategory: categories.create,
  updateCategory: categories.update,
  getTemplate: categories.getTemplate,
  addTemplate: categories.addTemplate,
  updateTemplate: categories.updateTemplate,
  saveTemplateWording: categories.saveTemplateWording,
  addChecklistItem: checklists.addItem,
  updateChecklistItem: checklists.updateItem,
  listFields: fields.list,
  createField: fields.create,
  updateField: fields.update,
  checkFieldValue: fields.checkValue,
  getList: lists.values,
  listSuggestions: lists.suggestions,
  addListValue: lists.add,
  updateListValue: lists.update,
  readTracker: setup.read,
  applyTracker: setup.apply,
};
