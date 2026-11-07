"use strict";
/**
 * The Lead 360 (docs/guides/partnerships.md §6.2): one call, zero-data safe. A lead made a minute
 * ago reads with every figure 0 and every collection empty, never a broken page.
 *
 *   lead       its fields, its region with its cities, its status from its deal's stage
 *   kpis       Projected Value (its deal's), Days at Stage, Health, Days Since Last Contact (its
 *              latest interaction, else since it was made)
 *   deal       its one deal whole, money left out without `partnerships.money`
 *   contacts   the first 25, the primary first
 *   overview   its next three events (connected through My Workspace, M7 PR 5) and its latest
 *              five interactions
 *   custom_fields  the fields its category and every category give leads, retired ones included
 */
const { AppError } = require("../../shared/errors");
const repo = require("./leads.repo");
const pipeline = require("../partner_pipeline/partner_pipeline.service");
const fields = require("../partner_pipeline/partner_pipeline.fields");
const dealRepo = require("../partner_pipeline/partner_pipeline.repo");

/** LeadDetail from the repo's row: the contract's keys, the region whole. */
function detailOf(r, region) {
  return {
    lead_id: r.lead_id,
    number: r.number,
    name: r.name,
    partner_category_id: r.partner_category_id,
    category: r.category,
    region: r.region,
    status: r.status,
    on_hold: r.on_hold,
    stage_label: r.stage_label,
    health: r.health,
    owner: r.owner,
    last_contact_at: r.last_contact_at,
    identified_on: r.identified_on,
    created_at: r.created_at,
    industry: r.industry,
    website: r.website,
    objective: r.objective,
    source: r.source ? String(r.source) : null,
    source_label: r.source_label,
    region_view: region,
    impact: (r.impact || []).map(String),
    impact_rating: r.impact_rating,
    impact_note: r.impact_note,
    comments: r.comments,
    custom: r.custom || {},
    lost_reason: r.lost_reason,
    converted_partner_id: r.converted_partner_id,
    converted_at: r.converted_at,
  };
}

/** Whole days from an instant to now, or 0. */
const daysSince = (at) => (at ? Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86400000)) : 0);

/**
 * The Lead 360 the reader may see.
 * @param {{query: Function}} db
 * @param {string} id
 * @param {object} scope
 * @param {object} actor
 */
async function one(db, id, scope, actor) {
  const r = await repo.get(db, id, scope);
  if (!r) throw new AppError("NOT_FOUND", "That lead does not exist, or you cannot see it.", 404);
  const partners = require("../partners/partners.service");
  const interactions = require("../interactions/interactions.service");
  const held = await pipeline.holdsMoney(actor);
  const dealRow = r.deal_id ? await dealRepo.get(db, r.deal_id, null) : null;
  const [region, deal, contacts, latest, defs] = await Promise.all([
    partners.regionViewOf(db, "lead.cities", id, r.region_scope, r.region),
    r.deal_id ? pipeline.detailFor(db, r.deal_id, held) : null,
    partners.contactsOf(db, { kind: "lead", id }),
    interactions.latestOf(db, { kind: "lead", id }),
    fields.defsFor(db, "lead", r.partner_category_id),
  ]);
  return {
    lead: detailOf(r, region),
    kpis: {
      projected_value: (dealRow && dealRow.estimated_value) || "0.00",
      days_at_stage: dealRow ? dealRow.days_at_stage : 0,
      health: dealRow ? dealRow.health : null,
      days_since_contact: daysSince(r.last_contact_at || r.created_at),
    },
    deal,
    contacts,
    overview: { events: [], interactions: latest },
    custom_fields: defs,
  };
}

module.exports = { one, detailOf, daysSince };
