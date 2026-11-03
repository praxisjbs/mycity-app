"use strict";
/**
 * Running one of the assistant's reads, summaries or actions for a person, with that person's
 * rights and nothing more (MILESTONES §15: "an agent checks the caller's grants before the model
 * answers, so marketing cannot reach HR employee data through a question"; praxis-ai.md §1.2
 * decision 16: the same rights everywhere, re-checked at the press).
 *
 *   const r = await authorise.runRead(client, req.user, "employees.list", { page: 1, q: "ada" });
 *   // → { key, list: true, page: { number, size: 25, total, ... }, data: [...], citations: [...], masked: [...] }
 *   const s = await authorise.runSummary(client, req.user, "attendance.summary", { by: "department" });
 *   // → { key, result: { figures, groups, series, total } }
 *   const a = await authorise.checkAction(req.user, "tasks.create", values);
 *   // → { action, scope, values, problems, records, ok }
 *
 * In order, every time a read runs:
 *   1. the read exists (registry.js);
 *   2. the caller holds its grant (`view` on its module), decided by the same code as
 *      requirePermission (middleware/rbac.scopeFor); refused with AI_READ_FORBIDDEN, so
 *      the assistant can say "that is not available to you";
 *   3. the parameters parse with the read's contract schema; nothing the model invents
 *      reaches SQL unchecked;
 *   4. the read runs with the caller's own scope (all, team or own) as `actor.scope`;
 *   5. a list read must return one page of at most 25 (assertPage, BACKEND_STRUCTURE
 *      §16), however the question was phrased: "all our contacts" is the first 25 and
 *      the total, and the next page is a second read;
 *   6. restricted fields are masked for the caller (shared/rbac/field-mask) before the
 *      model or anyone sees the rows;
 *   7. the rows are cited (cite.js), from what was read.
 *
 * A summary goes the same way, and its result must parse as AiSummaryResult: figures, never
 * rows; one asked again within a minute with the same parameters and scope is served from the
 * summary cache (summary-cache.js), never across people. Every read and summary runs inside its
 * own transaction with a statement timeout of READ_TIMEOUT_MS (praxis-ai.md §6.3 step 8): a read
 * that would scan too much is cut by the database and answers AI_READ_TIMEOUT, which the model
 * receives as "narrow the question"; a read whose service runs on the pool is held to the same
 * deadline here. An action is checked the same way at the draft and again at the press (checkAction):
 * the grant, the scope it gives, the values against the action's input schema, the records it
 * touches against its bulk limit; its own `check` and `run` are called by the card's service.
 *
 * allowedReads, allowedSummaries and allowedActions are the tool and action lists for one
 * person: only what they could run, so the model is never offered a read or an action that
 * would be refused.
 */
const { logger } = require("../../config/logger");
const { AppError } = require("../errors");
const { atomically } = require("../db/tx");
const { assertPage } = require("../http/paged");
const summaryCache = require("./summary-cache");
const { maskForUser, maskedKeysFor } = require("../rbac/field-mask");
const metrics = require("../observability/metrics");
const registry = require("./registry");
const { citationsFor } = require("./cite");
const { oneNamed } = require("./named");
const c = require("@mycity/contract");

const scopeFor = (...args) => require("../../middleware/rbac").scopeFor(...args);
const holdsCapability = (...args) => require("../../middleware/rbac").holdsCapability(...args);

/** How long one read or summary may run in the database (praxis-ai.md §6.3 step 8; decision 14). */
const READ_TIMEOUT_MS = 3000;
/** The deadline held here for a read whose service runs on the pool, past the database's own cut. */
const READ_DEADLINE_MS = READ_TIMEOUT_MS + 1000;
/** Postgres: the statement was cancelled, here by statement_timeout. */
const QUERY_CANCELED = "57014";

const timedOut = () => new AppError("AI_READ_TIMEOUT", "That read covers too much at once. Narrow the question.", 504);

/**
 * Run one read or summary with the person's rights, inside a transaction that cuts any statement
 * at READ_TIMEOUT_MS. A pool opens a client of its own; a client already in a transaction keeps it
 * (a savepoint takes the timeout and its failure, so the caller's work stands). The read's service
 * may run on its own pool connection, which no SET LOCAL reaches: the same deadline is held here,
 * and the database finishes that statement on its own.
 * @param {{query: Function, connect?: Function}} db  a pool or a client
 * @param {(client: {query: Function}) => Promise<T>} fn
 * @template T
 * @returns {Promise<T>}
 */
async function guarded(db, fn) {
  const pooled = typeof db.connect === "function" && typeof db.release !== "function";
  const client = pooled ? await db.connect() : db;
  let timer = null;
  try {
    return await atomically(client, async () => {
      await client.query("SAVEPOINT ai_read");
      try {
        await client.query(`SET LOCAL statement_timeout = ${READ_TIMEOUT_MS}`);
        const deadline = new Promise((_, reject) => {
          timer = setTimeout(() => reject(timedOut()), READ_DEADLINE_MS);
        });
        const out = await Promise.race([fn(client), deadline]);
        clearTimeout(timer);
        await client.query("RELEASE SAVEPOINT ai_read");
        await client.query("SET LOCAL statement_timeout = DEFAULT");
        return out;
      } catch (err) {
        clearTimeout(timer);
        // ROLLBACK TO takes the SET LOCAL back with it, so a joined transaction keeps its own timeout.
        await client.query("ROLLBACK TO SAVEPOINT ai_read").catch(() => {});
        throw err && err.code === QUERY_CANCELED ? timedOut() : err;
      }
    });
  } finally {
    if (pooled) client.release();
  }
}

/**
 * May this person run it: the grant, and an action's capability when it names one (held on top of
 * the grant, as the screen's route holds it). The scope the grant gives, or null.
 */
async function scopeOf(actor, tool) {
  const scope = await scopeFor(actor, tool.permission[0], tool.permission[1]);
  if (!scope || !tool.capability) return scope;
  return (await holdsCapability(actor, tool.capability)) ? scope : null;
}

/** The person with the scope an action's grant gives them, or null when they may not run it (its capability too). */
async function scopedFor(actor, action) {
  if (!actor || !action) return null;
  const scope = await scopeOf(actor, action);
  return scope ? { ...actor, scope } : null;
}

/** Which of a kind this person may run. */
async function allowedOf(list, actor) {
  const out = [];
  for (const r of list) if (await scopeOf(actor, r)) out.push(r);
  return out;
}

/** The reads this person may run. @param {object} actor req.user */
const allowedReads = (actor) => allowedOf(registry.reads(), actor);
/** The summaries this person may run. */
const allowedSummaries = (actor) => allowedOf(registry.summaries(), actor);
/** The actions this person may draft and confirm. */
const allowedActions = (actor) => allowedOf(registry.actions(), actor);

function refused(key, actor, what = "read") {
  metrics.inc("mycity_ai_read_denials_total", { read: key }, 1, "AI reads and actions refused for want of a grant.");
  logger.warn({ ai_read: key, user_id: actor && actor.user_id }, `AI ${what} denied`);
  return new AppError(what === "action" ? "AI_ACTION_FORBIDDEN" : "AI_READ_FORBIDDEN", what === "action" ? "You cannot do that here." : "That information is not available to you.", 403);
}

function fieldsOf(parsed) {
  const fields = {};
  for (const i of parsed.error.issues) (fields[i.path.join(".") || "(params)"] ||= []).push(i.message);
  return fields;
}

/**
 * Run one read for one person.
 * @param {{query: Function}} client
 * @param {object} actor   req.user
 * @param {string} key     a read key ("employees.list")
 * @param {object} [params]
 */
async function runRead(client, actor, key, params = {}) {
  const read = registry.read(key);
  if (!read) throw new AppError("AI_READ_UNKNOWN", `There is no "${key}" read`, 404);

  const scope = await scopeFor(actor, read.permission[0], read.permission[1]);
  if (!scope) throw refused(key, actor);

  const parsed = read.params.safeParse(params || {});
  if (!parsed.success)
    throw new AppError("AI_READ_INVALID", `The "${key}" read was asked for with parameters it does not take`, 422, fieldsOf(parsed));

  const result = await guarded(client, (conn) => read.run(conn, parsed.data, { ...actor, scope }));
  let rows;
  if (read.list) {
    assertPage(result, `AI read ${key}`);
    rows = result.data;
  } else {
    if (Array.isArray(result) || (result && Array.isArray(result.data))) {
      throw new Error(`AI read ${key}: a read without page in its params returns one record or null; a list takes listQuery()`);
    }
    rows = result ? [result] : [];
  }

  const masked = await maskForUser(client, actor, rows);
  return {
    key,
    kind: "read",
    list: read.list,
    page: read.list ? result.page : null,
    data: read.list ? masked : masked[0] || null,
    citations: citationsFor(read, masked),
    /** The mask keys hidden from this person (shared/rbac/field-mask), for the Sources tab. */
    masked: await maskedKeysFor(client, actor),
  };
}

/**
 * Run one summary for one person (praxis-ai.md §6.13): figures the database computed with
 * their scope, parsed as AiSummaryResult; a result that carries rows is a programming error.
 */
async function runSummary(client, actor, key, params = {}) {
  const summary = registry.summary(key);
  if (!summary) throw new AppError("AI_READ_UNKNOWN", `There is no "${key}" summary`, 404);
  const scope = await scopeFor(actor, summary.permission[0], summary.permission[1]);
  if (!scope) throw refused(key, actor, "summary");
  const parsed = summary.params.safeParse(params || {});
  if (!parsed.success)
    throw new AppError("AI_READ_INVALID", `The "${key}" summary was asked for with parameters it does not take`, 422, fieldsOf(parsed));
  const { result, cached } = await summaryCache.cached(actor, key, parsed.data, scope, async () => {
    const raw = await guarded(client, (conn) => summary.run(conn, parsed.data, { ...actor, scope }));
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Array.isArray(raw.data) || Array.isArray(raw.rows))
      throw new Error(`AI summary ${key}: a summary returns { figures, groups, series, total }, never rows`);
    const shaped = c.assistant.AiSummaryResult.safeParse({ figures: [], groups: [], series: [], total: null, ...raw });
    if (!shaped.success) throw new Error(`AI summary ${key}: its result does not match AiSummaryResult (${shaped.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")})`);
    return shaped.data;
  });
  return { key, kind: "summary", result, cached, masked: await maskedKeysFor(client, actor) };
}

/**
 * Check an action for one person, at the draft and again at the press (praxis-ai.md §6.11): the
 * grant and the scope it gives, the capability it names (refused without it, as its route would
 * refuse), the values against the input schema, the records it touches
 * against its bulk limit. Nothing runs here. The action's `records(values, actor, db)` may read
 * the records' names through its module's own repo when given a pool or a client, so the card
 * names what it touches; without one it names them by id alone. A field the model may write by
 * name is matched first (`resolve`), and a picked field whose id nothing names is marked Pick one,
 * so the card never shows an id and the press never sends one (decision 32).
 * @param {object} actor
 * @param {string} key
 * @param {object} values
 * @param {{query: Function}|null} [db]  a pool or a client for the records' names
 * @returns {Promise<{action: object, scope: object, ok: boolean, values: object, problems: object, records: Array<{type: string, id: string, label?: string}>, names: Array<{type: string, id: string, label: string}>}>}
 */
async function checkAction(actor, key, values = {}, db = null) {
  const action = registry.action(key);
  if (!action) throw new AppError("AI_ACTION_UNKNOWN", `There is no "${key}" action`, 404);
  const scope = await scopeOf(actor, action);
  if (!scope) throw refused(key, actor, "action");
  const who = { ...actor, scope };
  const given = await resolved(action, carried(action, values && typeof values === "object" ? values : {}), who, db);
  const parsed = action.input.safeParse(given);
  const problems = parsed.success ? {} : fieldsOf(parsed);
  const clean = parsed.success ? parsed.data : given;
  let records = [];
  try {
    records = ((await action.records(clean, who, db)) || []).filter((r) => r && r.type && r.id !== undefined && r.id !== null && r.id !== "").map((r) => ({ type: String(r.type), id: String(r.id), label: r.label ? String(r.label) : null }));
  } catch (err) {
    logger.warn({ err, ai_action: key }, "Praxis AI: an action's records() threw; the card names none");
  }
  if (records.length > action.bulk)
    throw new AppError("TOO_MANY_RECORDS", `At most ${action.bulk} at a time`, 422, { records: [`At most ${action.bulk}`] });
  const names = await namesOf(action, clean, who, db);
  // Pick one only where the names were read: without a database, or when names() failed, nothing is marked.
  const unnamed = names === null ? {} : unnamedIn(action, clean, [...names, ...records]);
  return { action, scope, ok: parsed.success && !Object.keys(unnamed).length, values: clean, problems: { ...problems, ...unnamed }, records, names: names || [] };
}

/** A record's id as the model or a picker writes it. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The problem on a picked field whose id names nothing (decision 32), at most four words (gate 12). */
const PICK_ONE = "Pick one";

/**
 * The values with each field the model may write by name matched to the person's own record
 * (`resolve`, decision 32), and each field a record question asks for (an ask's `read`, decision 34)
 * matched among the person's own records by its words: a value already an id is left alone, a name
 * nothing matches is left as written, for Pick one (or the schema) to mark; a list is matched one by
 * one. Each resolver is handed the card's values too, so a step is matched among the steps of the
 * card's own task.
 */
async function resolved(action, values, who, db) {
  const custom = action.resolve || {};
  const records = (action.asks || []).filter((q) => q.read && !custom[q.field]);
  if ((!Object.keys(custom).length && !records.length) || !db) return values;
  const out = { ...values };
  const byWords = (v) => typeof v === "string" && v.trim() && !UUID.test(v.trim());
  const each = async (field, match) => {
    const v = out[field];
    try {
      if (Array.isArray(v)) {
        if (!v.some(byWords)) return;
        const ids = [];
        for (const one of v) ids.push(byWords(one) ? (await match(one.trim())) || one : one);
        out[field] = ids;
      } else if (byWords(v)) {
        const id = await match(v.trim());
        if (typeof id === "string" && id) out[field] = id;
      }
    } catch (err) {
      logger.warn({ err, ai_action: action.key, field }, "Praxis AI: a value written by name could not be matched; it stays as written");
    }
  };
  // The records first: a resolver handed the values then sees them as ids (a step within its task).
  for (const q of records) await each(q.field, (words) => recordIdOf(db, who, q, words));
  for (const field of Object.keys(custom)) await each(field, (words) => custom[field](words, who, db, { ...out }));
  return out;
}

/**
 * The record a value names by its words (decision 34): among the rows the ask's list read returns,
 * with the person's own rights, for those words (its `q`), then among its first page (the answers
 * the question offered); by the citation's words (shared/ai/named.js). Null when none or several match.
 */
async function recordIdOf(db, who, ask, words) {
  const kept = (cites) => (cites || []).filter((cite) => cite && cite.label && (!ask.type || cite.type === ask.type));
  for (const q of [words, null]) {
    let read;
    try {
      read = await runRead(db, who, ask.read, { ...ask.params, page: 1, ...(q ? { q } : {}) });
    } catch (err) {
      if (err && (err.code === "AI_READ_INVALID" || err.code === "AI_READ_TIMEOUT")) continue;
      throw err;
    }
    const found = oneNamed(kept(read.citations), words, (cite) => [cite.label]);
    if (found) return String(found.id);
  }
  return null;
}

/** Each picked field holding an id, or a list with an id, that neither the names nor the records name: Pick one. */
function unnamedIn(action, values, known) {
  const named = new Set(known.map((k) => String(k.id)));
  const out = {};
  for (const field of Object.keys(action.picks || {})) {
    const v = values[field];
    const ids = Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v];
    if (ids.some((id) => !named.has(String(id)))) out[field] = [PICK_ONE];
  }
  return out;
}

/** Only the fields the card carries (decision 31): a value for any other field never reaches the action. */
function carried(action, values) {
  if (!action.fields) return values;
  return Object.fromEntries(Object.entries(values).filter(([k]) => action.fields.includes(k)));
}

/**
 * The people, departments, projects and leave types a card's fields hold, by name (decisions 31 and
 * 32), through the action's own module; never counted. An id that names nothing is left out, and
 * its field is marked Pick one. Null when they could not be read (no database, no names(), or it
 * threw): then nothing is marked, and the card still never shows an id.
 */
async function namesOf(action, values, who, db) {
  if (!action.names || !db) return null;
  try {
    const named = (await action.names(values, who, db)) || [];
    return named
      .filter((n) => n && n.type && n.id && typeof n.label === "string" && n.label.trim())
      .slice(0, 80)
      .map((n) => ({ type: String(n.type), id: String(n.id), label: n.label.trim() }));
  } catch (err) {
    logger.warn({ err, ai_action: action.key }, "Praxis AI: an action's names() threw; the card's ids go unnamed");
    return null;
  }
}

module.exports = { allowedReads, allowedSummaries, allowedActions, scopedFor, runRead, runSummary, checkAction, guarded, PICK_ONE, READ_TIMEOUT_MS, READ_DEADLINE_MS };
