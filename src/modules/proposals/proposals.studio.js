"use strict";
/**
 * The Proposal Studio's inputs (docs/guides/partnerships.md §6.10, §6.11): what Claude reads for a
 * proposal, and what the design kit is given to draw one. Reads only; never writes.
 *
 * Claude reads the brief (notes, a transcript), the record (the lead or partner, the deal, its options,
 * dates and venue, category, region, impact, the latest interactions), up to three of the category's
 * accepted proposals (for their tone), the saved template, MyCity's proof points and the answers. Money
 * the reader may not see (`partnerships.money`: a deal's commission and the merchant's take) is left out
 * of what Claude reads for them, as the screens leave it out (§6.1).
 */
const { config } = require("../../config/env");
const { pageQuery, TOTAL_COL } = require("../../shared/http/paged");
const storage = require("../../services/storage/storage.service");
const vault = require("../../shared/documents/vault");
const { orgProfile } = require("../../shared/documents/generate");
const lagos = require("../../shared/time/lagos");
const deals = require("../partner_pipeline/partner_pipeline.service");
const pipelineRepo = require("../partner_pipeline/partner_pipeline.repo");
const partnersRepo = require("../partners/partners.repo");
const repo = require("./proposals.repo");

/** A transcript longer than this is cut for Claude (about 25,000 words). */
const TRANSCRIPT_CHARS = 150000;
/** Pictures larger than this are left to their stand-ins rather than drawn into every page. */
const PICTURE_BYTES = 6 * 1024 * 1024;

/** The deal behind a proposal, with the money the actor may see. */
async function dealOf(db, proposal, actorUser) {
  const held = actorUser ? await deals.holdsMoney(actorUser) : false;
  return deals.detailFor(db, proposal.deal_id, held);
}

/** The deal's lead or partner, its contacts and its latest interactions, as Claude reads them. */
async function recordOf(db, deal) {
  const kind = deal.partner_id ? "partner" : "lead";
  const id = deal.partner_id || deal.lead_id;
  const contacts = await partnersRepo.contactsOf(db, { kind, id });
  const latest = await pageQuery(
    db,
    `SELECT interaction_type, occurred_at, subject, summary, ${TOTAL_COL} FROM partner_interaction
      WHERE ${kind}_id = $1 ORDER BY occurred_at DESC, partner_interaction_id`,
    [id],
    { page: 1 },
  );
  const interactions = latest.data.map(({ interaction_type, occurred_at, subject, summary }) => ({ interaction_type, occurred_at, subject, summary }));
  return {
    kind,
    name: deal.record.name,
    category: deal.category,
    contacts: contacts.slice(0, 5).map((ct) => ({ name: `${ct.first_name} ${ct.last_name}`.trim(), title: ct.job_title || null, primary: ct.primary_contact === true })),
    interactions: interactions.slice(0, 5),
  };
}

/** The category's delivery checklist: what MyCity delivers on a signed deal of it. */
async function checklistOf(db, deal) {
  if (!deal.partner_category_id) return [];
  const items = await pipelineRepo.checklistOf(db, deal.partner_category_id);
  return items.filter((i) => i.active !== false).map((i) => i.title);
}

/** The deal as Claude reads it: its words, figures and dates, never ids it cannot use. */
function dealFacts(deal) {
  return {
    title: deal.title,
    number: deal.number,
    objective: deal.objective || null,
    stage: deal.stage_label,
    projected_value: deal.estimated_value,
    currency: deal.currency,
    expected_close_on: deal.expected_close_on,
    event_title: deal.event_title,
    event_starts_on: deal.event_starts_on,
    event_ends_on: deal.event_ends_on,
    venue: deal.venue ? deal.venue.formatted || deal.venue.details || null : null,
    expected_attendance: deal.expected_attendance,
    commission_pct: deal.commission_pct ?? null,
    validity_days: deal.validity_days,
    valid_until: deal.valid_until,
    impact: deal.impact,
    options: (deal.options || []).map((o) => ({
      label: o.label,
      original_price: o.original_price,
      discount_pct: o.discount_pct,
      deal_price: o.deal_price,
      price_note: o.price_note,
      ...(o.commission_amount !== undefined ? { commission_amount: o.commission_amount, merchant_take: o.merchant_take } : {}),
    })),
  };
}

/** The brief: the notes and the transcript's text. */
async function briefOf(db, proposalId) {
  const sources = await repo.sourcesOf(db, proposalId);
  const notes = sources.filter((s) => s.kind === "notes").map((s) => s.text).join("\n\n") || null;
  const transcript = sources.filter((s) => s.kind === "transcript").map((s) => s.text || "").join("\n\n").slice(0, TRANSCRIPT_CHARS) || null;
  return { notes, transcript, sources };
}

/** Everything Claude reads for a proposal's questions or its draft. */
async function inputFor(db, proposal, { actorUser = null, answers = true } = {}) {
  const deal = await dealOf(db, proposal, actorUser);
  const [record, checklist, brief, past, proofPoints] = await Promise.all([
    recordOf(db, deal),
    checklistOf(db, deal),
    briefOf(db, proposal.partnership_proposal_id),
    repo.acceptedOfCategory(db, deal.partner_category_id, proposal.partnership_proposal_id),
    repo.activeProofPoints(db),
  ]);
  const template = proposal.design_template_id ? await repo.getTemplate(db, proposal.design_template_id) : null;
  const cards = answers ? await repo.questionsOf(db, proposal.partnership_proposal_id) : [];
  return {
    deal,
    proofPoints,
    input: {
      brief: { notes: brief.notes, transcript: brief.transcript },
      record: { ...record, deal: dealFacts(deal) },
      category: { name: deal.category, checklist },
      past_proposals: past,
      template: template ? template.structure : null,
      proof_points: proofPoints.map((p) => ({ id: p.proof_point_id, kind: p.kind, label: p.label, value: p.value, detail: p.detail })),
      answers: cards
        .filter((q) => q.state === "answered")
        .map((q) => ({ id: q.proposal_question_id, group: q.group_key, question: q.question, answer: q.answer })),
      reference: proposal.number,
      date: lagos.today(),
      owner: { name: proposal.owner ? proposal.owner.display_name : null, title: proposal.owner_title || null },
    },
  };
}

/* ------------------------------------------------------------------ *
 * What the kit is given
 * ------------------------------------------------------------------ */

/** A stored picture as a data URL, or null when it is too large or missing. */
async function dataUrlOf(doc) {
  if (!doc || !doc.storage_key || !/^image\//.test(doc.mime || "") || Number(doc.bytes || 0) > PICTURE_BYTES) return null;
  try {
    const bytes = await storage.get(doc.storage_key);
    return `data:${doc.mime};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}

/** The public link of a proposal from its token. */
const linkOf = (token) => `${String(config.PUBLIC_ORIGIN || "").replace(/\/$/, "")}/proposal/${token}`;

/**
 * The kit's context for a proposal: its pictures and the proof points' logos as data URLs, MyCity's
 * mark, the deal's event, and the QR to its link once it has one.
 */
async function kitContext(db, proposal, { link = null, deal = null } = {}) {
  const assets = await repo.assetsOf(db, proposal.partnership_proposal_id);
  const images = {};
  for (const a of assets) {
    const src = await dataUrlOf(a);
    if (src) images[a.proposal_asset_id] = { src, alt: a.alt };
  }
  const proofImages = {};
  for (const p of await repo.activeProofPoints(db)) {
    if (!p.document_id) continue;
    const src = await dataUrlOf(await vault.get(db, p.document_id));
    if (src) proofImages[p.proof_point_id] = src;
  }
  const org = await orgProfile(db);
  let qr = null;
  if (link) {
    try {
      qr = await require("../../services/qr/qr").dataUrl(link, { width: 320 });
    } catch {
      qr = null;
    }
  }
  return {
    reference: proposal.number,
    seed: proposal.number,
    org: { display_name: org.display_name, website: org.website || null, mark_white: org.logo_white ? org.logo_white.data : null },
    images,
    proofImages,
    qr,
    event: deal ? { starts_on: deal.event_starts_on || null, ends_on: deal.event_ends_on || null } : null,
  };
}

module.exports = { inputFor, dealOf, briefOf, kitContext, linkOf, dataUrlOf, TRANSCRIPT_CHARS };
