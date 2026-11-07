"use strict";
/**
 * Proposals and the Proposal Studio (docs/guides/partnerships.md §3 step 4, §6.10, §6.11): a proposal on
 * a deal, briefed, questioned and drafted by Claude in the worker, edited on screen, sent by a person who
 * confirms where it goes (proposals.send), followed through its link (proposals.public), decided,
 * withdrawn, expired, revised and saved as a template.
 *
 * A proposal is seen and changed with its deal (§6.1): a reader who may see the deal may open its
 * proposals, and one who may edit may work on them. Every write is one transaction with its event.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const numbering = require("../../shared/numbering/numbering");
const lagos = require("../../shared/time/lagos");
const vault = require("../../shared/documents/vault");
const exportFiles = require("../../shared/documents/exports");
const documents = require("../../shared/documents/generate");
const publicToken = require("../../shared/tokens/public-token");
const grantsCache = require("../../shared/rbac/grants-cache");
const encryption = require("../../services/secrets/encryption.service");
const drafts = require("../../services/ai/drafts");
const pipelineRepo = require("../partner_pipeline/partner_pipeline.repo");
const repo = require("./proposals.repo");
const content = require("./proposals.content");
const studio = require("./proposals.studio");
const kit = require("./proposals.kit");
const { EVENTS } = require("./proposals.events");

const MODULE = "partnerships";
const CONFIGURE = "partnerships.configure";
/** A transcript is Markdown or plain text, at most 1 MB (§6.10). */
const TRANSCRIPT_TYPES = new Set(["text/plain", "text/markdown"]);
const TRANSCRIPT_BYTES = 1024 * 1024;

const tx = async (fn) => {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
};

const notFound = () => new AppError("NOT_FOUND", "That proposal does not exist, or you cannot see it", 404);
const refuse = (message, fields) => new AppError("PROPOSAL_STATE", message, 409, fields);
const now = () => new Date().toISOString();
const aadOf = (id) => `partnership_proposal:${id}:link`;

/** The private link of a proposal while its token works. */
function linkOf(row) {
  if (!row.link_secret) return null;
  try {
    return studio.linkOf(encryption.decrypt(row.link_secret, { aad: aadOf(row.partnership_proposal_id) }));
  } catch {
    return null;
  }
}

/** Whether Claude can be asked now: on, off, or the month's cap reached. */
async function aiState(db) {
  const a = await drafts.availability(db, MODULE);
  return a.available ? "on" : a.reason === "limit" ? "capped" : "off";
}

const holdsConfigure = async (actor) =>
  Boolean(actor && (actor.is_ceo === true || (await grantsCache.getCapabilities(pool, actor.user_id)).includes(CONFIGURE)));

const docRef = (d) => ({ document_id: d.document_id, file_name: d.original_name || "file", size_bytes: Number(d.bytes || 0), mime_type: d.mime || "application/octet-stream" });

/** A proposal row as a list shows it. */
const rowOf = (r) => ({
  partnership_proposal_id: r.partnership_proposal_id,
  number: r.number,
  version: r.version,
  title: r.title,
  status: r.status,
  value: r.value,
  currency: r.currency,
  record: r.record,
  deal_id: r.deal_id,
  deal_title: r.deal_title,
  owner: r.owner,
  sent_at: r.sent_at,
  first_viewed_at: r.first_viewed_at,
  view_count: r.view_count,
  valid_until: r.valid_until,
  created_at: r.created_at,
});

/** The proposal whole, as the studio edits it. */
async function detailOf(db, r, actor) {
  const [questions, brief, assets, versions, ai, configure] = await Promise.all([
    repo.questionsOf(db, r.partnership_proposal_id),
    studio.briefOf(db, r.partnership_proposal_id),
    repo.assetsOf(db, r.partnership_proposal_id),
    repo.versionsOf(db, r.partnership_proposal_id),
    aiState(db),
    holdsConfigure(actor),
  ]);
  const byId = new Map(questions.map((q) => [q.proposal_question_id, q]));
  const reshufflesOf = (q) => {
    let n = 0;
    for (let at = q; at && at.replaces_id && n < 3; at = byId.get(at.replaces_id)) n += 1;
    return n;
  };
  const transcript = brief.sources.find((s) => s.kind === "transcript" && s.document_id);
  const newest = versions.length === 0 || versions[0].partnership_proposal_id === r.partnership_proposal_id;
  const out = ["sent", "viewed"].includes(r.status);
  return {
    ...rowOf(r),
    brief: {
      notes: brief.notes,
      transcript: transcript ? docRef({ document_id: transcript.document_id, original_name: transcript.original_name, bytes: transcript.bytes, mime: transcript.mime }) : null,
    },
    questions: questions.slice(0, 40).map((q) => ({
      proposal_question_id: q.proposal_question_id,
      position: q.position,
      group_key: q.group_key,
      question: q.question,
      why: q.why,
      answer_kind: q.answer_kind,
      options: q.options,
      suggested: q.suggested ?? null,
      suggested_from: q.suggested_from,
      required: q.required,
      answer: q.answer ?? null,
      state: q.state,
      replaces_id: q.replaces_id,
      reshuffles: reshufflesOf(q),
    })),
    content: r.content,
    assets: assets.slice(0, 25).map((a) => ({
      proposal_asset_id: a.proposal_asset_id,
      document: docRef(a),
      role: a.role,
      section_key: a.section_key,
      alt: a.alt,
      stand_in: a.stand_in,
    })),
    design_template_id: r.design_template_id,
    sent_to: r.sent_to || [],
    sent_cc: r.sent_cc || [],
    last_viewed_at: r.last_viewed_at,
    accepted_at: r.accepted_at,
    declined_at: r.declined_at,
    decline_reason: r.decline_reason,
    withdrawn_at: r.withdrawn_at,
    supersedes_id: r.supersedes_id,
    link_url: out || r.status === "accepted" ? linkOf(r) : null,
    ai,
    progress: r.progress,
    versions,
    can: {
      edit: r.status === "draft",
      send: r.status === "draft" && Boolean(r.content),
      revise: newest && ["sent", "viewed", "declined", "expired", "withdrawn"].includes(r.status),
      decide: out,
      withdraw: out,
      save_template: Boolean(r.content) && configure,
    },
  };
}

/** One proposal the reader may see, or a 404. */
async function seen(db, id, scope) {
  const r = await repo.getProposal(db, id, scope);
  if (!r) throw notFound();
  return r;
}

const reread = async (id, actor) => detailOf(pool, await repo.getProposal(pool, id), actor);

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

async function list(query, scope) {
  const page = await repo.listProposals(pool, query, scope);
  return { ...page, data: page.data.map(rowOf) };
}

async function summary(scope) {
  const f = await repo.proposalFigures(pool, scope, Number(lagos.today().slice(0, 4)));
  return {
    sent_this_year: f.sent_this_year,
    accepted: f.accepted,
    viewed_no_reply: f.viewed_no_reply,
    acceptance_rate: f.decided ? Math.round((f.accepted / f.decided) * 100) : null,
  };
}

async function get(actor, id, scope) {
  return detailOf(pool, await seen(pool, id, scope), actor);
}

/** The kit's HTML of a proposal as it stands, and what the studio's controls need beside it. */
async function preview(actor, id, scope) {
  const r = await seen(pool, id, scope);
  if (!r.content) throw refuse("This proposal has no draft yet");
  const deal = await pipelineRepo.get(pool, r.deal_id, null);
  const ctx = await studio.kitContext(pool, r, { link: linkOf(r), deal });
  return kit.renderProposal(r.content, ctx, { mode: "studio" });
}

/* ------------------------------------------------------------------ *
 * New Proposal
 * ------------------------------------------------------------------ */

/** A transcript as Claude reads it: Markdown or text, at most 1 MB; a PDF or Word file is refused. */
async function transcriptText(client, documentId) {
  const doc = await vault.get(client, documentId);
  if (!doc) throw new AppError("VALIDATION", "Upload the transcript again", 422, { transcript_document_id: ["Upload it again"] });
  if (!TRANSCRIPT_TYPES.has(doc.mime)) throw new AppError("VALIDATION", "Upload Markdown or text", 422, { transcript_document_id: ["Upload Markdown or text"] });
  if (Number(doc.bytes) > TRANSCRIPT_BYTES) throw new AppError("VALIDATION", "At most 1 MB", 422, { transcript_document_id: ["At most 1 MB"] });
  const storage = require("../../services/storage/storage.service");
  return Buffer.from(await storage.get(doc.storage_key)).toString("utf8").replace(/^﻿/, "");
}

async function start(actor, body, scope) {
  const deal = await pipelineRepo.get(pool, body.deal_id, scope);
  if (!deal) throw new AppError("NOT_FOUND", "That deal does not exist, or you cannot see it", 404, { deal_id: ["Pick a deal"] });
  if (!["open", "live"].includes(deal.status)) throw new AppError("VALIDATION", "That deal is closed", 422, { deal_id: ["That deal is closed"] });
  if (body.design_template_id) {
    const t = await repo.getTemplate(pool, body.design_template_id);
    if (!t || !t.active) throw new AppError("VALIDATION", "Pick a template", 422, { design_template_id: ["Pick a template"] });
  }
  const ai = await aiState(pool);
  const id = await tx(async (client) => {
    const transcript = body.transcript_document_id ? await transcriptText(client, body.transcript_document_id) : null;
    const { number } = await numbering.allocate(client, "proposal");
    const progress = ai === "on"
      ? { job: "questions", step: "reading", failed: false, reason: null, at: now() }
      : { job: "questions", step: "reading", failed: true, reason: ai === "capped" ? "limit" : "off", at: now() };
    const { partnership_proposal_id: pid } = await repo.insertProposal(client, {
      deal_id: deal.deal_id,
      number,
      status: "questions",
      value: deal.estimated_value,
      currency: deal.currency,
      title: deal.title,
      design_template_id: body.design_template_id || null,
      progress,
      created_by: actor.user_id,
    });
    const entity = { type: "partnership_proposal", id: pid };
    if (body.notes) await repo.insertSource(client, pid, { kind: "notes", text: body.notes });
    if (body.transcript_document_id) {
      await vault.claim(client, { document_id: body.transcript_document_id, doc_type: "proposal_source", entity, actor, field: "transcript_document_id" });
      await repo.insertSource(client, pid, { kind: "transcript", document_id: body.transcript_document_id, text: transcript });
    }
    for (const [i, a] of (body.assets || []).entries()) {
      const doc = await vault.claim(client, { document_id: a.document_id, doc_type: "proposal_asset", entity, actor, field: `assets.${i}.document_id` });
      if (!/^image\//.test(doc.mime || "")) throw new AppError("VALIDATION", "Upload an image", 422, { [`assets.${i}.document_id`]: ["Upload an image"] });
      await repo.insertAsset(client, pid, a);
    }
    await emit(client, {
      key: EVENTS.PROPOSAL_STARTED,
      entity,
      actor,
      after: { number, deal_id: deal.deal_id, status: "questions" },
      payload: { number, deal_id: deal.deal_id, queue: ai === "on" },
    });
    return pid;
  });
  return reread(id, actor);
}

/** Try Again: the questions or the draft asked of Claude once more, the brief and answers kept. */
async function retry(actor, id, scope) {
  const r = await seen(pool, id, scope);
  if (!r.progress || !r.progress.failed) throw refuse("Nothing to try again");
  const ai = await aiState(pool);
  if (ai !== "on") throw refuse(ai === "capped" ? "AI Limit Reached" : "AI Is Off");
  const job = r.progress.job;
  await tx(async (client) => {
    await repo.lockProposal(client, id);
    if (job === "questions") await repo.clearQuestions(client, id);
    await repo.updateProposal(client, id, {
      status: job === "questions" ? "questions" : "writing",
      progress: { job, step: "reading", failed: false, reason: null, at: now() },
    });
    const attempt = Date.now();
    await emit(client, {
      key: job === "questions" ? EVENTS.PROPOSAL_STARTED : EVENTS.PROPOSAL_DRAFT_REQUESTED,
      entity: { type: "partnership_proposal", id },
      actor,
      payload: { number: r.number, attempt, retry: true },
    });
  });
  return reread(id, actor);
}

/* ------------------------------------------------------------------ *
 * The question cards
 * ------------------------------------------------------------------ */

/** An answer held to its card's kind. */
function checkAnswer(q, answer) {
  const bad = (m) => new AppError("VALIDATION", m, 422, { answer: [m] });
  if (answer === null || answer === "" || (Array.isArray(answer) && !answer.length)) throw bad("Give an answer");
  switch (q.answer_kind) {
    case "short_text":
      if (typeof answer !== "string" || answer.trim().length > 200) throw bad("At most 200 characters");
      return answer.trim();
    case "long_text":
      if (typeof answer !== "string") throw bad("Give an answer");
      return answer.trim();
    case "number":
      if (typeof answer !== "number" || !Number.isFinite(answer)) throw bad("Give a number");
      return answer;
    case "money":
      if (!c.common.money.safeParse(answer).success) throw bad("Give an amount");
      return answer;
    case "date":
      if (!c.common.isoDate.safeParse(answer).success) throw bad("Not a real date");
      return answer;
    case "pick":
      if (typeof answer !== "string" || !(q.options || []).includes(answer)) throw bad("Pick an option");
      return answer;
    case "multi_pick":
      if (!Array.isArray(answer) || answer.some((a) => !(q.options || []).includes(a))) throw bad("Pick the options");
      return answer;
    default:
      throw bad("Give an answer");
  }
}

async function cardOf(client, id, qid) {
  const q = await repo.getQuestion(client, id, qid);
  if (!q || q.state === "replaced") throw new AppError("NOT_FOUND", "That card is not in this proposal", 404);
  return q;
}

async function answer(actor, id, qid, body, scope) {
  const r = await seen(pool, id, scope);
  if (!["questions", "draft"].includes(r.status)) throw refuse("The cards are closed");
  await tx(async (client) => {
    await repo.lockProposal(client, id);
    const q = await cardOf(client, id, qid);
    await repo.updateQuestion(client, qid, { answer: checkAnswer(q, body.answer), state: "answered" });
    await emit(client, { key: EVENTS.PROPOSAL_EDITED, entity: { type: "partnership_proposal", id }, actor, payload: { number: r.number, card: qid, answered: true } });
  });
  return reread(id, actor);
}

async function skip(actor, id, qid, scope) {
  const r = await seen(pool, id, scope);
  if (!["questions", "draft"].includes(r.status)) throw refuse("The cards are closed");
  await tx(async (client) => {
    await repo.lockProposal(client, id);
    const q = await cardOf(client, id, qid);
    if (q.required) throw refuse("Answer this card", { answer: ["Required card"] });
    await repo.updateQuestion(client, qid, { answer: null, state: "skipped" });
    await emit(client, { key: EVENTS.PROPOSAL_EDITED, entity: { type: "partnership_proposal", id }, actor, payload: { number: r.number, card: qid, skipped: true } });
  });
  return reread(id, actor);
}

async function reshuffle(actor, id, qid, scope) {
  const r = await seen(pool, id, scope);
  if (r.status !== "questions") throw refuse("The cards are closed");
  const detail = await detailOf(pool, r, actor);
  const card = detail.questions.find((q) => q.proposal_question_id === qid && q.state !== "replaced");
  if (!card) throw new AppError("NOT_FOUND", "That card is not in this proposal", 404);
  if (card.reshuffles >= 3) throw refuse("Reshuffled three times");
  // Claude is asked outside any transaction; the card is swapped in one.
  const drafted = await require("./proposals.questions").reshuffle(actor, r, card, detail.questions);
  await tx(async (client) => {
    await repo.lockProposal(client, id);
    await cardOf(client, id, qid);
    await repo.updateQuestion(client, qid, { answer: card.answer, state: "replaced" });
    await repo.insertQuestion(client, id, { ...drafted, position: card.position, group_key: card.group_key, replaces_id: qid });
    await emit(client, { key: EVENTS.PROPOSAL_EDITED, entity: { type: "partnership_proposal", id }, actor, payload: { number: r.number, card: qid, reshuffled: true } });
  });
  return reread(id, actor);
}

/* ------------------------------------------------------------------ *
 * Write Draft
 * ------------------------------------------------------------------ */

async function requestDraft(actor, id, scope) {
  const r = await seen(pool, id, scope);
  if (r.status !== "questions") throw refuse("A draft is already written");
  const cards = await repo.questionsOf(pool, id);
  const open = cards.filter((q) => q.required && q.state === "open");
  if (open.length) throw refuse("Answer the required cards", { questions: ["Answer the required cards"] });
  const ai = await aiState(pool);
  await tx(async (client) => {
    await repo.lockProposal(client, id);
    if (ai === "on") {
      await repo.updateProposal(client, id, { status: "writing", progress: { job: "draft", step: "reading", failed: false, reason: null, at: now() } });
      await emit(client, { key: EVENTS.PROPOSAL_DRAFT_REQUESTED, entity: { type: "partnership_proposal", id }, actor, payload: { number: r.number } });
      return;
    }
    // AI Is Off or its limit is reached: the kit's pages are filled from the record, to finish by hand.
    const deal = await pipelineRepo.get(client, r.deal_id, null);
    const full = await require("../partner_pipeline/partner_pipeline.service").detailFor(client, r.deal_id, false);
    const assets = await repo.assetsOf(client, id);
    const built = content.starter({
      title: r.title || deal.title,
      partnerName: r.partner_name,
      reference: r.number,
      today: lagos.today(),
      deal: full,
      owner: { name: r.owner ? r.owner.display_name : "MyCity", title: r.owner_title, email: r.owner_email, phone: r.owner_phone },
      proofPoints: await repo.activeProofPoints(client),
      coverAssetId: (assets.find((a) => a.role === "cover") || {}).proposal_asset_id,
      logoAssetId: (assets.find((a) => a.role === "logo") || {}).proposal_asset_id,
    });
    await repo.updateProposal(client, id, { status: "draft", content: built, progress: null });
    await emit(client, { key: EVENTS.PROPOSAL_DRAFTED, entity: { type: "partnership_proposal", id }, actor, payload: { number: r.number, by_hand: true } });
  });
  return reread(id, actor);
}

/* ------------------------------------------------------------------ *
 * Edit
 * ------------------------------------------------------------------ */

const ROLE_OF_FIELD = { image_asset_id: "cover", partner_logo_asset_id: "logo", signer_photo_asset_id: "section" };

async function edit(actor, id, op, scope) {
  const r = await seen(pool, id, scope);
  if (r.status !== "draft" || !r.content) throw refuse("Revise a sent proposal to change it");
  await tx(async (client) => {
    await repo.lockProposal(client, id);
    const fresh = await repo.getProposal(client, id);
    let assetId = null;
    if (op.op === "image") {
      const entity = { type: "partnership_proposal", id };
      const doc = await vault.claim(client, { document_id: op.document_id, doc_type: "proposal_asset", entity, actor, field: "document_id" });
      if (!/^image\//.test(doc.mime || "")) throw new AppError("VALIDATION", "Upload an image", 422, { document_id: ["Upload an image"] });
      const section = fresh.content.sections.find((s) => s.key === op.key);
      const role = section && section.layout === "closing" ? "section" : ROLE_OF_FIELD[op.field];
      assetId = (await repo.insertAsset(client, id, { document_id: op.document_id, role, section_key: op.key, alt: op.alt })).proposal_asset_id;
    }
    const next = content.applyEdit(fresh.content, op, { assetId });
    const cover = next.sections.find((s) => s.layout === "cover");
    await repo.updateProposal(client, id, { content: next, ...(cover ? { title: cover.title } : {}) });
    await emit(client, {
      key: EVENTS.PROPOSAL_EDITED,
      entity: { type: "partnership_proposal", id },
      actor,
      before: { section: fresh.content.sections.find((s) => s.key === op.key) || null },
      after: { section: next.sections.find((s) => s.key === op.key) || null },
      payload: { number: r.number, op: op.op, key: op.key },
    });
  });
  return reread(id, actor);
}

/* ------------------------------------------------------------------ *
 * Download PDF
 * ------------------------------------------------------------------ */

/** The sent PDF itself, or a draft's drawn in the worker as an export (foundation.md §6.12). */
async function pdf(actor, id, scope) {
  const r = await seen(pool, id, scope);
  if (r.document_id && !["draft", "writing", "questions", "brief"].includes(r.status)) {
    const doc = await vault.get(pool, r.document_id);
    if (doc) return exportFiles.present(doc);
  }
  if (!r.content) throw refuse("This proposal has no draft yet");
  const deal = await pipelineRepo.get(pool, r.deal_id, null);
  const context = await studio.kitContext(pool, r, { deal });
  return tx(async (client) => {
    const doc = await documents.generate(client, {
      doc_type: "proposal_draft_pdf",
      entity: { type: "partnership_proposal", id },
      data: { content: r.content, context, title: r.title || "" },
      actor,
    });
    return exportFiles.present(doc);
  });
}

/* ------------------------------------------------------------------ *
 * After Send: the outcome, the link stopped, a new version
 * ------------------------------------------------------------------ */

/** Stop a proposal's link: its token revoked and its secret forgotten. */
async function stopLink(client, r) {
  await publicToken.revokeFor(client, { subject_type: "partnership_proposal", subject_id: r.partnership_proposal_id, scope: "proposal.view" });
  await repo.updateProposal(client, r.partnership_proposal_id, { link_secret: null });
}

async function decide(actor, id, scope, { status, event, extra = {}, stop = false }) {
  const r = await seen(pool, id, scope);
  if (!["sent", "viewed"].includes(r.status)) throw refuse("Only a sent proposal");
  await tx(async (client) => {
    await repo.lockProposal(client, id);
    await repo.updateProposal(client, id, { status, ...extra });
    if (stop) await stopLink(client, r);
    await emit(client, { key: event, entity: { type: "partnership_proposal", id }, actor, before: { status: r.status }, after: { status }, payload: { number: r.number, deal_id: r.deal_id } });
  });
  return reread(id, actor);
}

const accept = (actor, id, scope) => decide(actor, id, scope, { status: "accepted", event: EVENTS.PROPOSAL_ACCEPTED, extra: { accepted_at: now() } });
const decline = (actor, id, body, scope) =>
  decide(actor, id, scope, { status: "declined", event: EVENTS.PROPOSAL_DECLINED, extra: { declined_at: now(), decline_reason: body.reason }, stop: true });
const withdraw = (actor, id, scope) => decide(actor, id, scope, { status: "withdrawn", event: EVENTS.PROPOSAL_WITHDRAWN, extra: { withdrawn_at: now() }, stop: true });

/** Revise: the next version from a sent one, its content, brief, cards and pictures copied. */
async function revise(actor, id, scope) {
  const r = await seen(pool, id, scope);
  const detail = await detailOf(pool, r, actor);
  if (!detail.can.revise) throw refuse("Only the newest sent version");
  const next = await tx(async (client) => {
    await repo.lockProposal(client, id);
    const { partnership_proposal_id: nid } = await repo.insertProposal(client, {
      deal_id: r.deal_id,
      number: r.number,
      version: r.version + 1,
      status: "draft",
      value: r.value,
      currency: r.currency,
      title: r.title,
      design_template_id: r.design_template_id,
      supersedes_id: id,
      created_by: actor.user_id,
    });
    const copied = await repo.copyInputs(client, id, nid);
    const oldAssets = await repo.assetsOf(client, id);
    const map = new Map(oldAssets.map((a, i) => [a.proposal_asset_id, copied[i] && copied[i].proposal_asset_id]));
    const remap = (s) => {
      const out = { ...s };
      for (const f of ["image_asset_id", "partner_logo_asset_id", "signer_photo_asset_id"]) if (out[f]) out[f] = map.get(out[f]) || null;
      return out;
    };
    if (r.content) await repo.updateProposal(client, nid, { content: { sections: r.content.sections.map(remap) } });
    await emit(client, { key: EVENTS.PROPOSAL_REVISED, entity: { type: "partnership_proposal", id: nid }, actor, payload: { number: r.number, version: r.version + 1, supersedes_id: id } });
    return nid;
  });
  return reread(next, actor);
}

/** The daily job: proposals out past their validity expire and their links stop (§6.10). */
async function expireDue() {
  const ids = await repo.dueToExpire(pool, lagos.today());
  for (const id of ids) {
    await tx(async (client) => {
      const locked = await repo.lockProposal(client, id);
      if (!locked || !["sent", "viewed"].includes(locked.status)) return;
      const r = await repo.getProposal(client, id);
      await repo.updateProposal(client, id, { status: "expired" });
      await stopLink(client, r);
      await emit(client, { key: EVENTS.PROPOSAL_EXPIRED, entity: { type: "partnership_proposal", id }, actor: null, before: { status: r.status }, after: { status: "expired" }, payload: { number: r.number } });
    });
  }
  return ids.length;
}

/* ------------------------------------------------------------------ *
 * Saved templates
 * ------------------------------------------------------------------ */

/** Save as Template: the pages, their order and the tone they were written in; never the partner's facts. */
async function saveTemplate(actor, id, body, scope) {
  const r = await seen(pool, id, scope);
  if (!r.content) throw refuse("This proposal has no draft yet");
  const layouts = r.content.sections.filter((s) => !s.hidden).map((s) => s.layout);
  const brief = await pool.query("SELECT brief FROM partnership_proposal WHERE partnership_proposal_id = $1", [id]);
  const tone = brief.rows[0] && brief.rows[0].brief ? brief.rows[0].brief.tone_notes || null : null;
  return tx(async (client) => {
    const t = await repo.insertTemplate(client, {
      name: body.name,
      partner_category_id: r.partner_category_id,
      structure: { layouts, tone_notes: tone },
      created_from_proposal_id: id,
    });
    await emit(client, { key: EVENTS.PROPOSAL_TEMPLATE_SAVED, entity: { type: "partnership_proposal", id }, actor, after: t, payload: { number: r.number, name: body.name } });
    return t;
  });
}

const listTemplates = (query) => repo.listTemplates(pool, query);

module.exports = {
  list,
  summary,
  get,
  preview,
  start,
  retry,
  answer,
  skip,
  reshuffle,
  requestDraft,
  edit,
  pdf,
  accept,
  decline,
  withdraw,
  revise,
  expireDue,
  saveTemplate,
  listTemplates,
  detailOf,
  linkOf,
  aiState,
  reread,
  seen,
  tx,
  refuse,
  aadOf,
};
