"use strict";
/**
 * The public Proposal page's reads (go.mycityapp.io/proposal/<token>; docs/guides/partnerships.md
 * §6.10 step 6, §10): the proposal as designed, its owner's contact, and the PDF that was sent. The link's
 * token is checked by `requirePublicToken` before anything here runs; a declined, expired or withdrawn
 * proposal's token is revoked, so its link answers as one that no longer works.
 *
 * Each opening is a `proposal_view`: the address is kept only as a keyed hash, never itself; the first
 * sets the proposal Viewed. Never imports auth or rbac (public routes, gate 9).
 */
const crypto = require("node:crypto");
const { pool } = require("../../config/db");
const { config } = require("../../config/env");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const vault = require("../../shared/documents/vault");
const pipelineRepo = require("../partner_pipeline/partner_pipeline.repo");
const repo = require("./proposals.repo");
const studio = require("./proposals.studio");
const kit = require("./proposals.kit");
const { EVENTS } = require("./proposals.events");

const gone = () => new AppError("TOKEN_INVALID", "This proposal is no longer available", 404);

/** The address of a view as a keyed hash: the same reader counts once, and nobody can read it back. */
const ipHash = (ip) => crypto.createHmac("sha256", String(config.JWT_ACCESS_SECRET || "proposal-views")).update(`proposal-view:${ip || ""}`).digest("hex");

async function liveProposal(link) {
  const r = await repo.getProposal(pool, link.subject_id);
  if (!r || !["sent", "viewed", "accepted"].includes(r.status) || !r.content) throw gone();
  return r;
}

/** The proposal as the partner reads it, and the view recorded. */
async function view(link, token, { ip, userAgent }) {
  const r = await liveProposal(link);
  const client = await pool.connect();
  try {
    await atomically(client, async () => {
      const seen = await repo.recordView(client, r.partnership_proposal_id, { ip_hash: ipHash(ip), user_agent: String(userAgent || "").slice(0, 400) || null });
      if (seen && seen.first)
        await emit(client, {
          key: EVENTS.PROPOSAL_VIEWED,
          entity: { type: "partnership_proposal", id: r.partnership_proposal_id },
          actor: null,
          payload: { number: r.number, deal_id: r.deal_id },
        });
    });
  } finally {
    client.release();
  }
  const deal = await pipelineRepo.get(pool, r.deal_id, null);
  const ctx = await studio.kitContext(pool, r, { link: studio.linkOf(token), deal });
  return {
    title: r.title || r.number,
    partner_name: r.partner_name,
    html: kit.renderProposal(r.content, ctx, { mode: "web" }).html,
    owner_contact: {
      name: r.owner ? r.owner.display_name : "MyCity",
      title: r.owner_title || null,
      email: r.owner_email || null,
      phone: r.owner_phone || null,
    },
    valid_until: r.valid_until,
  };
}

/** The PDF that was sent, as a download. */
async function pdf(link, req, res) {
  const r = await liveProposal(link);
  const doc = r.document_id ? await vault.get(pool, r.document_id) : null;
  if (!doc || doc.render_status !== "done") throw new AppError("DOCUMENT_RENDERING", "The PDF is being prepared", 409);
  return vault.serve(req, res, doc, { inline: false });
}

module.exports = { view, pdf, ipHash };
