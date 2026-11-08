"use strict";
/**
 * Queue `proposal-questions`: a proposal's question cards asked of Claude (docs/guides/partnerships.md
 * §6.10 step 2). Queued by proposals.events.js after New Proposal and Try Again; a proposal that already
 * has its cards, or that moved on, is left alone, so a job delivered twice asks once. The last attempt's
 * failure is kept on the proposal, which offers Try Again.
 */
const { UnrecoverableError } = require("bullmq");
const { isLastAttempt } = require("../registry");

module.exports = async function proposalQuestions(job) {
  const id = job.data && job.data.partnership_proposal_id;
  if (!id) throw new UnrecoverableError("proposal-questions: no partnership_proposal_id");
  const cards = await require("../../modules/proposals/proposals.questions").ask(id, { last: isLastAttempt(job) });
  return { cards };
};
