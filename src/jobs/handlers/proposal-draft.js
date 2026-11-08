"use strict";
/**
 * Queue `proposal-draft`: a proposal written by Claude into the design kit's layouts, its figures checked
 * against their sources (docs/guides/partnerships.md §6.10 step 3). Queued by proposals.events.js after
 * Write Draft and Try Again; a proposal no longer writing is left alone. The last attempt's failure keeps
 * the brief and the answers and offers Try Again.
 */
const { UnrecoverableError } = require("bullmq");
const { isLastAttempt } = require("../registry");

module.exports = async function proposalDraft(job) {
  const id = job.data && job.data.partnership_proposal_id;
  if (!id) throw new UnrecoverableError("proposal-draft: no partnership_proposal_id");
  const drafted = await require("../../modules/proposals/proposals.draft").write(id, { last: isLastAttempt(job) });
  return { sections: drafted ? drafted.sections.length : 0 };
};
