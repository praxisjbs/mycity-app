"use strict";
/**
 * What the screen shows for an answer (docs/guides/praxis-ai.md §6.4, §6.11, §6.13), from the
 * model's draft and the reads the question made. Nothing the model typed becomes a figure: a
 * table's cells are the named read's own rows, the screen button is one of the routes offered
 * this question, the citations are the records the reads returned (shared/ai/cite.js), the
 * Overview's figures and chart are a summary's own, and a card's values are checked against the
 * action's schema and the person's rights before anyone sees them.
 *
 *   const shown = answer.build({ draft, reads, routes, screens, shows });
 *   // → { content, table, link, citations, citations_total, sources, reads, declined, more, overview,
 *   //     rows_read, module_key, metadata, stored_citations, stored_reads }
 *   const card = await answer.draftCard({ draft, actions, actor, context });   // null when none
 */
const { mergeCitations, linkOfRef, sourcesOf } = require("../../../shared/ai/cite");
const routeMap = require("../../../shared/route-map");
const authorise = require("../../../shared/ai/authorise");
const { contractNameOf, shapeOf } = require("../../../shared/ai/manifest");
const { formatDate, formatDateTime } = require("../../../shared/time/day-first");
const { formatNaira } = require("../../../shared/money/money");
const { jsonSchemaOf } = require("../structured");
const { placeholdersIn } = require("../drafts");
const { logger } = require("../../../config/logger");
const engine = require("../engine");

const MAX_CITATIONS = 50;
const MAX_COLUMNS = 12;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const MONEY = /^-?\d{1,16}\.\d{2}$/;
/** Fields named like an amount: a two-place string there is naira. */
const MONEY_FIELD = /(amount|total|salary|cost|price|fee|balance|pay|ngn|naira|budget|spend|deduction|value)/i;

/** One cell for a person to read, and whether it right-aligns. */
function cell(field, v) {
  if (v === null || v === undefined || v === "") return { text: "", numeric: false };
  if (typeof v === "number") return { text: String(v), numeric: true };
  if (typeof v === "boolean") return { text: v ? "Yes" : "No", numeric: false };
  if (typeof v !== "string") return null;
  if (ISO_DATE.test(v)) return { text: formatDate(v), numeric: false };
  if (ISO_INSTANT.test(v) && !Number.isNaN(Date.parse(v))) return { text: formatDateTime(v), numeric: false };
  if (MONEY.test(v) && MONEY_FIELD.test(field)) return { text: formatNaira(v), numeric: true };
  return { text: v, numeric: false };
}

/**
 * A table from rows: the fields named, with their labels; a field the rows do not carry, or that
 * holds a list or an object, is left out; no field left is no table. `refs` are each row's record.
 */
function drawTable(rows, refs, fields, labels = []) {
  if (!rows || !rows.length) return null;
  const cols = [];
  fields.forEach((f, i) => {
    if (cols.some((c) => c.field === f)) return;
    const values = rows.map((row) => (row && Object.prototype.hasOwnProperty.call(row, f) ? cell(f, row[f]) : undefined));
    if (values.some((v) => v === undefined || v === null)) return;
    cols.push({ field: f, label: labels[i] || engine.cards.humanise(f), values });
  });
  if (!cols.length) return null;
  return {
    columns: cols.map((c) => c.label),
    fields: cols.map((c) => c.field),
    rows: rows.map((_, r) => cols.map((c) => c.values[r].text)),
    numeric: cols.map((c, i) => (c.values.some((v) => v.text !== "") && c.values.every((v) => v.text === "" || v.numeric) ? i : -1)).filter((i) => i >= 0),
    refs: rows.map((_, r) => (refs && refs[r]) || null),
  };
}

/** The first scalar fields of a row, for a table nobody named columns for (the Table pane's replay). */
function defaultFields(rows) {
  const first = rows.find((r) => r && typeof r === "object") || {};
  return Object.keys(first)
    .filter((k) => !/_id$|^id$|_at$/.test(k) || /_on$|due_at|created_at/.test(k))
    .filter((k) => cell(k, first[k]) !== null)
    .slice(0, MAX_COLUMNS);
}

/**
 * The table the draft asked for, drawn from the read's rows, with each row's record (`refs`, kept in
 * the answer's metadata; its link is worked out when shown, presentTable), and which read and fields
 * it came from, so the Table pane pages it again (§6.12).
 */
function tableOf(spec, reads) {
  if (!spec) return null;
  const read = reads.find((r) => r.n === spec.read && r.ok && r.kind !== "summary");
  if (!read || !read.rows.length) return null;
  const t = drawTable(read.rows, read.refs, spec.fields, spec.labels);
  return t ? { ...t, read: read.n } : null;
}

/** A kept table as the screen shows it: each row's record as a link, worked out now. */
function presentTable(t) {
  if (!t) return null;
  const refs = Array.isArray(t.refs) ? t.refs : [];
  return { columns: t.columns, rows: t.rows, numeric: t.numeric, links: t.rows.map((_, i) => linkOfRef(refs[i])), read: t.read || null };
}

/** Citations grouped by record type, in the order first cited. */
function groupsOf(citations) {
  const out = new Map();
  for (const c of citations) {
    const g = out.get(c.entity_type);
    if (g) g.count += 1;
    else out.set(c.entity_type, { entity_type: c.entity_type, count: 1 });
  }
  return [...out.values()];
}

/** The values of a prefill its route's schema takes, each checked on its own; never one of the route's params. */
function prefillOf(route, values) {
  if (!route.prefill || !values || typeof values !== "object") return {};
  const shape = shapeOf(route.prefill) || {};
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    if (!Object.prototype.hasOwnProperty.call(shape, k) || (route.params && k in route.params)) continue;
    // A list of plain values (New Event's attendees) travels as one comma-separated value.
    if (Array.isArray(v) && v.length && v.every((x) => typeof x === "string" && !x.includes(","))) {
      if (shape[k].safeParse(v).success) out[k] = v.join(",");
      continue;
    }
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
    if (!shape[k].safeParse(v).success) continue;
    out[k] = String(v);
  }
  return out;
}

/** The screen button: one of the offered routes, by its intent. */
function linkOf(intent, values, routes, screens) {
  if (!intent) return null;
  const want = String(intent).trim().toLowerCase();
  const route = routes.find((r) => r.intent.toLowerCase() === want);
  if (!route) return null;
  const screen = screens.find((s) => s.module === route.module && s.tab === route.tab);
  const name = screen ? screen.label : route.tab;
  const params = { ...prefillOf(route, values), ...(route.params || {}) };
  return {
    label: name.split(/\s+/).length <= 2 ? `Open ${name}` : name,
    path: routeMap.screenPath(route.module, route.tab, { params }),
  };
}

/** The reads as the wire and History carry them (AiReadMade), from the pane's sources. */
const readsMade = (sources) => sources.map(({ n, key, kind, module_key, params, outcome, rows, total, first, masked }) => ({ n, key, kind, module_key, params, outcome, rows, total, first, masked: Array.isArray(masked) ? masked : [] }));

/**
 * @param {{draft: object, reads: Array<object>, routes: Array<object>, screens: Array<object>, shows?: string[]}} q
 */
function build({ draft, reads, routes, screens, shows = [] }) {
  const wants = new Set(shows);
  const ok = reads.filter((r) => r.ok);
  const table = tableOf(draft.table, reads);
  const link = linkOf(draft.route, draft.prefill, routes, screens);
  const all = mergeCitations(ok.map((r) => r.citations || [])).map((c) => ({
    entity_type: c.type,
    entity_id: c.id,
    label: c.label || c.type,
    link: c.link,
    read_key: c.read,
  }));
  const citations = all.slice(0, MAX_CITATIONS);
  const sources = sourcesOf(groupsOf(all), all.length === 1 ? all[0] : null);
  let declined = null;
  if (link) declined = "change";
  else if (reads.some((r) => r.declined) && !ok.length) declined = "not_available";
  const stored = engine.pane.sourcesOf(reads);
  const madeReads = readsMade(stored);
  const more = Boolean(draft.more) && ok.some((r) => r.page && r.page.has_next);
  const overview = wants.has("pane") ? engine.pane.overviewOf(draft.overview, reads) : null;
  const shown = {
    content: draft.text,
    table: presentTable(table),
    link,
    citations,
    citations_total: all.length,
    sources,
    reads: madeReads,
    declined,
    more,
    overview,
    rows_read: ok.filter((r) => r.kind !== "summary").reduce((n, r) => n + r.rows.length, 0),
    module_key: ok.length ? ok[0].module : null,
  };
  // What is kept on the answer's message, for History and the next turn's replay, and every
  // citation, whose count History shows beside the first fifty; each read for ai_message_read.
  shown.metadata = { table, link, reads: madeReads, declined, more, overview };
  shown.stored_citations = all;
  shown.stored_reads = stored;
  return shown;
}

/** A field problem the person fixes on the card, at most four words (gate 12). */
const FILL_THE_GAP = "Fill the gap";

/**
 * The words a card carries, held to "ready to send" as the mailbox's Write With AI holds a draft
 * (services/ai/drafts.js; decision 19): a gap left to fill (a bracket, "insert here", XXX, a
 * blank line) or a redaction token that stands for nothing is a problem on its field, so a mail
 * or a message with a placeholder never leaves on one press.
 * @param {object} values
 * @returns {Record<string, string[]>}
 */
function gapsIn(values) {
  const out = {};
  for (const [k, v] of Object.entries(values || {})) {
    if (typeof v !== "string") continue;
    if (placeholdersIn(v).length) out[k] = [FILL_THE_GAP];
  }
  return out;
}

/**
 * The card the draft asked for (§6.11 steps 1 and 2), or null: the action must be one offered
 * this turn, the person's rights are checked again, the values are parsed with the action's
 * schema, problems kept by field, the records listed (named through the action's own module
 * when a database handle is given), the bulk limit held, and every text held to ready to send.
 * What comes back is the row to store (ai_action_draft) and the fields the card shows.
 * @param {{draft: object, actions: Array<object>, actor: object, context?: object|null, db?: {query: Function}|null, now?: number}} q
 */
async function draftCard({ draft, actions, actor, context = null, db = null, now = Date.now() }) {
  const want = draft && draft.action;
  if (!want || !want.key) return null;
  const action = (actions || []).find((a) => a.key === want.key);
  if (!action) {
    logger.info({ ai_action: want.key }, "Praxis AI: the model named an action that was not offered; no card");
    return null;
  }
  const fieldNames = Object.keys(shapeOf(action.input) || {});
  const values = engine.cards.fillFromContext(want.values && typeof want.values === "object" ? want.values : {}, fieldNames, context);
  let checked;
  try {
    checked = await authorise.checkAction(actor, action.key, values, db);
  } catch (err) {
    if (err && (err.code === "AI_ACTION_FORBIDDEN" || err.code === "TOO_MANY_RECORDS" || err.code === "AI_ACTION_UNKNOWN")) {
      logger.info({ ai_action: want.key, code: err.code }, "Praxis AI: a card was refused at the draft");
      return null;
    }
    throw err;
  }
  const gaps = gapsIn(checked.values);
  if (Object.keys(gaps).length) checked = { ...checked, ok: false, problems: { ...checked.problems, ...gaps } };
  const card = engine.cards.draft({ action, fieldNames, values, suggested: want.suggested === true, checked, now });
  return {
    row: {
      action_key: action.key,
      module_key: action.module,
      risk: action.risk,
      values: card.values,
      problems: card.problems,
      records: card.records,
      suggested: card.suggested,
      status: card.status,
      expires_at: card.expires_at,
    },
    action,
    fields: engine.cards.fieldsOf(jsonSchemaOf(action.input), action.labels),
    schema: contractNameOf(action.input),
    confirm: card.confirm,
  };
}

module.exports = { build, draftCard, gapsIn, tableOf, drawTable, defaultFields, presentTable, groupsOf, linkOf, prefillOf, cell, readsMade, MAX_CITATIONS, MAX_COLUMNS, FILL_THE_GAP };
