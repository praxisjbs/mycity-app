"use strict";
/**
 * The consequence chain: MyCity's ladder as data (docs/guides/queries.md §6.5). Adding a
 * rung is inserting a row at a position; the rungs below move down in the same
 * transaction (the position key is checked at commit), so a new step needs no code.
 *
 * A rung names its letter (a sanction letter on Letter Templates), its financial effect,
 * its default length in days and how long it counts for the next offence. A rung with
 * sanctions is never deleted; it is retired (`active: false`) and no longer offered.
 * Every change needs `queries.configure` (the route) and is audited.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { oneNamed } = require("../../shared/ai/named");
const templates = require("../templates/templates.service");
const repo = require("./sanctions.repo");
const { EVENTS } = require("./sanctions.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** `Suspension Without Pay` → `suspension_without_pay`. */
function codeFrom(name) {
  const slug = String(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return slug || "step";
}

/** A rung as the contract shows it: whether its letter is ready to send. */
async function withLetter(db, step) {
  return { ...step, letter_ready: await templates.isReady(db, step.letter_template, "sanction") };
}

async function list(query) {
  const page = await repo.listSteps(pool, query);
  return { ...page, data: await Promise.all(page.data.map((s) => withLetter(pool, s))) };
}

async function assertLetter(db, key) {
  if (key && !(await repo.isSanctionLetter(db, key)))
    throw new AppError("LETTER_NOT_FOUND", "Pick a sanction letter", 422, { letter_template: ["Not a sanction letter"] });
}

/**
 * Rewrite every position 1..n in the order given. The unique key on position waits for
 * the commit, so rungs may pass through each other's numbers on the way.
 */
async function renumber(client, ordered) {
  for (let i = 0; i < ordered.length; i += 1) {
    if (ordered[i].position !== i + 1) await repo.updateStep(client, ordered[i].consequence_step_id, { position: i + 1 });
  }
}

async function create(actor, body) {
  const id = await tx(async (client) => {
    await repo.lockChain(client);
    await assertLetter(client, body.letter_template);
    let code = codeFrom(body.name);
    for (let n = 2; await repo.codeTaken(client, code); n += 1) code = codeFrom(`${body.name} ${n}`);
    const chain = await repo.allSteps(client);
    const at = Math.min(body.position || chain.length + 1, chain.length + 1);
    // Make room: the rungs from `at` down move one place.
    for (const [i, s] of chain.entries()) {
      const target = i + 1 >= at ? i + 2 : i + 1;
      if (s.position !== target) await repo.updateStep(client, s.consequence_step_id, { position: target });
    }
    const stepId = await repo.insertStep(client, {
      code,
      name: body.name,
      position: at,
      letter_template: body.letter_template,
      financial_effect: body.financial_effect,
      default_days: body.default_days,
      valid_days: body.valid_days,
      evidence_required: body.evidence_required,
      created_by: actor.user_id,
    });
    await emit(client, {
      key: EVENTS.CONSEQUENCE_STEP_SAVED,
      entity: { type: "consequence_step", id: stepId },
      actor,
      after: { code, name: body.name, position: at },
      payload: { consequence_step_id: stepId, code, position: at },
    });
    return stepId;
  });
  return withLetter(pool, await repo.getStep(pool, id));
}

async function update(actor, id, body) {
  await tx(async (client) => {
    await repo.lockChain(client);
    const before = await repo.getStep(client, id);
    if (!before) throw new AppError("NOT_FOUND", "That step does not exist", 404);
    if (body.letter_template) await assertLetter(client, body.letter_template);
    const { position, ...fields } = body;
    await repo.updateStep(client, id, fields);
    if (position !== undefined && position !== before.position) {
      const chain = (await repo.allSteps(client)).filter((s) => s.consequence_step_id !== id);
      const at = Math.min(position, chain.length + 1);
      chain.splice(at - 1, 0, before);
      await renumber(client, chain);
    }
    const after = await repo.getStep(client, id);
    await emit(client, {
      key: EVENTS.CONSEQUENCE_STEP_SAVED,
      entity: { type: "consequence_step", id },
      actor,
      before,
      after,
      payload: { consequence_step_id: id, code: after.code, position: after.position },
    });
  });
  return withLetter(pool, await repo.getStep(pool, id));
}

/*
 * Praxis AI's chain cards (docs/guides/praxis-ai.md §6.11, decision 33): the step a card names, by
 * its name, and a name matched to one. Nothing here writes.
 */

/** A step a card names by its name or code (shared/ai/named.js), retired ones included; null when none or several. */
async function idOf(db, words) {
  const found = oneNamed(await repo.allSteps(db), words, (s) => [s.name, s.code]);
  return found ? found.consequence_step_id : null;
}

/** The chain's steps, in ladder order, as answers to tap when a card asks which step (praxis-ai.md decision 34). */
const stepNames = async (db) => (await repo.allSteps(db)).map((s) => s.name);

/** The step a card changes, by its name. */
async function cardStep(db, id) {
  if (!db || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ""))) return [];
  const step = await repo.getStep(db, id);
  return step ? [{ type: "consequence_step", id, label: step.name }] : [];
}

/** Chain Settings' re-check: the step is there. */
async function assertCardStep(db, id) {
  if (!(await cardStep(db, id)).length) throw new AppError("NOT_FOUND", "That step does not exist", 404, { consequence_step_id: ["No such step"] });
}

module.exports = { codeFrom, list, create, update, withLetter, idOf, stepNames, cardStep, assertCardStep };
