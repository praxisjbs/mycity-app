"use strict";
/**
 * Claude's writing (docs/guides/partnerships.md §6.10 steps 3 to 5): the draft (the `proposal-draft`
 * job), a section rewritten (Rewrite Section) and the covering email (Write With AI in Send Proposal).
 *
 * The draft is structured content in the kit's layouts. The server checks it against the contract and its
 * figures against their sources: a draft with an unsourced figure is asked for once more with those
 * figures named; what is still unsourced is marked for the person to confirm, and Send lists it. The
 * studio sees the job's step (Reading, Writing, Checking Figures, Laying Out). A failure keeps the brief and
 * the answers and offers Try Again. Nothing a rewrite or the message drafts is kept until the person
 * uses it.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const lagos = require("../../shared/time/lagos");
const ai = require("../../services/ai/llm.service");
const drafts = require("../../services/ai/drafts");
const partnersRepo = require("../partners/partners.repo");
const repo = require("./proposals.repo");
const content = require("./proposals.content");
const studio = require("./proposals.studio");
const kit = require("./proposals.kit");
const { EVENTS } = require("./proposals.events");

const MODULE = "partnerships";
const now = () => new Date().toISOString();

async function inTx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const step = (id, name) => inTx((client) => repo.updateProposal(client, id, { progress: { job: "draft", step: name, failed: false, reason: null, at: now() } }));

/** Fill what the kit takes from the system, not from Claude: the reference, the date, the brief's pictures. */
function settle(drafted, { proposal, assets, owner }) {
  const cover = (assets.find((a) => a.role === "cover") || {}).proposal_asset_id || null;
  const logo = (assets.find((a) => a.role === "logo") || {}).proposal_asset_id || null;
  return {
    sections: drafted.sections.map((s) => {
      if (s.layout === "cover") return { ...s, reference: proposal.number, date: lagos.today(), image_asset_id: cover, partner_logo_asset_id: logo };
      if (s.layout === "next_steps") return { ...s, contact: { name: owner.name, title: owner.title, email: owner.email, phone: owner.phone } };
      if (s.layout === "letter") return { ...s, signer_name: owner.name, signer_title: owner.title || s.signer_title, signer_photo_asset_id: null };
      if (s.layout === "closing") return { ...s, image_asset_id: null };
      return s;
    }),
  };
}

/**
 * Write a proposal's draft (the `proposal-draft` job).
 * @param {string} id
 * @param {{last?: boolean}} [opts]  the job's final attempt: a failure is recorded, not retried
 */
async function write(id, { last = true } = {}) {
  const proposal = await repo.getProposal(pool, id);
  if (!proposal || proposal.status !== "writing") return null;
  const { input, deal, proofPoints } = await studio.inputFor(pool, proposal, { actorUser: null, answers: true });
  const assets = await repo.assetsOf(pool, id);
  const owner = { name: proposal.owner ? proposal.owner.display_name : "MyCity", title: proposal.owner_title || null, email: proposal.owner_email || null, phone: proposal.owner_phone || null };
  const known = content.knownOf({ deal, proofPoints });
  const fail = async (reason) =>
    inTx(async (client) => {
      await repo.updateProposal(client, id, { status: "questions", progress: { job: "draft", step: "writing", failed: true, reason, at: now() } });
    });

  const ask = async (extra) => {
    const run = await ai.complete({
      purpose: "proposal-draft",
      module: MODULE,
      actor: proposal.created_by,
      input: { ...input, ...extra },
      output: c.proposals.ProposalDraftOutput,
      egress: "external",
      temperature: 0.5,
    });
    if (!run.output) return null;
    return { run, checked: content.checkFigures(settle(run.output.content, { proposal, assets, owner }), known) };
  };

  let first;
  let second = null;
  try {
    await step(id, "writing");
    first = await ask({});
    if (!first) return fail("off");
    await step(id, "checking");
    if (first.checked.unsourced.length) {
      // Asked once more, the unsourced figures named; whatever is still unsourced is marked for the person.
      second = await ask({ unsourced_figures: first.checked.unsourced, previous: first.run.output.content });
    }
  } catch (err) {
    const reason = drafts.offReason(err);
    if (reason || last) await fail(reason || "error");
    if (reason) return null;
    throw err;
  }
  const chosen = second && second.checked.unsourced.length <= first.checked.unsourced.length ? second : first;
  const finished = c.proposals.ProposalContent.parse(content.markUnconfirmed(chosen.checked.content, chosen.checked.unsourced));
  await step(id, "laying_out");
  // Drawn once here, so a draft the kit cannot lay out fails in the job, never on the screen.
  kit.renderProposal(finished, { reference: proposal.number, seed: proposal.number }, { mode: "pdf" });
  await inTx(async (client) => {
    const locked = await repo.lockProposal(client, id);
    if (!locked || locked.status !== "writing") return;
    await repo.updateProposal(client, id, {
      status: "draft",
      title: chosen.run.output.title,
      content: finished,
      brief: { tone_notes: chosen.run.output.tone_notes || null },
      progress: null,
      ai_run_id: chosen.run.run_id || null,
    });
    await emit(client, {
      key: EVENTS.PROPOSAL_DRAFTED,
      entity: { type: "partnership_proposal", id },
      actor: proposal.created_by,
      payload: { number: proposal.number, sections: finished.sections.length, unconfirmed: chosen.checked.unsourced.length },
    });
  });
  return finished;
}

const off = (reason, key) => ({ available: false, reason, key, section: null, ai_run_id: null });

/** Rewrite Section: Claude's new version of one section on the person's instruction; nothing kept. */
async function rewrite(actor, proposal, key, instruction) {
  const section = proposal.content.sections.find((s) => s.key === key);
  if (!section) throw new AppError("NOT_FOUND", "That page is not in this proposal", 404);
  const now = await drafts.availability(pool, MODULE);
  if (!now.available) return off(now.reason, key);
  const { input, deal, proofPoints } = await studio.inputFor(pool, proposal, { actorUser: actor, answers: true });
  const output = c.proposals.ProposalRewriteOutput.superRefine((v, ctx) => {
    if (v.section.key !== key || v.section.layout !== section.layout)
      ctx.addIssue({ code: "custom", path: ["section"], message: `must keep key ${key} and layout ${section.layout}` });
  });
  let run;
  try {
    run = await ai.complete({
      purpose: "proposal-rewrite",
      module: MODULE,
      actor,
      input: { instruction, section, proposal: proposal.content.sections.map((s) => ({ key: s.key, layout: s.layout })), record: input.record, answers: input.answers, brief: input.brief, proof_points: input.proof_points },
      output,
      egress: "external",
      temperature: 0.5,
    });
  } catch (err) {
    const reason = drafts.offReason(err);
    if (reason) return off(reason, key);
    throw err;
  }
  if (!run.output) return off("off", key);
  const checked = content.checkFigures({ sections: [run.output.section] }, content.knownOf({ deal, proofPoints }));
  const marked = content.markUnconfirmed(checked.content, checked.unsourced).sections[0];
  return { available: true, reason: null, key, section: c.proposals.Section.parse(marked), ai_run_id: run.run_id || null };
}

/** Write With AI: the covering email's subject and message; nothing kept. */
async function message(actor, proposal) {
  const none = (reason) => ({ available: false, reason, subject: null, message: null, ai_run_id: null });
  const now = await drafts.availability(pool, MODULE);
  if (!now.available) return none(now.reason);
  const kind = proposal.partner_id ? "partner" : "lead";
  const contacts = await partnersRepo.contactsOf(pool, { kind, id: proposal.partner_id || proposal.lead_id });
  const primary = contacts.find((ct) => ct.primary_contact) || contacts[0] || null;
  let run;
  try {
    run = await ai.complete({
      purpose: "proposal-message",
      module: MODULE,
      actor,
      input: {
        title: proposal.title,
        partner: proposal.partner_name,
        contact_first_name: primary ? primary.first_name : null,
        deal: proposal.deal_title,
        owner: { name: proposal.owner ? proposal.owner.display_name : null, title: proposal.owner_title || null },
      },
      output: c.proposals.ProposalMessageOutput,
      egress: "external",
      temperature: 0.6,
    });
  } catch (err) {
    const reason = drafts.offReason(err);
    if (reason) return none(reason);
    throw err;
  }
  if (!run.output) return none("off");
  return { available: true, reason: null, subject: run.output.subject, message: run.output.message, ai_run_id: run.run_id || null };
}

module.exports = { write, rewrite, message, settle };
