"use strict";
/**
 * What the proposals module records (docs/guides/partnerships.md §7), and what follows each record
 * after its commit.
 *
 *   proof_point.created, proof_point.updated     Categories · Proof Points (M7 PR 2)
 *   proposal.started            New Proposal: the brief kept; the questions job is queued
 *   proposal.questions_ready    Claude's cards are in (or a failure is recorded on the proposal)
 *   proposal.draft_requested    Write Draft: the writing job is queued
 *   proposal.drafted            the draft is in, its figures checked
 *   proposal.edited             a section changed, moved, hidden or given an image
 *   proposal.sent               Confirm and Send: the PDF is drawn; the mail goes once it is
 *   proposal.viewed             the private link was opened the first time
 *   proposal.accepted, proposal.declined, proposal.withdrawn, proposal.expired, proposal.revised
 *   proposal.template_saved     Save as Template
 *
 * The owner is told of each through the bell when M7 PR 8 declares the Partnerships notifications
 * (§7, Appendix A PR 8); until then the events are the record. A proof point's image is a logo or a
 * picture, stored against the proof point (`proof_point_image`; its read rule is proposals.proof's). A
 * proposal's PDF is drawn by the design kit itself (`proposal`, locked once sent; a
 * draft's Download PDF is an export, `proposal_draft_pdf`), and a brief's transcript and pictures are
 * `proposal_source` and `proposal_asset` documents of the proposal.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const { defineDocumentType } = require("../../shared/documents/types");
const { defineDocType } = require("../../shared/documents/generate");
const { defineVariables } = require("../../shared/templates/variables");
const outbox = require("../../shared/events/outbox");
const vault = require("../../shared/documents/vault");
const c = require("@mycity/contract");

const EVENTS = defineEvents("partnerships", {
  "proof_point.created": { summary: "A proof point was added" },
  "proof_point.updated": { summary: "A proof point was changed, retired or restored" },
  "proposal.started": { summary: "A proposal was started from its brief" },
  "proposal.questions_ready": { summary: "A proposal's question cards are ready" },
  "proposal.draft_requested": { summary: "A proposal's draft was asked for" },
  "proposal.drafted": { summary: "A proposal was drafted" },
  "proposal.edited": { summary: "A proposal's content was edited" },
  "proposal.sent": { summary: "A proposal was sent" },
  "proposal.viewed": { summary: "A proposal's link was opened" },
  "proposal.accepted": { summary: "A proposal was marked accepted" },
  "proposal.declined": { summary: "A proposal was marked declined" },
  "proposal.withdrawn": { summary: "A proposal was withdrawn" },
  "proposal.expired": { summary: "A proposal passed its validity" },
  "proposal.revised": { summary: "A sent proposal was revised as a new version" },
  "proposal.template_saved": { summary: "A proposal was saved as a template" },
});

defineDocumentType("proof_point_image", { label: "Proof point image", module: "partnerships", sensitivity: "normal" });
defineDocumentType("proposal_source", { label: "Proposal transcript", module: "partnerships", sensitivity: "restricted" });
defineDocumentType("proposal_asset", { label: "Proposal image", module: "partnerships", sensitivity: "normal" });

/** The kit draws a proposal's PDF from what send() or pdf() gives it (proposals.kit.js). */
const draw = (data) => require("./proposals.kit").renderProposal(data.content, data.context, { mode: "pdf" }).html;
const titled = (data) => `${data.context.reference} ${data.title}`.trim();
defineDocType("proposal", { template: "proposal", label: "Proposal", module: "partnerships", sensitivity: "normal", title: titled, draw });
defineDocType("proposal_draft_pdf", { template: "proposal", label: "Proposal draft", module: "partnerships", sensitivity: "normal", export: true, title: titled, draw });

defineVariables("email", "proposal-sent", c.proposals.ProposalSentEmailVars);

const queues = () => require("../../jobs/queues");

/* After New Proposal and Try Again: Claude asks its question cards in the worker. */
outbox.register(EVENTS.PROPOSAL_STARTED, "proposals.ask", async (event) => {
  if (event.payload.queue === false) return;
  const id = event.entity.id;
  await queues().enqueue("proposal-questions", "ask", { partnership_proposal_id: id }, { jobId: `proposal-questions-${id}-${event.payload.attempt || 1}` });
});

/* After Write Draft: Claude writes the proposal in the worker. */
outbox.register(EVENTS.PROPOSAL_DRAFT_REQUESTED, "proposals.write", async (event) => {
  const id = event.entity.id;
  await queues().enqueue("proposal-draft", "write", { partnership_proposal_id: id }, { jobId: `proposal-draft-${id}-${event.payload.attempt || 1}` });
});

/* Once a sent proposal's PDF is drawn, the mail goes with it and the link. */
outbox.register(vault.EVENTS.DOCUMENT_GENERATED, "proposals.mail_sent", async (event) => {
  if (event.payload.doc_type !== "proposal") return;
  await require("./proposals.send").mail(event.payload.document_id);
});

module.exports = { EVENTS };
