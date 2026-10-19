"use strict";
/**
 * Sanctions: the one write path for a sanction (docs/guides/queries.md §3 steps 4 to 6,
 * §6.4 to §6.6).
 *
 *   propose()   from a query's decision (queries.escalate.js), inside its transaction: the
 *               sanction is written pending, any fine attached, and its approval opened
 *               (queries.consequence, with the rung's rank and the fine in its context)
 *   settle()    after commit, the approval's outcome is copied on: issued (numbered
 *               SAN-0001, its letter generated, the query resolved), rejected (the query
 *               back under review) or withdrawn. Idempotent: only a pending sanction moves
 *   nextStep()  the rung a new offence is offered first (§6.5)
 *
 * A sanction always follows a query, and is seen by whoever may see that query
 * (queries.visibility.js).
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const numbering = require("../../shared/numbering/numbering");
const engine = require("../../shared/workflow/engine");
const lagos = require("../../shared/time/lagos");
const visibility = require("../queries/queries.visibility");
const templates = require("../templates/templates.service");
const repo = require("./sanctions.repo");
const letters = require("./sanctions.letters");
const { EVENTS, DEFINITION_KEY } = require("./sanctions.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** The public shape of a row get() returned (SanctionDetail). */
function detailOf(row) {
  const {
    employee_id: _e, raised_by: _r, query_subject: _s, query_details: _d, query_raised_at: _a,
    position: _p, letter_template: _l, financial_effect: _f, fine_amount: _m, ...out
  } = row;
  return out;
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

const list = (query, reader) => repo.list(pool, query, reader);

function summary(reader) {
  const today = lagos.today();
  return repo.summary(pool, reader, { today, yearStart: `${today.slice(0, 4)}-01-01` });
}

async function get(id, reader) {
  const row = visibility.assertVisible(reader, await repo.get(pool, id), "sanction");
  return detailOf(row);
}

/** The rung a new offence is offered first: the one after the highest still in force. */
async function nextStep(db, employeeId) {
  const held = await repo.inForce(db, employeeId, lagos.today());
  return repo.stepAbove(db, held.length ? held[0].position : 0);
}

/** One person's standing on the ladder. People with scope all only. */
async function standing(reader, employeeId) {
  if (!reader.all) throw new AppError("NOT_FOUND", "That standing is not available", 404);
  const held = await repo.inForce(pool, employeeId, lagos.today());
  return {
    employee_id: employeeId,
    in_force: held.map(({ sanction_id, number, step_name, position, effective_on, in_force_until }) => ({
      sanction_id,
      number,
      step_name,
      position,
      effective_on,
      in_force_until,
    })),
    next_step: await repo.stepAbove(pool, held.length ? held[0].position : 0),
  };
}

/* ------------------------------------------------------------------ *
 * Proposing
 * ------------------------------------------------------------------ */

/**
 * @param {import("pg").PoolClient} client  inside the query decision's transaction
 * @param {object} actor   who proposed it
 * @param {object} query   the query (queries.repo.get), locked
 * @param {object} body    QueryDecision, outcome `sanction`
 * @returns {Promise<{sanction_id: string, workflow_instance_id: string}>}
 */
async function propose(client, actor, query, body) {
  const step = await repo.getStep(client, body.consequence_step_id);
  if (!step || !step.active)
    throw new AppError("STEP_NOT_AVAILABLE", "Pick a sanction on the chain", 422, {
      consequence_step_id: ["Not on the chain"],
    });
  if (!(await templates.isReady(client, step.letter_template, "sanction")))
    throw new AppError("LETTER_NOT_READY", "This sanction's letter is not ready", 422, {
      consequence_step_id: ["Letter not ready"],
    });
  if (step.evidence_required && !(body.evidence && body.evidence.length))
    throw new AppError("EVIDENCE_REQUIRED", "This sanction needs evidence", 422, { evidence: ["Add the evidence"] });
  if (await repo.pendingOn(client, query.employee_query_id))
    throw new AppError("SANCTION_ALREADY_PROPOSED", "A sanction already waits for approval", 409);

  const effectiveOn = body.effective_on || lagos.today();
  let endsOn = body.ends_on || null;
  if (step.financial_effect === "unpaid_days" && !endsOn) {
    if (!step.default_days)
      throw new AppError("DATES_REQUIRED", "Give the last day", 422, { ends_on: ["Give the last day"] });
    endsOn = lagos.addDays(effectiveOn, step.default_days - 1);
  }
  const id = await repo.insert(client, {
    employee_query_id: query.employee_query_id,
    employee_id: query.employee_id,
    consequence_step_id: step.consequence_step_id,
    sanction_type: step.code,
    reason: body.reason,
    evidence: body.evidence || [],
    decided_by: actor.user_id,
    effective_on: effectiveOn,
    ends_on: endsOn,
  });
  if (body.fine_amount) await repo.insertFine(client, id, body.fine_amount);
  const payload = {
    sanction_id: id,
    employee_query_id: query.employee_query_id,
    query_number: query.number,
    step_name: step.name,
    employee_id: query.employee_id,
    subject_employee_id: query.employee_id,
    decided_by: actor.user_id,
  };
  await emit(client, {
    key: EVENTS.SANCTION_PROPOSED,
    entity: { type: "sanction", id },
    actor,
    after: { sanction_type: step.code, effective_on: effectiveOn, ends_on: endsOn, fine_amount: body.fine_amount || null },
    payload,
  });
  const instance = await engine.openInstance(client, {
    definition_key: DEFINITION_KEY,
    entity: { type: "sanction", id },
    subject_employee_id: query.employee_id,
    context: { rank: step.position, fine_amount: body.fine_amount || "0.00" },
    actor,
  });
  await repo.setWorkflow(client, id, instance.workflow_instance_id);
  return { sanction_id: id, workflow_instance_id: instance.workflow_instance_id };
}

/* ------------------------------------------------------------------ *
 * After the approval
 * ------------------------------------------------------------------ */

/**
 * Copy an approval's outcome onto its sanction. `outcome` is issued, rejected or
 * withdrawn (sanctions.events OUTCOME); null leaves it alone.
 */
async function settle(id, outcome) {
  if (!outcome) return;
  const queries = require("../queries/queries.service");
  await tx(async (client) => {
    const locked = await repo.lock(client, id);
    if (!locked || locked.status !== "pending_approval") return;
    const row = await repo.get(client, id);
    const payload = {
      sanction_id: id,
      employee_query_id: row.employee_query_id,
      query_number: row.query_number,
      step_name: row.step_name,
      employee_id: row.employee_id,
      subject_employee_id: row.employee_id,
      decided_by: row.decided_by,
    };
    if (outcome === "issued") {
      const number = (await numbering.allocate(client, "sanction")).number;
      await repo.issue(client, id, number);
      await letters.generate(client, { ...row, number }, number, null);
      await queries.settleEscalation(client, row.employee_query_id, { issued: true, reviewedBy: row.decided_by });
      await emit(client, {
        key: EVENTS.SANCTION_ISSUED,
        entity: { type: "sanction", id },
        actor: null,
        before: { status: "pending_approval" },
        after: { status: "issued", number },
        payload: { ...payload, number, fine_amount: row.fine_amount || null },
      });
      return;
    }
    await repo.close(client, id, outcome);
    await queries.settleEscalation(client, row.employee_query_id, { issued: false });
    await emit(client, {
      key: outcome === "rejected" ? EVENTS.SANCTION_REJECTED : EVENTS.SANCTION_WITHDRAWN,
      entity: { type: "sanction", id },
      actor: null,
      before: { status: "pending_approval" },
      after: { status: outcome },
      payload,
    });
  });
}

/* ------------------------------------------------------------------ *
 * ESS
 * ------------------------------------------------------------------ */

const listMine = (employeeId, query) => repo.listMine(pool, employeeId, query);

module.exports = { list, summary, get, nextStep, standing, propose, settle, listMine };
