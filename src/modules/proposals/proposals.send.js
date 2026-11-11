"use strict";
/**
 * Send Proposal (docs/guides/partnerships.md §6.10 step 5): nothing is sent without the person's
 * Confirm and Send (`confirm: true` in the request). In one transaction the proposal is marked sent with
 * the addresses, subject and message the person confirmed, its private link is issued (the token's hash
 * kept by public_token, the token itself encrypted on the proposal so Copy Link can show it), an earlier
 * version still out is withdrawn and its link stopped, and the kit's PDF is queued. Once the worker has
 * drawn the PDF, the mail goes from the system sender with the owner as reply-to, the PDF attached and the
 * link in it (`proposal-sent`).
 */
const { pool } = require("../../config/db");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const lagos = require("../../shared/time/lagos");
const documents = require("../../shared/documents/generate");
const publicToken = require("../../shared/tokens/public-token");
const encryption = require("../../services/secrets/encryption.service");
const pipelineRepo = require("../partner_pipeline/partner_pipeline.repo");
const repo = require("./proposals.repo");
const studio = require("./proposals.studio");
const service = require("./proposals.service");
const { EVENTS } = require("./proposals.events");

/** A proposal holds for 30 days from sending; the daily job expires it after (§13.2, In PR 7). */
const VALID_DAYS = 30;
/** The link's token outlives the validity a little, so the job, not the token, ends it. */
const TOKEN_HOURS = 24 * 45;

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function send(actor, id, body, scope) {
  const r = await service.seen(pool, id, scope);
  if (r.status !== "draft" || !r.content) throw service.refuse("Only a draft can be sent");
  const to = [...new Set(body.to.map((e) => e.toLowerCase()))];
  const cc = [...new Set((body.cc || []).map((e) => e.toLowerCase()))].filter((e) => !to.includes(e));
  const deal = await pipelineRepo.get(pool, r.deal_id, null);
  const today = lagos.today();
  await service.tx(async (client) => {
    const locked = await repo.lockProposal(client, id);
    if (!locked || locked.status !== "draft") throw service.refuse("Only a draft can be sent");
    const link = await publicToken.issue(client, {
      scope: "proposal.view",
      subject_type: "partnership_proposal",
      subject_id: id,
      ttl_hours: TOKEN_HOURS,
      created_by: actor.user_id,
    });
    const url = studio.linkOf(link.token);
    // The PDF is drawn from the content as it stands now, with the QR to this link.
    const context = await studio.kitContext(client, r, { link: url, deal });
    const doc = await documents.generate(client, {
      doc_type: "proposal",
      entity: { type: "partnership_proposal", id },
      data: { content: r.content, context, title: r.title || "" },
      actor,
    });
    // An earlier version still out stops: the partner reads only the newest.
    if (r.supersedes_id) {
      const before = await repo.getProposal(client, r.supersedes_id);
      if (before && ["sent", "viewed"].includes(before.status)) {
        await repo.updateProposal(client, before.partnership_proposal_id, { status: "withdrawn", withdrawn_at: new Date().toISOString(), link_secret: null });
        await publicToken.revokeFor(client, { subject_type: "partnership_proposal", subject_id: before.partnership_proposal_id, scope: "proposal.view" });
        await emit(client, { key: EVENTS.PROPOSAL_WITHDRAWN, entity: { type: "partnership_proposal", id: before.partnership_proposal_id }, actor, payload: { number: before.number, revised: true } });
      }
    }
    await repo.updateProposal(client, id, {
      status: "sent",
      sent_at: new Date().toISOString(),
      sent_to: to,
      sent_cc: cc,
      sent_subject: body.subject,
      sent_message: body.message,
      valid_until: addDays(today, VALID_DAYS),
      public_token_id: link.public_token_id,
      link_secret: encryption.encrypt(link.token, { aad: service.aadOf(id) }),
      document_id: doc.document_id,
    });
    await emit(client, {
      key: EVENTS.PROPOSAL_SENT,
      entity: { type: "partnership_proposal", id },
      actor,
      before: { status: "draft" },
      after: { status: "sent", sent_to: to, sent_cc: cc },
      payload: { number: r.number, deal_id: r.deal_id, document_id: doc.document_id, to: to.length, cc: cc.length },
    });
  });
  return service.reread(id, actor);
}

/**
 * After the worker drew a sent proposal's PDF: the mail, once. The link is read back from the proposal;
 * a proposal withdrawn before its PDF was ready sends nothing.
 */
async function mail(documentId) {
  const r = await repo.proposalOfDocument(pool, documentId);
  if (!r || !["sent", "viewed"].includes(r.status) || !r.link_secret || !r.sent_to || !r.sent_to.length) return null;
  let token;
  try {
    token = encryption.decrypt(r.link_secret, { aad: service.aadOf(r.partnership_proposal_id) });
  } catch {
    throw new AppError("PROPOSAL_LINK", "The proposal's link could not be read", 500);
  }
  const queues = require("../../jobs/queues");
  await queues.enqueue(
    "email-send",
    "proposal-sent",
    {
      to: r.sent_to.map((email) => ({ email })),
      cc: (r.sent_cc || []).map((email) => ({ email })),
      recipient: { first_name: null, last_name: null, email: r.sent_to[0] },
      template: "proposal-sent",
      data: {
        subject: r.sent_subject || r.title || r.number,
        message: r.sent_message || "",
        title: r.title || r.number,
        reference: r.number,
        partner_name: r.partner_name,
        link: studio.linkOf(token),
        valid_until: r.valid_until,
        owner_name: r.owner ? r.owner.display_name : "MyCity",
      },
      attachments: [{ document_id: documentId }],
      reply_to: r.owner_email || undefined,
    },
    { jobId: `proposal-sent-${r.partnership_proposal_id}` },
  );
  return true;
}

module.exports = { send, mail, VALID_DAYS };
