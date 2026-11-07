"use strict";
/**
 * The question cards (docs/guides/partnerships.md §6.10 step 2): Claude reads the brief, the record, the
 * category, its accepted proposals, the saved template and the proof points, and asks between 5 and 12
 * cards for what a strong proposal still needs (`proposal-questions`, Top Tier: Sonnet, then Gemini Pro).
 * The job runs in the worker (`proposal-questions`); a reshuffle asks for one card in the same group, on a
 * person's press. A failure keeps the brief and offers Try Again; AI off or capped says so on the proposal.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const ai = require("../../services/ai/llm.service");
const drafts = require("../../services/ai/drafts");
const repo = require("./proposals.repo");
const studio = require("./proposals.studio");
const { EVENTS } = require("./proposals.events");

const MODULE = "partnerships";
const now = () => new Date().toISOString();

async function setProgress(id, progress, extra = {}) {
  const client = await pool.connect();
  try {
    await atomically(client, () => repo.updateProposal(client, id, { progress, ...extra }));
  } finally {
    client.release();
  }
}

/**
 * Ask a proposal's cards (the `proposal-questions` job).
 * @param {string} id
 * @param {{last?: boolean}} [opts]  last: the job's final attempt, so a failure is recorded, not retried
 */
async function ask(id, { last = true } = {}) {
  const proposal = await repo.getProposal(pool, id);
  if (!proposal || proposal.status !== "questions" || !proposal.progress || proposal.progress.failed) return null;
  const existing = await repo.questionsOf(pool, id);
  if (existing.length) return null;
  const { input } = await studio.inputFor(pool, proposal, { actorUser: null, answers: false });
  await setProgress(id, { job: "questions", step: "asking", failed: false, reason: null, at: now() });
  let run;
  try {
    run = await ai.complete({
      purpose: "proposal-questions",
      module: MODULE,
      actor: proposal.created_by,
      input,
      output: c.proposals.ProposalQuestionsOutput,
      egress: "external",
      temperature: 0.4,
    });
  } catch (err) {
    const reason = drafts.offReason(err);
    if (reason || last) await setProgress(id, { job: "questions", step: "asking", failed: true, reason: reason || "error", at: now() });
    if (reason) return null;
    throw err;
  }
  if (!run.output) {
    await setProgress(id, { job: "questions", step: "asking", failed: true, reason: "off", at: now() });
    return null;
  }
  const client = await pool.connect();
  try {
    await atomically(client, async () => {
      const locked = await repo.lockProposal(client, id);
      if (!locked || locked.status !== "questions") return;
      for (const [i, card] of run.output.cards.entries()) await repo.insertQuestion(client, id, { ...card, position: i });
      await repo.updateProposal(client, id, { progress: null, ai_run_id: run.run_id || null });
      await emit(client, {
        key: EVENTS.PROPOSAL_QUESTIONS_READY,
        entity: { type: "partnership_proposal", id },
        actor: proposal.created_by,
        payload: { number: proposal.number, cards: run.output.cards.length },
      });
    });
  } finally {
    client.release();
  }
  return run.output.cards.length;
}

/**
 * One card in place of another, from the same group, different from every card asked. On a person's
 * press, outside any transaction. AI off or capped is refused in the person's words.
 */
async function reshuffle(actor, proposal, card, cards) {
  const now = await drafts.availability(pool, MODULE);
  if (!now.available) throw new AppError("AI_UNAVAILABLE", now.reason === "limit" ? "AI Limit Reached" : "AI Is Off", 409);
  const { input } = await studio.inputFor(pool, proposal, { actorUser: actor, answers: true });
  const output = c.proposals.ProposalReshuffleOutput.superRefine((v, ctx) => {
    if (v.card.group_key !== card.group_key) ctx.addIssue({ code: "custom", path: ["card", "group_key"], message: `must be ${card.group_key}` });
  });
  let run;
  try {
    run = await ai.complete({
      purpose: "proposal-questions",
      module: MODULE,
      actor,
      input: {
        ...input,
        reshuffle: {
          replace: { question: card.question, group: card.group_key },
          asked: cards.filter((q) => q.state !== "replaced").map((q) => q.question),
        },
      },
      output,
      egress: "external",
      temperature: 0.7,
    });
  } catch (err) {
    const reason = drafts.offReason(err);
    if (reason) throw new AppError("AI_UNAVAILABLE", reason === "limit" ? "AI Limit Reached" : "AI Is Off", 409);
    throw err;
  }
  if (!run.output) throw new AppError("AI_UNAVAILABLE", "AI Is Off", 409);
  return run.output.card;
}

module.exports = { ask, reshuffle };
