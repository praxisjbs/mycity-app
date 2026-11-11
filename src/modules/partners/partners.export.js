"use strict";
/**
 * Export on Partners and Leads, and their deals, in the tracker's columns (docs/guides/partnerships.md
 * §6.13, §10.1): `partnerships.partners`, `partnerships.leads` and `partnerships.deals`. The file is
 * made for the person who pressed Export and downloaded on their device (docs/guides/foundation.md
 * §6.12): the request reserves it, the outbox handler builds it in the reader's scope.
 *
 * The workbook's sheet is Master Tracker with MyCity's eighteen columns, then a column for each
 * custom field, so it reads back through the Partnership Tracker import (partners.import.js) as it
 * came. Money never leaves this way: no commission, no returns.
 *
 * Analytics (`partnerships.analytics`, §6.18) exports its period as a workbook of its own: a sheet a
 * table of the screen, made in the asker's scope; Returns per Month only for a holder of
 * `partnerships.money`, decided again in the worker.
 */
const crypto = require("node:crypto");
const { pool } = require("../../config/db");
const { config } = require("../../config/env");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const exportFiles = require("../../shared/documents/exports");
const { exportFilename } = require("../../shared/spreadsheet/cells");
const c = require("@mycity/contract");
const repo = require("./partners.repo");

/** The most rows one export file holds. */
const EXPORT_CEILING = 5000;

const SOURCES = {
  "partnerships.partners": { kind: "partner", title: "Partners", base: "partners", query: () => c.partners.PartnerListQuery, list: (q, s) => require("./partners.service").list(q, s), idOf: (r) => r.partner_id },
  "partnerships.leads": { kind: "lead", title: "Leads", base: "leads", query: () => c.leads.LeadListQuery, list: (q, s) => require("../leads/leads.service").list(q, s), idOf: (r) => r.lead_id },
  "partnerships.deals": { kind: "deal", title: "Deals", base: "partnership-deals", query: () => c.partner_pipeline.DealListQuery, list: (q, s) => require("../partner_pipeline/partner_pipeline.service").list(q, s), idOf: (r) => r.deal_id },
  "partnerships.analytics": { kind: "analytics", title: "Partnership Analytics", base: "partnership-analytics", query: () => c.partnership_analytics.AnalyticsQuery },
};

const HEALTH = { on_track: "On Track", follow_up_required: "Follow-Up Required", stalled: "Stalled" };
const RATING = { high: "High", medium: "Medium", low: "Low" };

/** MyCity's tracker columns, as its Master Tracker heads them. */
const COLUMNS = [
  { key: "sn", header: "S/N", width: 6 },
  { key: "name", header: "Partner Name", width: 30 },
  { key: "industry", header: "Industry", width: 18 },
  { key: "contact_person", header: "Contact Person", width: 22 },
  { key: "position", header: "Position", width: 18 },
  { key: "contact_details", header: "Contact Details", width: 30 },
  { key: "region", header: "Region", width: 20 },
  { key: "objective", header: "Partnership Objective", width: 34 },
  { key: "type", header: "Partnership Type", width: 18 },
  { key: "stage", header: "Partnership Stage", width: 22 },
  { key: "impact", header: "Potential Impact", width: 26 },
  { key: "owner", header: "Lead Owner", width: 20 },
  { key: "identified_on", header: "Date Identified", format: "date", width: 14 },
  { key: "current_stage", header: "Current Stage", width: 16 },
  { key: "next_action", header: "Next Action", width: 28 },
  { key: "expected_close_on", header: "Expected Close Date", format: "date", width: 14 },
  { key: "status", header: "Status", width: 18 },
  { key: "comments", header: "Comments", width: 40 },
];

/** A row's filters, checked by its list's own query without the page (the screen's filters as it holds them). */
function filtersOf(source, filters) {
  const query = SOURCES[source].query();
  const shape = source === "partnerships.analytics" ? query : query.omit({ page: true, sort: true });
  const parsed = shape.safeParse(filters || {});
  if (!parsed.success) throw new AppError("VALIDATION_FAILED", "Those filters cannot be exported", 422, { filters: parsed.error.issues.map((i) => i.message) });
  return parsed.data;
}

/** POST /partnerships/exports: reserve the file, made by the worker after commit. */
async function requestExport(actor, body) {
  const src = SOURCES[body.source];
  const filters = filtersOf(body.source, body.filters);
  const client = await pool.connect();
  try {
    return await require("../../shared/db/tx").atomically(client, async () => {
      const { EVENTS, EXPORT_DOC_TYPE } = require("./partners.events");
      const doc = await exportFiles.reserve(client, {
        doc_type: EXPORT_DOC_TYPE,
        entity: { type: EXPORT_DOC_TYPE, id: crypto.randomUUID() },
        file_name: exportFilename({ base: src.base, env: config.APP_ENV, extension: "xlsx" }),
        title: `${src.title} export`,
        actor,
      });
      await emit(client, {
        key: EVENTS.PARTNERSHIP_EXPORT_REQUESTED,
        entity: { type: doc.entity_type, id: doc.entity_id },
        actor,
        payload: { source: body.source, filters, requested_by: actor.user_id, document_id: doc.document_id },
      });
      return exportFiles.present(doc);
    });
  } finally {
    client.release();
  }
}

/** One record or deal in the tracker's columns, with its custom values under their labels. */
function rowOf(r, i, fields) {
  const impact = r.impact_labels || (r.impact_rating ? [RATING[r.impact_rating], r.impact_note].filter(Boolean).join(": ") : null);
  const out = {
    sn: i + 1,
    name: r.r_name,
    industry: r.r_industry,
    contact_person: [r.first_name, r.last_name].filter(Boolean).join(" ") || null,
    position: r.job_title,
    contact_details: [r.email, ...(r.phones || [])].filter(Boolean).join(", ") || null,
    region: r.r_region,
    objective: r.objective,
    type: r.category,
    stage: r.stage_label,
    impact,
    owner: r.owner_name,
    identified_on: r.identified_on,
    current_stage: null,
    next_action: r.next_action,
    expected_close_on: r.expected_close_on,
    status: r.deal_status === "lost" ? "Closed" : HEALTH[r.health] || null,
    comments: r.comments,
  };
  for (const f of fields) {
    const v = (f.applies_to === "deal" ? r.deal_custom : r.r_custom || {})?.[f.key];
    out[`custom_${f.key}`] = Array.isArray(v) ? v.join(", ") : v === true ? "Yes" : v === false ? "No" : (v ?? null);
  }
  return out;
}

/** Every record the filters match in the reader's scope, a page of 25 at a time, in the tracker's columns. */
async function gather(source, filters, scope) {
  const src = SOURCES[source];
  const ids = [];
  let page = await src.list({ ...filters, page: 1 }, scope);
  ids.push(...page.data.map(src.idOf));
  while (page.page.has_next && ids.length < EXPORT_CEILING) {
    page = await src.list({ ...filters, page: page.page.number + 1 }, scope);
    ids.push(...page.data.map(src.idOf));
  }
  const chosen = ids.slice(0, EXPORT_CEILING);
  const byId = new Map();
  for (let i = 0; i < chosen.length; i += 25) for (const r of await repo.trackerRows(pool, src.kind, chosen.slice(i, i + 25))) byId.set(String(r.row_id), r);
  const kinds = src.kind === "deal" ? ["lead", "partner", "deal"] : [src.kind, "deal"];
  const fields = (await require("../partner_pipeline/partner_pipeline.repo").listFields(pool, { active: true })).filter((f) => kinds.includes(f.applies_to));
  const rows = chosen.map((id) => byId.get(String(id))).filter(Boolean).map((r, i) => rowOf(r, i, fields));
  return { rows, fields, total: page.page.total, capped: page.page.total > EXPORT_CEILING };
}

/** Analytics' period as sheets, one a table of the screen (§6.18), in the asker's scope. */
async function analyticsSheets(filters, scope, reader) {
  const a = await require("../partnership_analytics/partnership_analytics.service").get(filters, scope, reader);
  const text = (k, header, width = 14) => ({ key: k, header, width });
  const num = (k, header) => ({ key: k, header, format: "int", width: 14 });
  const amount = (k, header) => ({ key: k, header, format: "money", width: 18 });
  const sheets = [
    {
      name: "By Lead Owner",
      columns: [text("owner", "Lead Owner", 26), num("new_prospects", "New Prospects Added"), num("meetings_held", "Meetings Held"), num("proposals_sent", "Proposals Sent"), num("partnerships_signed", "Partnerships Signed"), num("active_partnerships", "Active Partnerships Managed"), num("downloads", "Downloads Generated"), num("vendor_leads", "Vendor Leads Generated"), text("performance_rating", "Performance Rating")],
      rows: a.by_owner.map((o) => ({ ...o, owner: o.owner ? o.owner.display_name : "No Owner" })),
    },
    { name: "Signed per Month", columns: [text("month", "Month"), num("signed", "Signed"), amount("value", "Signed Value")], rows: a.signed_per_month },
  ];
  if (a.returns_per_month) sheets.push({ name: "Returns per Month", columns: [text("month", "Month"), amount("gross_sales", "Gross Sales"), amount("mycity_commission", "MyCity Commission"), num("downloads", "Downloads")], rows: a.returns_per_month });
  sheets.push(
    { name: "By Category", columns: [text("name", "Category", 22), num("open", "Open Deals"), num("signed", "Signed"), amount("value", "Signed Value")], rows: a.by_category },
    { name: "By Region", columns: [text("region", "Region", 22), num("open", "Open Deals"), num("signed", "Signed")], rows: a.by_region },
    { name: "Stage Conversion", columns: [text("from_label", "From", 26), text("to_label", "To", 26), num("moved", "Reached"), num("rate", "Rate %")], rows: a.stage_conversion },
  );
  return { sheets, period: a.period };
}

/** The outbox handler: the workbook made into the file the request reserved, in the asker's scope. */
async function buildExport(event, ctx) {
  const { buildWorkbook } = require("../../shared/spreadsheet/build");
  const { workbookContext } = require("../../shared/spreadsheet/context");
  const grantsCache = require("../../shared/rbac/grants-cache");
  const { scopeFor } = require("../../middleware/rbac");
  const p = event.payload || {};
  if (!p.document_id) return;
  const reader = await grantsCache.getAuthUser(pool, p.requested_by || event.actor_user_id);
  if (!reader || reader.status !== "active") return exportFiles.fail(p.document_id, "The person who asked is no longer active.");
  const scope = await scopeFor(reader, "partnerships", "export");
  if (!scope) return exportFiles.fail(p.document_id, "The person who asked can no longer export Partnerships.");
  const src = SOURCES[p.source];
  if (!src) return exportFiles.fail(p.document_id, "That list cannot be exported.");
  if (src.kind === "analytics") {
    return exportFiles.make(p.document_id, ctx, async () => {
      const { sheets, period } = await analyticsSheets(p.filters || {}, { scope: scope.scope, scope_ids: scope.scope_ids || null }, reader);
      return buildWorkbook({
        sheets: sheets.map((sh) => ({ ...sh, freeze: { y: 1 } })),
        context: workbookContext({ actor: { name: reader.display_name }, title: src.title, lines: [["Period", `${period.from} to ${period.to}`]] }),
        cover: true,
      });
    });
  }
  await exportFiles.make(p.document_id, ctx, async () => {
    const { rows, fields, total, capped } = await gather(p.source, p.filters || {}, { scope: scope.scope, scope_ids: scope.scope_ids || null });
    return buildWorkbook({
      sheets: [{ name: "Master Tracker", columns: [...COLUMNS, ...fields.map((f) => ({ key: `custom_${f.key}`, header: f.label, width: 20 }))], rows, freeze: { y: 1 } }],
      context: workbookContext({
        actor: { name: reader.display_name },
        title: src.title,
        lines: [[src.title, capped ? `The first ${rows.length} of ${total}.` : String(rows.length)]],
      }),
      cover: true,
    });
  });
}

module.exports = { SOURCES, COLUMNS, requestExport, gather, analyticsSheets, buildExport, rowOf };
