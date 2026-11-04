"use strict";
/**
 * What the screen shows for an answer (docs/guides/praxis-ai.md §6.4, §6.11, §6.13), from the
 * model's draft and the reads the question made. Nothing the model typed becomes a figure: a
 * table's cells are the named read's own rows, the screen button is one of the routes offered
 * this question, the citations are the records the reads returned (shared/ai/cite.js), the
 * Overview's figures and chart are a summary's own, and a card's values are checked against the
 * action's schema and the person's rights before anyone sees them.
 *
 *   const asked = answer.askFirst({ draft, actions, history, shows, now });   // the draft, or its question instead
 *   const shown = answer.build({ draft: asked, reads, routes, screens, shows });
 *   // → { content, table, link, citations, citations_total, sources, reads, declined, more, overview,
 *   //     choices, rows_read, module_key, metadata, stored_citations, stored_reads }
 *   const card = await answer.draftCard({ draft: asked, actions, actor, context });   // null when none
 */
const { mergeCitations, linkOfRef, sourcesOf } = require("../../../shared/ai/cite");
const routeMap = require("../../../shared/route-map");
const authorise = require("../../../shared/ai/authorise");
const { contractNameOf, shapeOf } = require("../../../shared/ai/manifest");
const { formatDate, formatDateTime } = require("../../../shared/time/day-first");
const lagos = require("../../../shared/time/lagos");
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
/** A record's id: never a cell a person reads. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The keys a row names its own record by, the most telling first, and the column each makes. */
const NAME_KEYS = Object.freeze(["display_name", "full_name", "name", "title", "subject", "number"]);
const NAME_LABELS = Object.freeze({ display_name: "Name", full_name: "Name", name: "Name", title: "Title", subject: "Subject", number: "Number" });
/** Where a row holds the person it is about (a register's `employee`), looked at before any other record it holds. */
const PERSON_KEYS = Object.freeze(["employee", "person", "colleague", "requester", "member", "assignee", "owner", "user"]);
/** A field whose value is a code (a status, a kind, a pattern), and a code as the database writes one ("not_in"). */
const CODE_FIELD = /(^|_)(status|state|kind|type|pattern|priority|stage|outcome|mode|level|category|cadence|risk|decision|verdict|channel|source)$/i;
const CODE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** A field's last part: "employee.display_name" → "display_name". */
const lastOf = (field) => String(field).split(".").pop();

/** A code in words: "not_in" → "Not In", "remote" → "Remote". */
const wordsOf = (code) =>
  code
    .split("_")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

/** The value at a field of a row, a dotted field reaching into it ("employee.display_name"); undefined when the row has none. */
function valueAt(row, field) {
  let v = row;
  for (const k of String(field).split(".")) {
    if (v === null || typeof v !== "object" || Array.isArray(v) || !Object.prototype.hasOwnProperty.call(v, k)) return undefined;
    v = v[k];
  }
  return v;
}

/** A record's name as a person reads it, from the first of its name keys that holds one; null when it has none. */
function nameOf(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  for (const k of NAME_KEYS) {
    const x = v[k];
    if ((typeof x === "string" && x.trim()) || typeof x === "number") return String(x).trim();
  }
  return null;
}

/** One cell for a person to read, and whether it right-aligns; null for a value no person reads (an id, a record with no name). */
function cell(field, v) {
  if (v === null || v === undefined || v === "") return { text: "", numeric: false };
  if (typeof v === "number") return { text: String(v), numeric: true };
  if (typeof v === "boolean") return { text: v ? "Yes" : "No", numeric: false };
  if (Array.isArray(v)) return listCell(field, v);
  if (typeof v === "object") {
    const name = nameOf(v);
    return name ? { text: name, numeric: false } : null;
  }
  if (typeof v !== "string" || UUID.test(v)) return null;
  if (ISO_DATE.test(v)) return { text: formatDate(v), numeric: false };
  if (ISO_INSTANT.test(v) && !Number.isNaN(Date.parse(v))) return { text: formatDateTime(v), numeric: false };
  if (MONEY.test(v) && MONEY_FIELD.test(field)) return { text: formatNaira(v), numeric: true };
  if (CODE.test(v) && CODE_FIELD.test(lastOf(field))) return { text: wordsOf(v), numeric: false };
  return { text: v, numeric: false };
}

/** A list in one cell, its names or plain values comma-separated; null when an item is neither. */
function listCell(field, list) {
  const parts = [];
  for (const item of list) {
    const c = Array.isArray(item) ? null : cell(field, item);
    if (!c) return null;
    if (c.text) parts.push(c.text);
  }
  return { text: parts.join(", "), numeric: false };
}

/**
 * Who or what each row is: the row's own name (a task's title, an employee's name), else the person
 * it is about (a register's or a leave request's `employee`), else its number, else the first record
 * it holds with a name. Null when the rows name nothing (a person's own days).
 */
function whoOf(rows) {
  const first = rows.find((r) => r && typeof r === "object" && !Array.isArray(r));
  if (!first) return null;
  const own = (k) => typeof first[k] === "string" && first[k].trim() && !UUID.test(first[k]);
  const named = NAME_KEYS.find((k) => k !== "number" && own(k));
  if (named) return { field: named, label: NAME_LABELS[named] };
  const person = PERSON_KEYS.find((p) => nameOf(first[p]) || own(p));
  if (person) return { field: person, label: engine.cards.humanise(person) };
  if (own("number") || typeof first.number === "number") return { field: "number", label: NAME_LABELS.number };
  const held = Object.keys(first).find((k) => nameOf(first[k]));
  return held ? { field: held, label: engine.cards.humanise(held) } : null;
}

/** Whether a column already says who each row is: the field `whoOf` found, or a name reached through it ("employee.display_name"). */
function namesRows(field, who) {
  if (field === who.field) return true;
  if (field.startsWith(`${who.field}.`)) return NAME_KEYS.includes(lastOf(field));
  return !who.field.includes(".") && NAME_KEYS.includes(who.field) && NAME_KEYS.includes(field);
}

/** A column's label from its field when the model gave none: a name reached into a record reads as that record ("employee.display_name" → "Employee"). */
function labelOf(field) {
  const parts = String(field).split(".");
  if (parts.length > 1 && NAME_KEYS.includes(parts[parts.length - 1])) return engine.cards.humanise(parts[parts.length - 2]);
  return engine.cards.humanise(parts[parts.length - 1]);
}

/**
 * A table from rows: the fields named, each reaching into a row with a dot where it must, with their
 * labels; a field the rows do not carry, or whose value no person reads (an id, a record with no
 * name, a list of either), is left out; no field left is no table. A table names its records
 * (docs/guides/praxis-ai.md §6.4): when no column says who or what each row is, the row's name goes
 * first. `refs` are each row's record.
 */
function drawTable(rows, refs, fields, labels = []) {
  if (!rows || !rows.length) return null;
  const cols = [];
  (fields || []).forEach((f, i) => {
    if (typeof f !== "string" || !f || cols.some((c) => c.field === f)) return;
    const values = rows.map((row) => {
      const v = valueAt(row, f);
      return v === undefined ? undefined : cell(f, v);
    });
    if (values.some((v) => v === undefined || v === null)) return;
    cols.push({ field: f, label: labels[i] || labelOf(f), values });
  });
  if (!cols.length) return null;
  const who = whoOf(rows);
  if (who && !cols.some((c) => namesRows(c.field, who))) {
    cols.unshift({ field: who.field, label: who.label, values: rows.map((row) => cell(who.field, valueAt(row, who.field)) || { text: "", numeric: false }) });
  }
  return {
    columns: cols.map((c) => c.label),
    fields: cols.map((c) => c.field),
    rows: rows.map((_, r) => cols.map((c) => c.values[r].text)),
    numeric: cols.map((c, i) => (c.values.some((v) => v.text !== "") && c.values.every((v) => v.text === "" || v.numeric) ? i : -1)).filter((i) => i >= 0),
    refs: rows.map((_, r) => (refs && refs[r]) || null),
  };
}

/** A row's own fields a person reads, who it is first, for a table nobody named columns for (the Table pane's replay). */
function defaultFields(rows) {
  const first = rows.find((r) => r && typeof r === "object") || {};
  const who = whoOf(rows);
  const own = Object.keys(first)
    .filter((k) => !/_ids?$|^id$|_at$/.test(k) || /_on$|due_at|created_at/.test(k))
    .filter((k) => cell(k, first[k]) !== null);
  return [...new Set([...(who ? [who.field] : []), ...own])].slice(0, MAX_COLUMNS);
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
  const ask = askOf(draft.ask);
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
    choices: ask ? ask.choices : [],
    rows_read: ok.filter((r) => r.kind !== "summary").reduce((n, r) => n + r.rows.length, 0),
    module_key: ok.length ? ok[0].module : null,
  };
  // What is kept on the answer's message, for History and the next turn's replay, and every
  // citation, whose count History shows beside the first fifty; each read for ai_message_read.
  // A question keeps what it asked for, so the next answer's guard does not ask it again (askFirst).
  shown.metadata = { table, link, reads: madeReads, declined, more, overview, ask };
  shown.stored_citations = all;
  shown.stored_reads = stored;
  return shown;
}

/** At most this many answers to tap under a question (AiAnswer.choices). */
const MAX_CHOICES = 6;

/**
 * A question's ask as it is kept and shown (decision 28): its answers to tap, trimmed, each once,
 * at most six of 60 characters; what it asks for when that is an action's field. Null when the
 * answer asks nothing.
 */
function askOf(ask) {
  if (!ask || typeof ask !== "object") return null;
  const choices = [...new Set((Array.isArray(ask.choices) ? ask.choices : []).map((c) => String(c).trim()).filter((c) => c && c.length <= 60))].slice(0, MAX_CHOICES);
  const action = typeof ask.action === "string" && ask.action ? ask.action : null;
  const field = typeof ask.field === "string" && ask.field ? ask.field : null;
  if (!choices.length && !action) return null;
  return { action, field, choices };
}

/**
 * The questions asked in a row just before this answer, newest first: each answer of the
 * conversation's replay that asked for an action's field, back to the last one that did not.
 * @param {Array<{ask?: {action: string|null, field: string|null}|null}>} history  oldest first
 */
function askedRun(history) {
  const run = [];
  for (let i = (history || []).length - 1; i >= 0; i -= 1) {
    const ask = history[i] && history[i].ask;
    if (!ask || !ask.action) break;
    run.push({ action: ask.action, field: ask.field || null });
  }
  return run;
}

/**
 * A question the model asked for one of an offered action's fields, with that field's own answers
 * to tap from the action's `asks` when it gave none (§6.4): "How urgent is it?" always has Low,
 * Normal, High and Urgent under it. Any other draft is returned as it came.
 * @param {object} draft
 * @param {Array<object>} actions  the actions offered this turn
 * @param {Date} now
 */
function withChoices(draft, actions, now) {
  const ask = draft && draft.ask;
  if (!ask || typeof ask !== "object" || !ask.action || !ask.field) return draft;
  if (Array.isArray(ask.choices) && ask.choices.some((c) => String(c).trim())) return draft;
  const action = (actions || []).find((a) => a.key === ask.action);
  const entry = action && Array.isArray(action.asks) ? action.asks.find((a) => a.field === ask.field) : null;
  if (!entry || !entry.choices) return draft;
  const choices = typeof entry.choices === "function" ? entry.choices({ today: lagos.today(now) }) : entry.choices;
  return { ...draft, ask: { ...ask, choices: [...new Set(choices.map((c) => String(c).trim()).filter(Boolean))].slice(0, MAX_CHOICES) } };
}

/**
 * A record question's answers (decision 34): the first rows of the ask's list read, run with the
 * person's own rights, as their citations read, of the ask's citation type when it names one.
 */
async function recordChoices(db, actor, entry) {
  const r = await authorise.runRead(db, actor, entry.read, { ...entry.params, page: 1 });
  return (r.citations || []).filter((cite) => cite && cite.label && (!entry.type || cite.type === entry.type)).map((cite) => cite.label);
}

/**
 * A question for one of an offered action's fields whose answers are read from the person's own
 * records (an ask's `options`: Request Leave's types with the days left of each, decision 32; an
 * ask's `read`: which task, which request, decision 34), with those answers to tap. The service
 * calls it after `askFirst`, with the asking person, a database and the values the model drafted;
 * the engine never reads. A question the model gave its own answers keeps them; a read that fails
 * leaves the question as it was.
 * @param {object} draft
 * @param {Array<object>} actions  the actions offered this turn
 * @param {{actor?: object, db?: {query: Function}|null, now?: Date, values?: object}} [ctx]
 */
async function withOptions(draft, actions, { actor = null, db = null, now = new Date(), values = {} } = {}) {
  const ask = draft && draft.ask;
  if (!ask || typeof ask !== "object" || !ask.action || !ask.field || !actor || !db) return draft;
  // The model's own answers to tap stand ("Which Tunde?" with the two it found), as withChoices keeps them.
  if (Array.isArray(ask.choices) && ask.choices.some((c) => String(c).trim())) return draft;
  const action = (actions || []).find((a) => a.key === ask.action);
  const entry = action && Array.isArray(action.asks) ? action.asks.find((a) => a.field === ask.field) : null;
  if (!entry || (typeof entry.options !== "function" && !entry.read)) return draft;
  try {
    // The person's own records, as the action's grant reaches them (decision 34): never more than they may open.
    const who = await authorise.scopedFor(actor, action);
    if (!who) return draft;
    const listed = entry.read
      ? await recordChoices(db, actor, entry)
      : await entry.options({ actor: who, db, today: lagos.today(now), values: values && typeof values === "object" ? values : {} });
    const choices = [...new Set((Array.isArray(listed) ? listed : []).map((c) => String(c).trim()).filter((c) => c && c.length <= 60))].slice(0, MAX_CHOICES);
    return choices.length ? { ...draft, ask: { ...ask, choices } } : draft;
  } catch (err) {
    logger.warn({ err, ai_action: action.key, field: ask.field }, "Praxis AI: an ask's options could not be read; its question has none to tap");
    return draft;
  }
}

/**
 * The server's half of decision 29: a card the person asked for is drawn only once its action has
 * what its `asks` name. When the model drafted one with a field left out, the answer becomes that
 * question instead (its words, its choices, what it asks for), with no card, table or screen
 * button; each field is asked once in a run of questions, and the run stops after six, so asking
 * never loops. A suggested card, an action not offered and a screen that draws no card are left
 * as they are. The screen asked from fills its record's field before anything is found missing.
 * @param {{draft: object, actions: Array<object>, history?: Array<object>, shows?: string[], now?: Date, context?: object|null}} q
 * @returns {object} the draft, or the question that replaces it
 */
function askFirst({ draft, actions, history = [], shows = [], now = new Date(), context = null }) {
  const given = withChoices(draft, actions, now);
  const want = given && given.action;
  if (!want || !want.key || want.suggested === true || !shows.includes("cards")) return given;
  const action = (actions || []).find((a) => a.key === want.key);
  if (!action) return given;
  // The record open on the screen asked from fills its field first, as the card's draft does: never asked for.
  const fieldNames = action.fields ? [...action.fields] : Object.keys(shapeOf(action.input) || {});
  const values = engine.cards.fillFromContext(want.values && typeof want.values === "object" ? want.values : {}, fieldNames, context);
  const q = engine.cards.nextAsk(action, values, askedRun(history), { today: lagos.today(now) });
  if (!q) return given;
  logger.info({ ai_action: action.key, field: q.field }, "Praxis AI: a card waited on a question first");
  return { ...given, text: q.question, action: null, ask: { action: q.action, field: q.field, choices: q.choices }, table: null, route: null, prefill: null, more: false, overview: null };
}

/** A field problem the person fixes on the card, at most four words (gate 12). */
const FILL_THE_GAP = "Fill the gap";

/**
 * The words a card carries, held to "ready to send" as the mailbox's Write With AI holds a draft
 * (services/ai/drafts.js; decision 19): a gap left to fill (a bracket, "insert here", XXX, a
 * blank line) or a redaction token that stands for nothing is a problem on its field, so a mail
 * or a message with a placeholder never leaves on one press. Given the action, a picked field is
 * not words (an id, a place's token) and is passed, and a field's `allows` passes the gaps its
 * words may hold (a letter's own {{ names }}).
 * @param {object} values
 * @param {{picks?: object, allows?: object}|null} [action]
 * @returns {Record<string, string[]>}
 */
function gapsIn(values, action = null) {
  const out = {};
  const picks = (action && action.picks) || {};
  const allows = (action && action.allows) || {};
  for (const [k, v] of Object.entries(values || {})) {
    if (typeof v !== "string" || picks[k]) continue;
    if (placeholdersIn(v, undefined, allows[k] ? { allowed: allows[k] } : undefined).length) out[k] = [FILL_THE_GAP];
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
  const fieldNames = action.fields ? [...action.fields] : Object.keys(shapeOf(action.input) || {});
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
  const gaps = gapsIn(checked.values, action);
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
      names: card.names,
      suggested: card.suggested,
      status: card.status,
      expires_at: card.expires_at,
    },
    action,
    fields: engine.cards.fieldsOf(jsonSchemaOf(action.input), action.labels, { fields: action.fields, picks: action.picks }),
    schema: contractNameOf(action.input),
    confirm: card.confirm,
  };
}

module.exports = { build, draftCard, askFirst, withChoices, withOptions, recordChoices, askOf, askedRun, gapsIn, tableOf, drawTable, defaultFields, whoOf, valueAt, presentTable, groupsOf, linkOf, prefillOf, cell, readsMade, MAX_CITATIONS, MAX_COLUMNS, MAX_CHOICES, FILL_THE_GAP };
