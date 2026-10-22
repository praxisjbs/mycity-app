"use strict";
/**
 * The approval engine (A11). Every approval in MyCity is a definition over this
 * file: M3's consequence chain, M5's offer approval, M6's payroll approval, M8's
 * expense hierarchy. Stages are data (shared/workflow/definitions.js), routing is
 * decided by the request's own values (shared/workflow/conditions.js), and who may
 * decide is narrowed per stage (shared/workflow/approvers.js).
 *
 * A module starts an approval inside the transaction that creates the record:
 *
 *   await atomically(client, async () => {
 *     const expense = await repo.insert(client, data);
 *     await emit(client, { key: EVENTS.EXPENSE_SUBMITTED, entity: { type: "expense", id: expense.expense_id }, actor, after: expense });
 *     await workflow.openInstance(client, {
 *       definition_key: "expense.approval",
 *       entity: { type: "expense", id: expense.expense_id },
 *       subject_employee_id: expense.employee_id,          // whose request; decides manager_of_subject
 *       context: { amount: expense.amount },               // every field the definition declares
 *       actor,
 *     });
 *     return expense;
 *   });
 *
 * and reacts to the outcome after commit, in its events file:
 *
 *   workflow.onCompleted("expense.approval", "expenses.apply_decision", async (event) => {
 *     // event.entity is the expense; event.payload.state is approved, rejected,
 *     // cancelled, timeout_approved or timeout_rejected
 *   });
 *
 * When nothing applies (a request under every threshold) the instance is created
 * already approved and workflow.completed fires with auto: true, so a module has one
 * completion path whatever the amount.
 *
 * Every move writes a decision row, emits an event through emit() (so it is audited
 * and its follow-on work is in the outbox), and is atomic with the caller's change.
 * Every function here runs on the caller's client inside atomically(), except
 * sweepTimeouts(), which the worker's scheduler calls.
 *
 * Instance states: pending, approved, rejected, cancelled, timeout_approved,
 * timeout_rejected. Only pending moves. One pending instance per record.
 *
 * Tables (migration 0070; BACKEND_STRUCTURE §11.1):
 *   workflow_instance  workflow_instance_id, workflow_definition_id, definition_key, module_key,
 *                      entity_type, entity_id, subject_employee_id, current_stage, state,
 *                      context jsonb, stage_approvers jsonb, stage_entered_at, stage_due_at,
 *                      opened_by, opened_at, completed_at,
 *                      excluded_employee_ids (1455: who never decides it, docs/guides/foundation.md §6.5);
 *                      UNIQUE (entity_type, entity_id) WHERE state = 'pending'
 *   workflow_decision  workflow_decision_id, workflow_instance_id, stage_key, actor_id,
 *                      decision, reason, decided_at
 */
const { AppError } = require("../errors");
const { atomically, inTransaction } = require("../db/tx");
const { pageQuery, TOTAL_COL } = require("../http/paged");
const { emit } = require("../events/emit");
const { WORKFLOW } = require("../events/catalogue");
const outbox = require("../events/outbox");
const cond = require("./conditions");
const definitions = require("./definitions");
const approvers = require("./approvers");

const DECISIONS = new Set(["approve", "reject", "request_changes"]);
const NEEDS_REASON = new Set(["reject", "request_changes"]);
const TERMINAL = new Set([
  "approved",
  "rejected",
  "cancelled",
  "timeout_approved",
  "timeout_rejected",
]);

const COLUMNS = `workflow_instance_id, workflow_definition_id, definition_key, module_key, entity_type, entity_id,
  subject_employee_id, current_stage, state, context, stage_approvers, stage_entered_at, stage_due_at,
  opened_by, opened_at, completed_at, excluded_employee_ids`;

function mustBeInTransaction(client, fn) {
  if (!inTransaction(client))
    throw new Error(
      `workflow.${fn} must run inside atomically(), on the caller's client`,
    );
}

function actorId(actor) {
  if (!actor) return null;
  return typeof actor === "string" ? actor : actor.user_id || null;
}

/** The facts every workflow event carries; handlers and notifications read these. */
function payloadOf(instance, def, extra = {}) {
  const stage = instance.current_stage
    ? cond.stageByKey(def, instance.current_stage)
    : null;
  return {
    instance_id: instance.workflow_instance_id,
    definition_key: instance.definition_key,
    definition_name: def.name,
    state: instance.state,
    stage: instance.current_stage,
    stage_name: stage ? stage.name : null,
    stage_approvers:
      instance.state === "pending" ? instance.stage_approvers : [],
    subject_employee_id: instance.subject_employee_id,
    opened_by: instance.opened_by,
    excluded_employee_ids: instance.excluded_employee_ids || [],
    ...extra,
  };
}

async function record(client, instance, def, key, actor, extra) {
  await emit(client, {
    key,
    entity: { type: instance.entity_type, id: instance.entity_id },
    module: def.module,
    actor: actor === undefined ? null : actor,
    payload: payloadOf(instance, def, extra),
  });
}

async function decide(client, instance, stageKey, actor, decision, reason) {
  await client.query(
    `INSERT INTO workflow_decision (workflow_instance_id, stage_key, actor_id, decision, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      instance.workflow_instance_id,
      stageKey,
      actorId(actor),
      decision,
      reason || null,
    ],
  );
}

/** Move a pending instance to a stage (resolving its approvers), or close it. */
async function moveTo(client, instance, stage) {
  const snapshot = await approvers.resolve(client, stage.approvers, {
    subject_employee_id: instance.subject_employee_id,
    context: instance.context,
  });
  const { rows } = await client.query(
    `UPDATE workflow_instance
        SET current_stage = $2, stage_approvers = $3::jsonb, stage_entered_at = now(),
            stage_due_at = now() + make_interval(hours => $4)
      WHERE workflow_instance_id = $1
      RETURNING ${COLUMNS}`,
    [
      instance.workflow_instance_id,
      stage.key,
      JSON.stringify(snapshot),
      stage.sla_hours,
    ],
  );
  return rows[0];
}

async function close(client, instance, state) {
  const { rows } = await client.query(
    `UPDATE workflow_instance
        SET state = $2, completed_at = now(), stage_due_at = NULL
      WHERE workflow_instance_id = $1
      RETURNING ${COLUMNS}`,
    [instance.workflow_instance_id, state],
  );
  return rows[0];
}

async function lock(client, instanceId) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM workflow_instance WHERE workflow_instance_id = $1 FOR UPDATE`,
    [instanceId],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", "Approval not found", 404);
  return rows[0];
}

async function definitionOf(client, instance) {
  const def = await definitions.findById(
    client,
    instance.workflow_definition_id,
  );
  if (!def)
    throw new Error(
      `workflow: definition ${instance.workflow_definition_id} of instance ${instance.workflow_instance_id} is gone`,
    );
  return def;
}

function assertPending(instance) {
  if (instance.state !== "pending") {
    throw new AppError(
      "WORKFLOW_CLOSED",
      `This approval is already ${instance.state.replace(/_/g, " ")}`,
      409,
    );
  }
}

/* ------------------------------------------------------------------ *
 * Starting
 * ------------------------------------------------------------------ */

/** Would this request need any approval? For a screen's "needs approval" hint. */
async function requiresApproval(client, definitionKey, context) {
  const def =
    (await definitions.findActive(client, definitionKey)) ||
    definitions.getDefault(definitionKey);
  if (!def) return false;
  return cond.requiresApproval(def, context);
}

/**
 * Start an approval for a record.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {{definition_key: string, entity: {type: string, id: string}, subject_employee_id?: string|null,
 *          context: object, actor: object|string|null, exclude_employee_ids?: string[]}} opts
 *   exclude_employee_ids  employees who never decide this approval, whatever role they hold
 *                         (a temporary site's people; docs/guides/foundation.md §6.5)
 * @returns {Promise<object>} the instance
 */
async function openInstance(
  client,
  {
    definition_key: key,
    entity,
    subject_employee_id: subjectId = null,
    context = {},
    actor,
    exclude_employee_ids: excluded = [],
  },
) {
  mustBeInTransaction(client, "openInstance");
  if (!entity || !entity.type || !entity.id)
    throw new Error("workflow.openInstance: entity { type, id } is required");
  const def = await definitions.ensureActive(client, key);
  const problems = cond.contextProblems(def, context);
  if (problems.length)
    throw new Error(`workflow.openInstance(${key}): ${problems.join("; ")}`);

  const first = cond.firstApplicableStage(def, context);
  let instance;
  try {
    const { rows } = await client.query(
      `INSERT INTO workflow_instance
         (workflow_definition_id, definition_key, module_key, entity_type, entity_id, subject_employee_id,
          current_stage, state, context, stage_approvers, opened_by, completed_at, excluded_employee_ids)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8::jsonb, '[]'::jsonb, $9, $10, $11::uuid[])
       RETURNING ${COLUMNS}`,
      [
        def.workflow_definition_id,
        def.key,
        def.module,
        entity.type,
        String(entity.id),
        subjectId,
        first ? "pending" : "approved",
        JSON.stringify(context),
        actorId(actor),
        first ? null : new Date(),
        [...new Set(excluded || [])],
      ],
    );
    instance = rows[0];
  } catch (err) {
    if (err.code === "23505")
      throw new AppError(
        "WORKFLOW_ALREADY_OPEN",
        "This record is already waiting for approval",
        409,
      );
    throw err;
  }

  if (!first) {
    await record(client, instance, def, WORKFLOW.WORKFLOW_COMPLETED, actor, {
      auto: true,
    });
    return instance;
  }
  instance = await moveTo(client, instance, first);
  await record(client, instance, def, WORKFLOW.WORKFLOW_OPENED, actor);
  return instance;
}

/* ------------------------------------------------------------------ *
 * Deciding
 * ------------------------------------------------------------------ */

/** Back to the first applicable stage (request changes, or a stage set to return). */
async function returnToStart(client, instance, def, actor, reason) {
  const first = cond.firstApplicableStage(def, instance.context);
  const moved = await moveTo(
    client,
    instance,
    first || cond.stageByKey(def, instance.current_stage),
  );
  await record(client, moved, def, WORKFLOW.WORKFLOW_CHANGES_REQUESTED, actor, {
    from_stage: instance.current_stage,
    reason,
  });
  return moved;
}

/**
 * Record a decision on the current stage.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {{instance_id: string, actor: object, decision: "approve"|"reject"|"request_changes", reason?: string}} opts
 *   actor is req.user (user_id, employee_id, role_ids, is_ceo)
 * @returns {Promise<object>} the instance after the decision
 */
async function act(
  client,
  { instance_id: id, actor, decision, reason = null },
) {
  mustBeInTransaction(client, "act");
  if (!DECISIONS.has(decision))
    throw new AppError(
      "INVALID_DECISION",
      `Unknown decision "${decision}"`,
      422,
    );
  const why = typeof reason === "string" ? reason.trim() : "";
  if (NEEDS_REASON.has(decision) && !why) {
    throw new AppError(
      "REASON_REQUIRED",
      "Give a reason so the requester knows what to change",
      422,
      { reason: ["is required"] },
    );
  }

  const instance = await lock(client, id);
  assertPending(instance);
  const def = await definitionOf(client, instance);
  const stage = cond.stageByKey(def, instance.current_stage);
  if (!stage)
    throw new AppError(
      "WORKFLOW_STAGE_MISSING",
      "This approval's stage no longer exists",
      409,
    );
  if (
    !(await approvers.canAct(client, instance.stage_approvers, actor, instance))
  ) {
    throw new AppError(
      "PERMISSION_DENIED",
      "You are not an approver for this stage",
      403,
    );
  }

  await decide(client, instance, stage.key, actor, decision, why || null);

  if (
    decision === "request_changes" ||
    (decision === "reject" && stage.on_reject === "return")
  ) {
    return returnToStart(client, instance, def, actor, why);
  }
  if (decision === "reject") {
    const closed = await close(client, instance, "rejected");
    await record(client, closed, def, WORKFLOW.WORKFLOW_COMPLETED, actor, {
      decided_stage: stage.key,
      reason: why,
    });
    return closed;
  }

  const next =
    stage.on_approve === "complete"
      ? null
      : cond.nextApplicableStage(def, instance.context, stage.key);
  if (!next) {
    const closed = await close(client, instance, "approved");
    await record(client, closed, def, WORKFLOW.WORKFLOW_COMPLETED, actor, {
      decided_stage: stage.key,
    });
    return closed;
  }
  const moved = await moveTo(client, instance, next);
  await record(client, moved, def, WORKFLOW.WORKFLOW_ADVANCED, actor, {
    from_stage: stage.key,
  });
  return moved;
}

/**
 * Withdraw a pending approval. The requester or the CEO only.
 * @param {import("pg").PoolClient} client  inside atomically()
 */
async function cancel(client, { instance_id: id, actor, reason = null }) {
  mustBeInTransaction(client, "cancel");
  const instance = await lock(client, id);
  assertPending(instance);
  const uid = actorId(actor);
  if (
    !(actor && actor.is_ceo === true) &&
    (!uid || uid !== instance.opened_by)
  ) {
    throw new AppError(
      "PERMISSION_DENIED",
      "Only the person who made the request can withdraw it",
      403,
    );
  }
  const def = await definitionOf(client, instance);
  await decide(
    client,
    instance,
    instance.current_stage,
    actor,
    "cancel",
    reason,
  );
  const closed = await close(client, instance, "cancelled");
  await record(client, closed, def, WORKFLOW.WORKFLOW_CANCELLED, actor, {
    reason,
    withdrawn_from: instance.stage_approvers,
  });
  return closed;
}

/* ------------------------------------------------------------------ *
 * Time limits
 * ------------------------------------------------------------------ */

/**
 * Apply the current stage's on_timeout to one overdue instance. A no-op (null) when
 * it was decided or re-armed in the meantime.
 *   escalate      re-arm the stage's time limit and emit workflow.escalated (the CEO is told)
 *   auto_reject   close as timeout_rejected
 *   auto_approve  move on, or close as timeout_approved (never on an approval carrying money)
 * @param {import("pg").PoolClient} client  inside atomically()
 */
async function resolveTimeout(client, id) {
  mustBeInTransaction(client, "resolveTimeout");
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM workflow_instance
      WHERE workflow_instance_id = $1 AND state = 'pending' AND stage_due_at <= now()
      FOR UPDATE SKIP LOCKED`,
    [id],
  );
  const instance = rows[0];
  if (!instance) return null;
  const def = await definitionOf(client, instance);
  const stage = cond.stageByKey(def, instance.current_stage);
  let policy = stage ? stage.on_timeout : "escalate";
  // Defence in depth: a definition saved before the rule existed still never approves money.
  if (policy === "auto_approve" && cond.carriesMoney(def)) policy = "escalate";

  if (policy === "escalate") {
    const hours = stage ? stage.sla_hours : cond.DEFAULT_SLA_HOURS;
    const { rows: re } = await client.query(
      `UPDATE workflow_instance SET stage_due_at = now() + make_interval(hours => $2)
        WHERE workflow_instance_id = $1 RETURNING ${COLUMNS}`,
      [id, hours],
    );
    await record(client, re[0], def, WORKFLOW.WORKFLOW_ESCALATED, null, {
      overdue_stage: instance.current_stage,
    });
    return re[0];
  }

  if (policy === "auto_reject") {
    await decide(
      client,
      instance,
      instance.current_stage,
      null,
      "timeout_reject",
      `No decision within ${stage.sla_hours} hours`,
    );
    const closed = await close(client, instance, "timeout_rejected");
    await record(client, closed, def, WORKFLOW.WORKFLOW_COMPLETED, null, {
      auto: true,
      decided_stage: instance.current_stage,
    });
    return closed;
  }

  await decide(
    client,
    instance,
    instance.current_stage,
    null,
    "timeout_approve",
    `No decision within ${stage.sla_hours} hours`,
  );
  const next =
    stage.on_approve === "complete"
      ? null
      : cond.nextApplicableStage(def, instance.context, stage.key);
  if (!next) {
    const closed = await close(client, instance, "timeout_approved");
    await record(client, closed, def, WORKFLOW.WORKFLOW_COMPLETED, null, {
      auto: true,
      decided_stage: stage.key,
    });
    return closed;
  }
  const moved = await moveTo(client, instance, next);
  await record(client, moved, def, WORKFLOW.WORKFLOW_ADVANCED, null, {
    auto: true,
    from_stage: stage.key,
  });
  return moved;
}

/**
 * The scheduler's sweep: every overdue pending instance, each in its own
 * transaction, so one bad row does not hold up the rest.
 * @param {{db?: import("pg").Pool, limit?: number}} [opts]
 * @returns {Promise<{due: number, resolved: number, failed: number}>}
 */
async function sweepTimeouts({
  db = require("../../config/db").pool,
  limit = 200,
} = {}) {
  const { rows } = await db.query(
    `SELECT workflow_instance_id FROM workflow_instance
      WHERE state = 'pending' AND stage_due_at <= now()
      ORDER BY stage_due_at, workflow_instance_id
      LIMIT $1 -- pagination:batch instances one timeout sweep resolves`,
    [limit],
  );
  const out = { due: rows.length, resolved: 0, failed: 0 };
  for (const { workflow_instance_id: id } of rows) {
    const client = await db.connect();
    try {
      const done = await atomically(client, () => resolveTimeout(client, id));
      if (done) out.resolved += 1;
    } catch (err) {
      out.failed += 1;
      require("../../config/logger").logger.error(
        { err, workflow_instance_id: id },
        "workflow timeout failed",
      );
    } finally {
      client.release();
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/** The pending instance for a record, or null. */
async function findOpenInstance(client, entity) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM workflow_instance
      WHERE entity_type = $1 AND entity_id = $2 AND state = 'pending'`,
    [entity.type, String(entity.id)],
  );
  return rows[0] || null;
}

/**
 * One instance with its decisions, oldest first. Decisions per instance are a
 * handful (one per stage, plus returns), never a list a person pages through.
 */
async function getInstance(client, id) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM workflow_instance WHERE workflow_instance_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { rows: decisions } = await client.query(
    `SELECT workflow_decision_id, stage_key, actor_id, decision, reason, decided_at
       FROM workflow_decision
      WHERE workflow_instance_id = $1
      ORDER BY decided_at, workflow_decision_id`,
    [id],
  );
  return { ...rows[0], decisions };
}

/**
 * My Approvals: pending instances whose current stage names this user, oldest
 * waiting first, 25 per page.
 * @param {{query: Function}} client
 * @param {{user_id: string, employee_id?: string, role_ids?: string[], is_ceo?: boolean}} user
 * @param {{page?: number, module?: string}} [query]
 */
async function waitingOn(client, user, query = {}) {
  const roleCodes = await approvers.roleCodesOf(client, user.role_ids || []);
  const params = [query.module || null];
  const clause = approvers.waitingOnClause("i", user, roleCodes, params);
  return pageQuery(
    client,
    `SELECT i.workflow_instance_id, i.definition_key, i.module_key, i.entity_type, i.entity_id,
            i.subject_employee_id, i.current_stage, i.context, i.stage_entered_at, i.stage_due_at,
            i.opened_by, i.opened_at, ${TOTAL_COL}
       FROM workflow_instance i
      WHERE i.state = 'pending'
        AND ($1::text IS NULL OR i.module_key = $1)
        AND ${clause}
      ORDER BY i.stage_entered_at, i.workflow_instance_id`,
    params,
    query,
  );
}

/* ------------------------------------------------------------------ *
 * Reacting
 * ------------------------------------------------------------------ */

/**
 * Run `fn` after an approval of `definitionKey` finishes, whatever the outcome.
 * Registered as an outbox handler, so it runs after commit, at least once.
 * @param {string} definitionKey
 * @param {string} name  "<module>.<what>"
 * @param {(event: object) => Promise<void>} fn  event.payload.state says how it ended
 */
function onCompleted(definitionKey, name, fn) {
  outbox.register(WORKFLOW.WORKFLOW_COMPLETED, name, async (event, ctx) => {
    if (event.payload.definition_key !== definitionKey) return;
    await fn(event, ctx);
  });
}

module.exports = {
  DECISIONS,
  TERMINAL,
  requiresApproval,
  openInstance,
  act,
  cancel,
  resolveTimeout,
  sweepTimeouts,
  findOpenInstance,
  getInstance,
  waitingOn,
  onCompleted,
};
