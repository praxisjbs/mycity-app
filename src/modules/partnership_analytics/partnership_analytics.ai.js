"use strict";
/**
 * What the assistant may read about partnerships as figures (docs/guides/partnerships.md §9): the
 * pipeline by stage, category, region, partner or owner, with the value signed in a period ("what is
 * our partnership value", "who is our highest contributing partner"), and returns by partner or by
 * month. Figures, never a row (praxis-ai.md §6.13); within the asker's scope by the rule every
 * Partnerships screen keeps (§6.1). Money from returns only with `partnerships.money`: without it the
 * returns summary answers downloads alone.
 *
 * Analytics itself is a screen of figures with no form, so it has no card; "how is the team doing"
 * opens it.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const { figure, group, series, periodOf } = require("../../shared/ai/summary");
const queries = require("./partnership_analytics.queries");

const WORDS = { stage: "stage", category: "category", region: "region", partner: "partner", owner: "owner" };

/** The pipeline's figures, and open deals and signed value by what was asked. */
async function pipelineSummary(client, params, actor, now = new Date()) {
  const range = periodOf(params, now);
  const r = await queries.summary(client, range, params, actor.scope);
  const f = r.figures || {};
  const by = WORDS[params.by] || "stage";
  return {
    figures: [
      figure("open_deals", "Open deals", f.open_deals),
      figure("live_deals", "Live deals", f.live_deals),
      figure("stalled", "Stalled deals", f.stalled),
      figure("open_value", "Projected value of open deals (NGN)", String(f.open_value ?? "0.00"), "NGN"),
      figure("signed", `Deals signed ${range.from} to ${range.to}`, f.signed),
      figure("signed_value", `Value signed ${range.from} to ${range.to} (NGN)`, String(f.signed_value ?? "0.00"), "NGN"),
    ],
    groups: [group(`signed_value_by_${by}`, `Value signed by ${by} (NGN), largest first`, r.signed), group(`open_by_${by}`, `Open and live deals by ${by}`, r.open)],
    series: [],
    total: (f.open_deals || 0) + (f.live_deals || 0),
  };
}

/** Returns by partner or month: commission and gross with the money capability, downloads to all. */
async function returnsSummary(client, params, actor, now = new Date()) {
  const range = periodOf(params, now);
  const money = await require("../partner_pipeline/partner_pipeline.service").holdsMoney(actor);
  const r = await queries.returnsSummary(client, range, params, actor.scope, money);
  const f = r.figures || {};
  const figures = [figure("months", "Months with returns", f.months), figure("deals", "Deals with returns", f.deals), figure("downloads", "Downloads", f.downloads), figure("units_sold", "Units sold", f.units_sold)];
  if (money) {
    figures.push(
      figure("gross_sales", "Gross sales (NGN)", String(f.gross_sales ?? "0.00"), "NGN"),
      figure("mycity_commission", "MyCity's commission (NGN)", String(f.mycity_commission ?? "0.00"), "NGN"),
      figure("paid_to_partner", "Paid to partners (NGN)", String(f.paid_to_partner ?? "0.00"), "NGN"),
    );
  }
  const what = money ? "MyCity's commission (NGN)" : "Downloads";
  if (params.by === "month") {
    return { figures, groups: [], series: [series(money ? "commission_by_month" : "downloads_by_month", `${what} by month`, r.rows.map((x) => ({ at: x.key, value: x.value })))], total: f.deals || 0 };
  }
  return { figures, groups: [group(money ? "commission_by_partner" : "downloads_by_partner", `${what} by partner, largest first`, r.rows)], series: [], total: f.deals || 0 };
}

module.exports = defineManifest({
  module: "partnerships",
  summaries: [
    {
      key: "partnerships.summary",
      description:
        "Partnership figures: open, live and stalled deals, projected value, and value signed in a period, by stage, category, region, partner (who contributed most) or owner",
      params: c.partnership_analytics.PartnershipSummaryQuery,
      permission: ["partnerships", "view"],
      run: (client, params, actor) => pipelineSummary(client, params, actor),
    },
    {
      key: "partnership_returns.summary",
      description:
        "Partnership returns over a period by partner or month: downloads and units sold, and with See Commission and Returns, gross sales and MyCity's commission",
      params: c.partnership_analytics.ReturnsSummaryQuery,
      permission: ["partnerships", "view"],
      run: (client, params, actor) => returnsSummary(client, params, actor),
    },
  ],
  routes: [{ intent: "see partnership analytics: each lead owner's prospects, meetings, proposals and signings", screen: "partnerships.analytics" }],
});
