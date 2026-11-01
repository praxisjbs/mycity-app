"use strict";
/**
 * A card's life (docs/guides/praxis-ai.md §6.11): shown with an answer, edited, pressed, cancelled.
 * The rules are the engine's (services/ai/engine/cards.js); what runs is the module's own service
 * function, named by its manifest's action, with the person's rights re-checked at the press.
 *
 *   GET  /ai/cards/:id             get()      the card as the person sees it
 *   PUT  /ai/cards/:id             edit()     the person's values, re-validated
 *   POST /ai/cards/:id/confirm     confirm()  the press: the checks, the run, the result
 *   POST /ai/cards/:id/cancel      cancel()
 *
 * The press, in order (§6.11 step 5): the card is the caller's, shown and not expired; a sensitive
 * class has Confirm It's You within five minutes (403 REAUTH_REQUIRED, which the screen answers
 * with the confirm sheet and presses again); the grant and scope now; the values parse; at most
 * `bulk` records; the action's own check(); then the run is opened and run() called once, outside
 * the card's transaction, since the service keeps its own. A refusal a person can fix (an AppError
 * under 500 from check() or run()) comes back on the fields and the card stays open; anything else
 * is recorded on the card as failed.
 */
const { pool } = require("../../config/db");
const { logger } = require("../../config/logger");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const routeMap = require("../../shared/route-map");
const authorise = require("../../shared/ai/authorise");
const registry = require("../../shared/ai/registry");
const { contractNameOf } = require("../../shared/ai/manifest");
const identity = require("../identity/identity.service");
const { jsonSchemaOf } = require("../../services/ai/structured");
const engine = require("../../services/ai/engine");
const { gapsIn } = require("../../services/ai/assistant/answer");
const repo = require("./assistant.repo");
const { EVENTS } = require("./assistant.events");

const { cards } = engine;

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const iso = (v) => (v ? new Date(v).toISOString() : null);
const notFound = () => new AppError("NOT_FOUND", "Not found", 404);

/** An EngineError at the edge, as the API answers it. */
function atEdge(err) {
  if (engine.isEngineError(err)) return new AppError(err.code, err.message, err.status, err.fields || undefined);
  return err;
}

/** A record a card touches, named and linked when shown. */
function recordView(r) {
  const link = r.type && r.id ? routeMap.linkFor(r.type, r.id) : null;
  return { type: String(r.type), id: String(r.id), label: r.label || String(r.type).replace(/_/g, " "), link: link ? link.path : null };
}

/** A press's result as the wire carries it. */
function resultView(run) {
  if (!run || run.status === "running") return null;
  const r = run.result && typeof run.result === "object" && !Array.isArray(run.result) ? run.result : { lines: Array.isArray(run.result) ? run.result : [], message: null };
  return {
    ai_action_run_id: run.ai_action_run_id,
    status: run.status === "done" ? "done" : "failed",
    lines: (r.lines || []).slice(0, 25).map((l) => ({ type: String(l.type || "record"), id: l.id === undefined || l.id === null ? null : String(l.id), label: String(l.label || ""), ok: l.ok !== false, message: l.message || null, link: l.link || null })),
    error_code: run.error_code || null,
    message: r.message || null,
    finished_at: iso(run.finished_at || run.started_at),
  };
}

/**
 * A card as the person sees it (AiActionCard).
 * @param {object} row  ai_action_draft
 * @param {object|null} run  its newest press
 * @param {Date|number} [now]
 */
function present(row, run = null, now = Date.now()) {
  const action = registry.action(row.action_key);
  const status = action ? cards.statusOf(row, +now) : "expired";
  return {
    ai_action_draft_id: row.ai_action_draft_id,
    ai_message_id: row.ai_message_id,
    action_key: row.action_key,
    module_key: row.module_key,
    label: action ? action.label : row.action_key,
    description: action ? action.description : "",
    schema: action ? contractNameOf(action.input) || "" : "",
    risk: row.risk,
    confirm: cards.confirmOf(row.risk),
    bulk: action ? action.bulk : 1,
    values: row.values || {},
    problems: row.problems || {},
    records: (row.records || []).slice(0, 25).map(recordView),
    fields: action ? cards.fieldsOf(jsonSchemaOf(action.input), action.labels) : [],
    suggested: row.suggested === true,
    status,
    expires_at: iso(row.expires_at),
    result: resultView(run),
    created_at: iso(row.created_at),
  };
}

/** GET /ai/cards/:id. */
async function get(id, actor) {
  const row = await repo.draftOf(pool, id, actor.user_id);
  if (!row) throw notFound();
  return present(row, await repo.latestRunOf(pool, row.ai_action_draft_id));
}

/** PUT /ai/cards/:id: the person's edits, re-validated with the action's schema. */
async function edit(id, body, actor) {
  const row = await tx(async (client) => {
    const found = await repo.draftOf(client, id, actor.user_id, { lock: true });
    if (!found) throw notFound();
    try {
      cards.assertOpen(found);
    } catch (err) {
      throw atEdge(err);
    }
    if (!registry.action(found.action_key)) throw new AppError("CARD_EXPIRED", "This card has expired. Ask again to draw it afresh.", 409);
    const checked = held(await authorise.checkAction(actor, found.action_key, body.values, client));
    return repo.setDraft(client, found.ai_action_draft_id, { values: checked.ok ? checked.values : body.values, problems: checked.ok ? {} : checked.problems, records: checked.records });
  });
  return present(row, null);
}

/** A card's words held to ready to send, at an edit and at the press as at the draft (answer.gapsIn): a gap left to fill is a problem on its field. */
function held(checked) {
  const gaps = gapsIn(checked.values);
  return Object.keys(gaps).length ? { ...checked, ok: false, problems: { ...checked.problems, ...gaps } } : checked;
}

/** The action's own check, with the person carrying their scope; its refusals land on the fields. */
async function ownCheck(client, action, values, actor) {
  if (!action.check) return;
  await action.check(client, values, actor);
}

/** The lines a press reads back, from the action's readback or the records it named. */
function linesOf(action, result, records) {
  const lines = action.readback ? action.readback(result) : records.map((r) => ({ ...r, status: "done" }));
  return (lines || []).slice(0, 25).map((l) => {
    const link = l.link || (l.type && l.id ? (routeMap.linkFor(l.type, l.id) || {}).path : null) || null;
    return { type: l.type || "record", id: l.id === undefined ? null : l.id, label: l.label || l.status || "done", ok: l.ok !== false, message: l.message || l.status || null, link };
  });
}

/**
 * POST /ai/cards/:id/confirm: the press (§6.11 steps 4 to 6).
 * @returns {Promise<object>} AiActionResult
 */
async function confirm(id, body, actor, idempotencyKey = null) {
  const opened = await tx(async (client) => {
    const found = await repo.draftOf(client, id, actor.user_id, { lock: true });
    if (!found) throw notFound();
    try {
      cards.assertPressable(found);
    } catch (err) {
      throw atEdge(err);
    }
    const action = registry.action(found.action_key);
    if (!action) throw new AppError("CARD_EXPIRED", "This card has expired. Ask again to draw it afresh.", 409);
    // A sensitive class: the session confirmed it is the person within the last five minutes.
    if (cards.SENSITIVE.has(found.risk) && !cards.confirmed(found.risk, await identity.provedAgo(client, actor)))
      throw new AppError("REAUTH_REQUIRED", "Confirm it is you to continue.", 403);
    const values = body && body.values ? body.values : found.values || {};
    const checked = held(await authorise.checkAction(actor, found.action_key, values, client));
    if (!checked.ok) {
      await repo.setDraft(client, found.ai_action_draft_id, { values, problems: checked.problems });
      throw new AppError("VALIDATION", "Check the card's fields", 422, checked.problems);
    }
    const who = { ...actor, scope: checked.scope };
    await ownCheck(client, action, checked.values, who);
    await repo.setDraft(client, found.ai_action_draft_id, { status: "confirmed", values: checked.values, problems: {}, records: checked.records });
    const run = await repo.insertRun(client, {
      ai_action_draft_id: found.ai_action_draft_id,
      user_id: actor.user_id,
      confirmed_how: cards.SENSITIVE.has(found.risk) ? "fresh_sign_in" : "click",
      idempotency_key: idempotencyKey,
      values: checked.values,
    });
    return { found, action, who, values: checked.values, records: checked.records, run };
  });

  const { found, action, who, values, records, run } = opened;
  let result;
  try {
    result = await action.run(values, who, { idempotency_key: idempotencyKey, ai_action_draft_id: found.ai_action_draft_id, ai_action_run_id: run.ai_action_run_id });
  } catch (err) {
    const fixable = err instanceof AppError && err.status < 500;
    const closed = await tx(async (client) => {
      const r = await repo.finishRun(client, run.ai_action_run_id, { status: "failed", result: { lines: [], message: err.message }, error_code: err.code || "AI_ACTION_FAILED" });
      await repo.setDraft(client, found.ai_action_draft_id, { status: fixable ? "shown" : "failed", problems: fixable && err.fields ? err.fields : null });
      await emit(client, {
        key: EVENTS.ASSISTANT_ACTION_FAILED,
        entity: { type: "ai_action_draft", id: found.ai_action_draft_id },
        actor,
        payload: { action_key: found.action_key, ai_action_run_id: run.ai_action_run_id, error_code: err.code || "AI_ACTION_FAILED", fixable },
      });
      return r;
    });
    if (fixable) throw err;
    logger.error({ err, ai_action: found.action_key, ai_action_draft_id: found.ai_action_draft_id }, "Praxis AI: an action failed at the press");
    return resultView(closed);
  }
  const lines = linesOf(action, result, records);
  const closed = await tx(async (client) => {
    const r = await repo.finishRun(client, run.ai_action_run_id, { status: "done", result: { lines, message: null } });
    await repo.setDraft(client, found.ai_action_draft_id, { status: "done" });
    await emit(client, {
      key: EVENTS.ASSISTANT_ACTION_CONFIRMED,
      entity: { type: "ai_action_draft", id: found.ai_action_draft_id },
      actor,
      payload: { action_key: found.action_key, ai_action_run_id: run.ai_action_run_id, confirmed_how: run.confirmed_how, records: lines.map((l) => ({ type: l.type, id: l.id })) },
    });
    return r;
  });
  return resultView(closed);
}

/** POST /ai/cards/:id/cancel. */
async function cancel(id, actor) {
  const row = await tx(async (client) => {
    const found = await repo.draftOf(client, id, actor.user_id, { lock: true });
    if (!found) throw notFound();
    try {
      cards.assertOpen(found);
    } catch (err) {
      throw atEdge(err);
    }
    const r = await repo.setDraft(client, found.ai_action_draft_id, { status: "cancelled" });
    await emit(client, { key: EVENTS.ASSISTANT_CARD_CANCELLED, entity: { type: "ai_action_draft", id: found.ai_action_draft_id }, actor, payload: { action_key: found.action_key } });
    return r;
  });
  return present(row, null);
}

module.exports = { get, edit, confirm, cancel, present, resultView };
