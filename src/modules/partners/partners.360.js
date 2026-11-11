"use strict";
/**
 * The Partner 360 (docs/guides/partnerships.md §6.2): one call, zero-data safe. A partner made a
 * minute ago reads with every figure 0 and every collection empty, never a broken page.
 *
 *   partner    its fields, region, headquarters, logo, and whether it was signed before the hub
 *   kpis       Signed Value (its deals' signed values, Naira); Returns This Year (MyCity's
 *              commission this calendar year, only with `partnerships.money`); Downloads This Year;
 *              Active Deals (live); Days Since Last Contact (its latest interaction, else since made)
 *   deals      the first 25 it has, open and live first
 *   contacts   the first 25, the primary first
 *   overview   its next three connected events the reader may see in My Workspace (partners.work)
 *              and its latest five interactions
 *   deliverables  what MyCity owes on its signed deals (raised on signing, M7 PR 5)
 *   custom_fields the fields its category and every category give partners, retired ones included
 *   history    the latest 25 stage and health lines of its deals, each naming its deal (Activity)
 *
 * The deals, the figures and the history are the deals the reader sees (§6.1): its owner's scope
 * sees every one; a member who sees the partner only through their own deal sees that deal alone.
 */
const { AppError } = require("../../shared/errors");
const places = require("../../shared/places/places");
const lagos = require("../../shared/time/lagos");
const repo = require("./partners.repo");
const pipeline = require("../partner_pipeline/partner_pipeline.service");
const fields = require("../partner_pipeline/partner_pipeline.fields");
const dealRepo = require("../partner_pipeline/partner_pipeline.repo");
const { daysSince } = require("../leads/leads.360");

/** The logo as the contract's DocumentRef, or null. */
async function logoOf(db, id) {
  if (!id) return null;
  const { rows } = await db.query("SELECT document_id, COALESCE(original_name, title) AS file_name, bytes::int AS size_bytes, mime AS mime_type FROM document WHERE document_id = $1", [id]);
  return rows[0] || null;
}

/** PartnerDetail from the repo's row. */
function detailOf(r, extra) {
  return {
    partner_id: r.partner_id,
    number: r.number,
    name: r.name,
    partner_category_id: r.partner_category_id,
    category: r.category,
    region: r.region,
    status: r.status,
    stage_label: r.stage_label,
    health: r.health,
    owner: r.owner,
    last_contact_at: r.last_contact_at,
    since: r.since,
    legal_name: r.legal_name,
    industry: r.industry,
    website: r.website,
    country_code: r.country_code,
    headquarters: extra.headquarters,
    region_view: extra.region,
    logo: extra.logo,
    lead_id: r.lead_id,
    custom: r.custom || {},
    closed_at: r.closed_at,
    close_reason: r.close_reason,
    signed_outside: r.signed_outside,
    created_at: r.created_at,
  };
}

/** The Partner 360 the reader may see. */
async function one(db, id, scope, actor) {
  const r = await repo.get(db, id, scope);
  if (!r) throw new AppError("NOT_FOUND", "That partner does not exist, or you cannot see it.", 404);
  const service = require("./partners.service");
  const interactions = require("../interactions/interactions.service");
  const held = await pipeline.holdsMoney(actor);
  const year = lagos.today().slice(0, 4);
  const work = require("./partners.work");
  const [region, headquarters, logo, figures, deals, contacts, latest, defs, history, events] = await Promise.all([
    service.regionViewOf(db, "partner.cities", id, r.region_scope, r.region),
    places.view(db, "partner.headquarters", id),
    logoOf(db, r.logo_document_id),
    repo.figures(db, id, { yearStart: `${year}-01-01`, yearEnd: `${year}-12-31` }, scope),
    dealRepo.ofRecord(db, { kind: "partner", id }, scope),
    service.contactsOf(db, { kind: "partner", id }),
    interactions.latestOf(db, { kind: "partner", id }),
    fields.defsFor(db, "partner", r.partner_category_id),
    dealRepo.historyOfRecord(db, { kind: "partner", id }, scope),
    work.nextEvents(db, actor, { kind: "partner", id }),
  ]);
  const signed = deals.data.filter((d) => d.status === "live" || d.status === "completed").map((d) => d.deal_id);
  const delivered = signed.length ? (await dealRepo.deliverables(db, signed)).data : [];
  const kpis = {
    signed_value: figures.signed_value,
    downloads_this_year: figures.downloads_this_year,
    active_deals: figures.active_deals,
    days_since_contact: daysSince(r.last_contact_at || r.created_at),
  };
  if (held) kpis.returns_this_year = figures.returns_this_year;
  return {
    partner: detailOf(r, { region, headquarters, logo }),
    kpis,
    deals: deals.data.map(pipeline.rowOf),
    contacts,
    overview: { events, interactions: latest },
    deliverables: delivered,
    custom_fields: defs,
    history,
  };
}

module.exports = { one };
