"use strict";
/**
 * Partnership Analytics (docs/guides/partnerships.md §6.18): MyCity's monthly performance sheet's
 * eight measures per lead owner for a period in Lagos days, with deals signed and returns per month,
 * by category, by region and stage to stage. Every figure is within the reader's scope (§6.1); returns
 * only with `partnerships.money` (§6.1, left out of the answer, never hidden by the screen); a
 * person's rating only where Performance lets the reader see it (reviews.service.ratingsFor).
 *
 * Reads only. Export reserves a workbook made by the worker in the asker's scope
 * (partners.export.js, source `partnerships.analytics`).
 */
const { pool } = require("../../config/db");
const lagos = require("../../shared/time/lagos");
const { AppError } = require("../../shared/errors");
const queries = require("./partnership_analytics.queries");

/** The most months a period covers: the contract's 60 points a series. */
const MOST_MONTHS = 60;

/**
 * The period's first and last Lagos days: This Month, This Quarter, This Year (each whole, its days
 * still to come counting nothing yet), or the custom from and to.
 * @param {{period?: string, from?: string, to?: string}} q
 * @param {Date} [now]
 */
function periodOf(q, now = new Date()) {
  const today = lagos.today(now);
  const { year, month } = lagos.yearMonth(today);
  if (q.period === "custom") {
    if (!q.from || !q.to) throw new AppError("VALIDATION_FAILED", "Pick the dates", 422, { from: ["Pick the dates"] });
    const months = (+q.to.slice(0, 4) - +q.from.slice(0, 4)) * 12 + (+q.to.slice(5, 7) - +q.from.slice(5, 7)) + 1;
    if (months > MOST_MONTHS) throw new AppError("VALIDATION_FAILED", "Five years at most", 422, { to: ["Five years at most"] });
    return { from: q.from, to: q.to };
  }
  if (q.period === "year") return { from: `${year}-01-01`, to: `${year}-12-31` };
  if (q.period === "quarter") {
    const first = `${year}-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
    return { from: first, to: lagos.addDays(lagos.addMonths(first, 3), -1) };
  }
  const b = lagos.monthBounds(today);
  return { from: b.first, to: b.last };
}

/** Every month of the period, YYYY-MM, oldest first. */
function monthsOf({ from, to }) {
  const out = [];
  for (let m = `${from.slice(0, 7)}-01`; m <= to && out.length < MOST_MONTHS; m = lagos.addMonths(m, 1)) out.push(m.slice(0, 7));
  return out;
}

/** Stage to stage from each forward stage's reach: the share of the deals at one that reached the next. */
function conversionOf(reach) {
  const out = [];
  for (let i = 0; i + 1 < reach.length && out.length < 40; i += 1) {
    const a = reach[i];
    const b = reach[i + 1];
    out.push({
      from_stage: a.code,
      from_label: a.label,
      to_stage: b.code,
      to_label: b.label,
      moved: b.reached,
      rate: a.reached ? Math.min(100, Math.round((b.reached / a.reached) * 100)) : null,
    });
  }
  return out;
}

/**
 * GET /partnerships/analytics.
 * @param {object} q       AnalyticsQuery, parsed
 * @param {{scope: string, scope_ids: string[]|null}} scope  the reader's `partnerships` scope
 * @param {object} actor   the signed-in user (for the money capability and Performance's ratings)
 * @param {{db?: object, now?: Date}} [opts]
 */
async function get(q, scope, actor, { db = pool, now = new Date() } = {}) {
  const range = periodOf(q, now);
  const money = await require("../partner_pipeline/partner_pipeline.service").holdsMoney(actor);
  const [owners, signed, returns, categories, regions, reach] = await Promise.all([
    queries.byOwner(db, range, q, scope),
    queries.signedPerMonth(db, range, q, scope),
    money ? queries.returnsPerMonth(db, range, q, scope) : Promise.resolve(null),
    queries.byCategory(db, range, q, scope),
    queries.byRegion(db, range, q, scope),
    queries.stageReach(db, range, q, scope),
  ]);
  const ids = owners.map((o) => o.owner_id).filter(Boolean);
  const ratings = await require("../reviews/reviews.service").ratingsFor(db, range, ids, actor);
  const by_owner = owners.map((o) => ({
    owner: o.owner,
    new_prospects: o.new_prospects,
    meetings_held: o.meetings_held,
    proposals_sent: o.proposals_sent,
    partnerships_signed: o.partnerships_signed,
    active_partnerships: o.active_partnerships,
    downloads: o.downloads,
    vendor_leads: o.vendor_leads,
    performance_rating: (o.owner_id && ratings.get(o.owner_id)) || null,
  }));
  const sum = (k) => by_owner.reduce((n, o) => n + o[k], 0);
  const months = monthsOf(range);
  const signedBy = new Map(signed.map((r) => [r.month, r]));
  const out = {
    period: range,
    kpis: {
      new_prospects: sum("new_prospects"),
      meetings_held: sum("meetings_held"),
      proposals_sent: sum("proposals_sent"),
      partnerships_signed: sum("partnerships_signed"),
    },
    by_owner,
    signed_per_month: months.map((m) => ({ month: m, signed: signedBy.get(m)?.signed ?? 0, value: signedBy.get(m)?.value ?? "0.00" })),
    by_category: categories,
    by_region: regions,
    stage_conversion: conversionOf(reach),
  };
  if (returns) {
    const byMonth = new Map(returns.map((r) => [r.month, r]));
    out.returns_per_month = months.map((m) => ({
      month: m,
      gross_sales: byMonth.get(m)?.gross_sales ?? "0.00",
      mycity_commission: byMonth.get(m)?.mycity_commission ?? "0.00",
      downloads: byMonth.get(m)?.downloads ?? 0,
    }));
  }
  return out;
}

module.exports = { MOST_MONTHS, periodOf, monthsOf, conversionOf, get };
