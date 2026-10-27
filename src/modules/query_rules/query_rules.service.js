"use strict";
/**
 * Query rules: the one write path for a rule (docs/guides/queries.md §6.3). A rule is
 * saved as a draft, switched on when People are ready (it counts from then, never
 * back), and paused rather than deleted once it has fired. Its trigger and measure are
 * fixed once it has raised a query: the queries it raised were counted that way.
 *
 * A trigger nothing counts yet (missed targets: M2's KPIs) may be drafted but not switched on
 * until its module counts it.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const lagos = require("../../shared/time/lagos");
const attendance = require("../attendance/attendance.auto-query");
const tasks = require("../tasks/tasks.auto-query");
const reviews = require("../reviews/reviews.auto-query");
const repo = require("./query_rules.repo");
const { EVENTS } = require("./query_rules.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That rule does not exist", 404);
const monthStart = () => lagos.startOfDay(`${lagos.today().slice(0, 7)}-01`);

/** `Repeated Lateness` → `repeated_lateness`. */
function codeFrom(name) {
  return (
    String(name)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "rule"
  );
}

/** Whether something counts this trigger yet. */
const COUNTED = [...attendance.SOURCES, ...tasks.SOURCES, ...reviews.SOURCES];
const countable = (source) => COUNTED.includes(source);

const policies = () => require("../policies/policies.service");

/** Rules as their cards show them: the policy each enforces, named through the policies service. */
async function named(db, rows) {
  const names = await policies().namesOf(db, rows.map((r) => r.policy_id));
  return rows.map(({ policy_id: policyId, ...r }) => ({ ...r, policy: names.find((p) => p.policy_id === policyId) || null }));
}

async function list(query) {
  const page = await repo.list(pool, query, monthStart());
  return { ...page, data: await named(pool, page.data) };
}
const summary = () => repo.summary(pool, monthStart());
const firings = (query, reader) => repo.firings(pool, query, reader);

async function get(id) {
  const row = await repo.get(pool, id, monthStart());
  if (!row) throw notFound();
  return (await named(pool, [row]))[0];
}

/** A rule may name a policy only while it has a version in force (queries guide §6.3). */
async function assertPolicy(db, policyId) {
  if (policyId && !(await policies().citation(db, policyId)))
    throw new AppError("POLICY_NOT_IN_FORCE", "That policy has no version in force", 422, { policy_id: ["Not in force"] });
}

async function assertLetter(db, key) {
  if (key && !(await repo.isQueryLetter(db, key)))
    throw new AppError("LETTER_NOT_FOUND", "Pick a query letter", 422, { letter_template: ["Not a query letter"] });
}

async function create(actor, body) {
  const id = await tx(async (client) => {
    await assertLetter(client, body.letter_template);
    await assertPolicy(client, body.policy_id);
    let code = codeFrom(body.name);
    for (let n = 2; await repo.codeTaken(client, code); n += 1) code = codeFrom(`${body.name} ${n}`);
    const clause = body.policy_id ? body.policy_clause || null : null;
    const ruleId = await repo.insert(client, { ...body, measure: "count", policy_clause: clause, code, created_by: actor.user_id });
    await emit(client, {
      key: EVENTS.QUERY_RULE_SAVED,
      entity: { type: "query_rule", id: ruleId },
      actor,
      after: { ...body, code },
      payload: { query_rule_id: ruleId, code },
    });
    return ruleId;
  });
  return get(id);
}

async function update(actor, id, body) {
  await tx(async (client) => {
    const before = await repo.get(client, id, monthStart());
    if (!before) throw notFound();
    const changesHow = body.source_event && body.source_event !== before.source_event;
    if (changesHow && (await repo.hasFired(client, id)))
      throw new AppError("RULE_HAS_FIRED", "This rule has raised queries; start a new one instead", 409, {
        source_event: ["Fixed once it has fired"],
      });
    if (body.letter_template) await assertLetter(client, body.letter_template);
    await assertPolicy(client, body.policy_id);
    // The clause is a line of the policy: blank is none, and taking the policy off clears it.
    if (body.policy_clause !== undefined) body = { ...body, policy_clause: body.policy_clause || null };
    if (body.policy_id === null) body = { ...body, policy_clause: null };
    await repo.update(client, id, body);
    await emit(client, {
      key: EVENTS.QUERY_RULE_SAVED,
      entity: { type: "query_rule", id },
      actor,
      before,
      after: body,
      payload: { query_rule_id: id, code: before.code },
    });
  });
  return get(id);
}

async function setActive(actor, id, on) {
  await tx(async (client) => {
    const before = await repo.get(client, id, monthStart());
    if (!before) throw notFound();
    if (before.active === on) return;
    if (on && !countable(before.source_event)) {
      // Lateness, absence and missing clock-outs moved to the Attendance policy (guide §6.3).
      const moved = !c.query_rules.OfferedRuleSource.options.includes(before.source_event);
      throw new AppError("TRIGGER_NOT_AVAILABLE", "This trigger is not counted yet", 409, {
        source_event: [moved ? "The Attendance policy counts it" : "Comes with M2"],
      });
    }
    await repo.setActive(client, id, on);
    await emit(client, {
      key: on ? EVENTS.QUERY_RULE_ACTIVATED : EVENTS.QUERY_RULE_PAUSED,
      entity: { type: "query_rule", id },
      actor,
      before: { active: before.active },
      after: { active: on },
      payload: { query_rule_id: id, code: before.code },
    });
  });
  return get(id);
}

const activate = (actor, id) => setActive(actor, id, true);
const pause = (actor, id) => setActive(actor, id, false);

module.exports = { codeFrom, countable, list, summary, firings, get, create, update, activate, pause };
