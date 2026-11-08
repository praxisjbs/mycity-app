"use strict";
/**
 * Generate Agreement (docs/guides/partnerships.md §6.8): the deal's category template of the kind
 * chosen (its default, or the one named), filled from the record, the contact, the deal, the
 * category's delivery checklist, the custom fields and the asks the person gave, numbered and saved
 * as a Draft with the template's version and the values it was filled with.
 *
 *   record fields   AGREEMENT_RECORD_FIELDS: the partner (or lead), its signatory contact, the deal,
 *                   `deal.options` as the options table, `category.checklist` as numbered clauses
 *   custom fields   `custom.<key>`: the record's and the deal's values of the category's fields
 *   asks            `ask.<key>`: what the person gave, else the ask's default
 *   kept            `signer.*`, filled when it is signed (§6.9); any field still empty, kept as its
 *                   chip so the Draft shows it and Submit names it
 *
 * The wording is filled through shared/documents/render.js fillMarkdown, so a value prints as written
 * but can never open or close a name. Renew drafts the next agreement the same way (§6.8).
 */
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const numbering = require("../../shared/numbering/numbering");
const money = require("../../shared/money/money");
const dayFirst = require("../../shared/time/day-first");
const lagos = require("../../shared/time/lagos");
const places = require("../../shared/places/places");
const profile = require("../../shared/organisation/profile");
const store = require("../../shared/templates/template-store");
const { fillMarkdown } = require("../../shared/documents/render");
const wording = require("../templates/templates.agreements");
const pipelineRepo = require("../partner_pipeline/partner_pipeline.repo");
const repo = require("./agreements.repo");
const { EVENTS, ENTITY } = require("./agreements.events");

const refused = (code, message, status = 409, fields) => new AppError(code, message, status, fields);

/** The kinds in the order Generate Agreement offers them when none is named. */
const KIND_ORDER = ["deal_merchant", "mou", "service_agreement", "contract"];

/** The category template an agreement is generated from: the one named, else the default of the kind. */
async function templateFor(db, categoryId, { kind = null, template_key: key = null } = {}) {
  const all = (await pipelineRepo.templatesOf(db, categoryId)).filter((t) => t.active);
  const pick = key
    ? all.find((t) => t.template_key === key)
    : kind
      ? all.find((t) => t.kind === kind && t.is_default) || all.find((t) => t.kind === kind)
      : KIND_ORDER.map((k) => all.find((t) => t.kind === k && t.is_default)).find(Boolean) || all[0];
  if (!pick)
    throw refused("NO_TEMPLATE", "This category has no agreement template of that kind. Add one on Categories.", 409, {
      [key ? "template_key" : "kind"]: ["No template"],
    });
  return pick;
}

/** The template a category template's key names, as written at `version` (the current one when null). */
async function wordingOf(db, key, version = null) {
  wording.declare(key);
  const t = version === null || version === undefined ? await store.current(db, "document", key) : await store.version(db, "document", key, version);
  if (!t) throw refused("TEMPLATE_MISSING", "This agreement's template has no wording yet. Write it on Categories.");
  const body = t.format === "markdown" ? t.body : require("../../shared/documents/markdown").htmlToMarkdown(t.body, { tables: true });
  return { version: Number(t.version), body };
}

const naira = (v) => (v === null || v === undefined || v === "" ? "" : money.formatNaira(v));

/**
 * The options table as the Deal Merchant Agreement lays it out (§6.6): a column per option, a row per
 * term. A price that is not money (App Download, Free Entry) is its note.
 */
function optionsGrid(options) {
  if (!options || options.length === 0) return { head: [], rows: [] };
  const by = (f) => options.map(f);
  return {
    head: ["", ...by((o) => o.label)],
    rows: [
      ["Original Price", ...by((o) => naira(o.original_price))],
      ["Discount", ...by((o) => (o.discount_pct === null || o.discount_pct === undefined ? "" : `${Number(o.discount_pct)}%`))],
      ["Deal Price", ...by((o) => (o.deal_price !== null && o.deal_price !== undefined ? naira(o.deal_price) : o.price_note || ""))],
      ["MyCity's Commission per Sale", ...by((o) => naira(o.commission_amount))],
      ["Merchant's Take per Sale", ...by((o) => naira(o.merchant_take))],
    ],
  };
}

/** "30 days", "60 days", or the validity's date for a deal running to one. */
function validityLabel(deal) {
  if (deal.validity_days) return `${deal.validity_days} days`;
  if (deal.valid_until) return `Until ${dayFirst.formatLongDate(deal.valid_until)}`;
  return null;
}

/** Text a template prints for a custom value, by its field's type. */
function customText(field, v) {
  if (v === null || v === undefined || v === "") return null;
  if (field.field_type === "money") return String(v);
  if (field.field_type === "yes_no") return v === true ? "Yes" : v === false ? "No" : String(v);
  if (Array.isArray(v)) return v.join(", ");
  return v;
}

/** The record's region in words: its cities, or National, Africa, Worldwide. */
async function regionOf(db, facts) {
  const kind = facts.partner_id ? "partner" : "lead";
  const { rows } = await db.query(
    `SELECT ${pipelineRepo.regionLabel(`r.region_scope`, `${kind}.cities`, `r.${kind}_id`)} AS label
       FROM ${kind} r WHERE r.${kind}_id = $1`,
    [facts.partner_id || facts.lead_id],
  );
  return rows[0] ? rows[0].label : null;
}

/**
 * Every value a category template may name, for one deal, nested as the template reads them.
 * @returns {Promise<{data: object, fields: Record<string, unknown>}>}
 *   data    the values for fillMarkdown, `deal.options` and `category.checklist` as blocks
 *   fields  the values as kept on the agreement (`partner.name` → "Harbour Lights"), scalar only
 */
async function valuesFor(db, facts, template, asks = {}) {
  const org = await profile.readProfile(db);
  const contact = await repo.signatoryOf(db, facts);
  const hq = facts.partner_id ? await places.view(db, "partner.headquarters", facts.partner_id) : null;
  const region = await regionOf(db, facts);
  const opts = await pipelineRepo.options(db, facts.deal_id);
  const checklist = (await pipelineRepo.checklistOf(db, facts.partner_category_id)).filter((i) => i.active).map((i) => i.title);
  const custom = await pipelineRepo.listFields(db, { partner_category_id: facts.partner_category_id, active: true });
  const recordCustom = facts.record_custom || {};
  const dealCustom = facts.deal_custom || {};

  const fields = {
    today: lagos.today(),
    "org.name": profile.displayName(org),
    "partner.name": facts.record_name,
    "partner.legal_name": facts.legal_name || null,
    "partner.headquarters": hq ? hq.formatted : null,
    "partner.region": region,
    "contact.full_name": contact ? contact.full_name : null,
    "contact.title": contact ? contact.job_title : null,
    "contact.phones": contact && contact.phones.length ? contact.phones.join(", ") : null,
    "contact.email": contact ? contact.email : null,
    "deal.title": facts.title,
    "deal.event_title": facts.event_title || null,
    "deal.event_starts_on": facts.event_starts_on || null,
    "deal.event_ends_on": facts.event_ends_on || null,
    "deal.objective": facts.objective || null,
    "deal.expected_attendance": facts.expected_attendance === null || facts.expected_attendance === undefined ? null : Number(facts.expected_attendance),
    "deal.comments": facts.comments || null,
    "deal.valid_until": facts.valid_until || null,
    "deal.validity_label": validityLabel(facts),
  };
  for (const f of custom) {
    const v = f.applies_to === "deal" ? dealCustom[f.key] : recordCustom[f.key];
    fields[`custom.${f.key}`] = customText(f, v);
  }
  for (const a of template.asks || []) {
    const given = Object.hasOwn(asks, `ask.${a.key}`) ? asks[`ask.${a.key}`] : Object.hasOwn(asks, a.key) ? asks[a.key] : undefined;
    fields[`ask.${a.key}`] = given === undefined || given === "" ? (a.default ?? null) : given;
  }
  const data = nest(fields);
  data.deal = { ...data.deal, options: optionsGrid(opts) };
  data.category = { checklist };
  return { data, fields };
}

/** `{ "deal.title": "x" }` → `{ deal: { title: "x" } }`. */
function nest(flat) {
  const out = {};
  for (const [k, v] of Object.entries(flat)) {
    const parts = k.split(".");
    let at = out;
    for (const p of parts.slice(0, -1)) at = at[p] = at[p] && typeof at[p] === "object" ? at[p] : {};
    at[parts[parts.length - 1]] = v;
  }
  return out;
}

/** The wording filled for Draft: every value in, `signer.*` and any empty field kept as its chip. */
const fill = (body, data) => fillMarkdown(body, data, { keep: ["signer"], keepEmpty: true });

/** Its title: the template's label and what it is about ("Deal Merchant Agreement: Harbour Lights Festival"). */
const titleOf = (template, facts) => `${template.label}: ${facts.event_title || facts.title}`.slice(0, 200);

/**
 * Write a Draft for a deal, in the caller's transaction (Generate Agreement, Renew).
 * @param {import("pg").PoolClient} client
 * @param {object} actor
 * @param {object} facts  repo.dealFacts()
 * @param {object} opts   { kind, template_key, asks, starts_on, ends_on, renews_agreement_id, renewal_notice_days }
 * @returns {Promise<string>} the agreement's id
 */
async function draftIn(client, actor, facts, opts = {}) {
  if (facts.status === "lost") throw refused("DEAL_LOST", "This deal is lost. Reopen it before you write its agreement.");
  const template = await templateFor(client, facts.partner_category_id, opts);
  const written = await wordingOf(client, template.template_key);
  const { data, fields } = await valuesFor(client, facts, template, opts.asks || {});
  const day = lagos.today();
  const { number } = await numbering.allocate(client, "agreement", { date: day });
  const id = await repo.insert(client, {
    partner_id: facts.partner_id || null,
    lead_id: facts.partner_id ? null : facts.lead_id,
    partnership_opportunity_id: facts.deal_id,
    number,
    title: titleOf(template, facts),
    status: "draft",
    kind: template.kind,
    template_key: template.template_key,
    template_version: written.version,
    fields,
    body: fill(written.body, data),
    starts_on: opts.starts_on || null,
    ends_on: opts.ends_on === undefined ? facts.valid_until || null : opts.ends_on,
    value: facts.estimated_value === null || facts.estimated_value === undefined ? null : money.toWire(facts.estimated_value),
    currency: facts.currency || money.CURRENCY,
    owner_id: facts.owner_id,
    renewal_notice_days: opts.renewal_notice_days ?? 90,
    renews_agreement_id: opts.renews_agreement_id || null,
  });
  await emit(client, {
    key: EVENTS.AGREEMENT_GENERATED,
    entity: { type: ENTITY, id },
    actor,
    after: { number, kind: template.kind, template_key: template.template_key, template_version: written.version },
    payload: { partnership_agreement_id: id, number, deal_id: facts.deal_id, renews_agreement_id: opts.renews_agreement_id || null },
  });
  return id;
}

/**
 * The record's values again, for a Draft's chips still empty after the record or the asks changed:
 * the values kept, the new ones over them, then the chips filled.
 */
async function refillIn(client, a, given) {
  const facts = await repo.dealFacts(client, a.deal_id);
  const template = (await pipelineRepo.templatesOf(client, facts.partner_category_id)).find((t) => t.template_key === a.template_key) || { asks: [] };
  const fresh = await valuesFor(client, facts, template, {});
  const kept = Object.fromEntries(Object.entries(a.fields || {}).filter(([, v]) => v !== null && v !== undefined && v !== ""));
  const fields = { ...fresh.fields, ...kept, ...given };
  const data = nest(fields);
  data.deal = { ...data.deal, options: fresh.data.deal.options };
  data.category = fresh.data.category;
  return { fields, body: fill(a.body || "", data) };
}

module.exports = { templateFor, wordingOf, valuesFor, optionsGrid, validityLabel, nest, fill, titleOf, draftIn, refillIn };
