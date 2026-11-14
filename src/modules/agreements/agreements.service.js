"use strict";
/**
 * Agreements (docs/guides/partnerships.md §3 step 5, §5, §6.8, §6.9): the reads Contracts & MOUs and the
 * 360s use, and the controller's one door to the writes, each in its own file beside this one:
 *
 *   agreements.generate    Generate Agreement and Renew's draft: a category template filled from the record
 *   agreements.lifecycle   Draft edits, Submit, the approval's outcome, Renew, Close
 *   agreements.approval    the `partnership.agreement` flow's context, and how it reads on the agreement
 *   agreements.signing     Send for Signature, Send Again, Record Signed Copy, and the signing's hooks
 *   agreements.renewals    the daily job and the renewal reminder
 *
 * Who sees an agreement (§6.1): whoever sees its deal, the one rule partner_pipeline.repo keeps (its
 * owner's scope, its team, or the owner of its lead or partner). Its file opens for the same people
 * (vault.defineAccess, agreements.events.js). An agreement's wording is the agreement its partner signs,
 * so its readers see the terms it states; `partnerships.money` gates the deal's own commission fields
 * and its returns, not the document (the guide's §13.2, In PR 6).
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const vault = require("../../shared/documents/vault");
const signatures = require("../signatures/signatures.service");
const wording = require("../templates/templates.agreements");
const pipelineRepo = require("../partner_pipeline/partner_pipeline.repo");
const repo = require("./agreements.repo");
const approval = require("./agreements.approval");
const signing = require("./agreements.signing");
const lifecycle = () => require("./agreements.lifecycle");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That agreement does not exist, or you cannot see it.", 404);

/** An agreement the reader sees, or a 404, in the caller's transaction (locked when asked). */
async function visibleIn(client, id, scope, { lock = false } = {}) {
  const a = await repo.get(client, id, scope, { lock });
  if (!a) throw notFound();
  return a;
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

const trim = (v) => (v === null || v === undefined ? null : String(v).trim());

/** AgreementRow from a repo row. */
const rowOf = (r) => ({
  partnership_agreement_id: r.partnership_agreement_id,
  number: r.number,
  title: r.title,
  kind: r.kind || null,
  status: r.status,
  record: r.record,
  deal_id: r.deal_id || null,
  starts_on: r.starts_on || null,
  ends_on: r.ends_on || null,
  renewal_on: r.renewal_on || null,
  value: r.value === null || r.value === undefined ? null : String(r.value),
  currency: trim(r.currency),
  owner: r.owner || null,
  signed_at: r.signed_at || null,
});

/** A vault row as DocumentRef, or null. */
async function refOf(db, documentId) {
  if (!documentId) return null;
  const d = await vault.get(db, documentId);
  if (!d) return null;
  return { document_id: d.document_id, file_name: d.original_name || d.title, size_bytes: Number(d.bytes || 0), mime_type: d.mime || "application/pdf" };
}

/** Whether its category template asks MyCity to countersign. */
async function countersignedOf(db, a) {
  if (!a.template_key || !a.partner_category_id) return false;
  const t = (await pipelineRepo.templatesOf(db, a.partner_category_id)).find((x) => x.template_key === a.template_key);
  return Boolean(t && t.countersigned);
}

/** A signer as Contracts & MOUs lists them: where they stand, from their row and their request. */
function signerOf(s, request) {
  let state;
  if (s.status === "pending") state = request.status !== "pending" ? "expired" : !s.turn ? "waiting" : s.viewed ? "viewed" : "sent";
  else state = s.status;
  return {
    name: s.name,
    title: s.title,
    email: s.email,
    side: s.role === "mycity" ? "mycity" : "partner",
    state,
    signed_at: s.signed_at,
    method: s.method,
  };
}

/** AgreementDetail, for `actor` (who may decide its approval, §6.9). */
async function detailOf(db, a, actor = null) {
  const countersigned = await countersignedOf(db, a);
  const progress = a.signature_request_id ? await signatures.progressOf(db, a.signature_request_id) : null;
  const catalog = await signing.catalogOf(db, a);
  return {
    ...rowOf(a),
    proposal_id: a.proposal_id || null,
    template_key: a.template_key || null,
    template_version: a.template_version === null || a.template_version === undefined ? null : Number(a.template_version),
    fields: a.fields || {},
    body_html: a.status === "draft" ? wording.editorHtml(a.body || "", catalog) : null,
    blocks: await signing.blocksOf(db, a.partnership_agreement_id),
    missing_fields: await signing.missingOf(db, a),
    workflow_instance_id: a.workflow_instance_id || null,
    approval: await approval.viewOf(db, a, actor),
    returned_reason: a.status === "draft" ? a.returned_reason || null : null,
    countersigned,
    suggested_signers: await signing.suggestedSigners(db, a, countersigned),
    signing: progress ? { status: progress.status, end_reason: progress.end_reason } : null,
    signers: progress ? progress.signers.map((s) => signerOf(s, progress)) : [],
    document: await refOf(db, a.document_id),
    signed_document: await refOf(db, a.signed_document_id),
    signed_outside: a.signed_outside === true,
    renewal_notice_days: Number(a.renewal_notice_days),
    renews_agreement_id: a.renews_agreement_id || null,
    closed_at: a.closed_at || null,
    close_reason: a.close_reason || null,
    verify: await signing.verifyOf(a),
  };
}

/** GET /agreements: a page of the agreements the reader sees. */
async function list(query, scope) {
  const page = await repo.list(pool, query, scope);
  return { ...page, data: page.data.map(rowOf) };
}

/** GET /agreements/:id, and what every action answers, for the reader (`actor`). */
async function get(id, scope, actor = null) {
  const a = await repo.get(pool, id, scope);
  if (!a) throw notFound();
  return detailOf(pool, a, actor);
}

/** GET /agreements/summary: the cards above Contracts & MOUs. */
async function summary(scope) {
  const r = await repo.summary(pool, scope);
  return { active: r.active, in_approval: r.in_approval, awaiting_signature: r.awaiting_signature, renewals_180: r.renewals_180 };
}

/** GET /agreements/renewals: the signed agreements ending within `within_days`, soonest renewal first. */
async function renewals(query, scope) {
  const page = await repo.renewals(pool, query, scope);
  return {
    ...page,
    data: page.data.map((r) => ({
      partnership_agreement_id: r.partnership_agreement_id,
      number: r.number,
      title: r.title,
      record: r.record,
      ends_on: r.ends_on,
      renewal_on: r.renewal_on,
      days_left: Number(r.days_left),
      owner: r.owner || null,
    })),
  };
}

/** The PDF a person downloads: the sealed copy once there is one, else the copy sent for signature. */
async function documentOf(id, scope) {
  const a = await repo.get(pool, id, scope);
  if (!a) throw notFound();
  const doc = await vault.get(pool, a.signed_document_id || a.document_id);
  if (!doc) throw new AppError("NOT_READY", "This agreement has no PDF until it is sent for signature", 409);
  if (doc.render_status === "pending") throw new AppError("NOT_READY", "The PDF is still being prepared", 409);
  return doc;
}

/** The vault's read rule for an agreement's files: whoever sees the agreement (§6.1). */
async function mayOpenFile(client, user, doc) {
  const { scopeFor } = require("../../middleware/rbac");
  const scope = await scopeFor(user, "partnerships", "view");
  if (!scope) return false;
  return Boolean(await repo.get(client, doc.entity_id, scope));
}

/* ------------------------------------------------------------------ *
 * Praxis AI's Record Signed Copy (praxis-ai.md §6.18; partnerships.md §9)
 * ------------------------------------------------------------------ */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An agreement as a card and its question name it: its number and title, as its citation reads. */
const cardLabel = (a) => `${a.number} ${a.title}`;

/**
 * The agreements waiting for their signature that the reader sees, on these partners and leads (or
 * named by these words), newest first: a page of 25.
 * @param {{query: Function}} db
 * @param {{partner_ids?: string[], lead_ids?: string[], q?: string|null}} on
 */
async function awaitingSignature(db, on, scope) {
  const page = await repo.awaitingSignature(db, on, scope);
  return page.data.map(rowOf);
}

/** The agreement a card records, by number and title for a reader who sees it; its id alone otherwise, which the check refuses. */
async function cardAgreement(db, id, scope) {
  if (!UUID.test(String(id || ""))) return [];
  const a = db ? await repo.get(db, id, scope) : null;
  return [a ? { type: "agreement", id, label: cardLabel(a) } : { type: "agreement", id }];
}

/** The agreement waiting for its signature that the words name (its number or title, as a tapped answer reads), or the words as they were. */
async function agreementIdOf(db, words, scope) {
  if (UUID.test(String(words || ""))) return words;
  if (!words || !scope) return words;
  db = db || pool;
  const { oneNamed } = require("../../shared/ai/named");
  const found = oneNamed(await awaitingSignature(db, { q: String(words).slice(0, 100) }, scope), String(words), (a) => [cardLabel(a), a.number, a.title]);
  if (found) return found.partnership_agreement_id;
  // A tapped answer is the number and title together: read the waiting agreements as they stand.
  const all = oneNamed(await awaitingSignature(db, {}, scope), String(words), (a) => [cardLabel(a), a.number, a.title]);
  return all ? all.partnership_agreement_id : words;
}

/** What Record Signed Copy's press did, as its result line reads: the agreement, signed, opening Contracts & MOUs. */
function cardReadback(a) {
  const routeMap = require("../../shared/route-map");
  return [{ type: "agreement", id: a.partnership_agreement_id, label: cardLabel(a), status: "signed", link: (routeMap.linkFor("agreement", a.partnership_agreement_id) || {}).path || null }];
}

/** Conversion moves a lead's agreements to its partner (partners.convert.js, §6.4), in its transaction. */
async function moveToPartnerIn(client, leadId, partnerId) {
  await client.query("UPDATE partnership_agreement SET partner_id = $2, lead_id = NULL WHERE lead_id = $1", [leadId, partnerId]);
}

/* ------------------------------------------------------------------ *
 * The assistant's summary (docs/guides/praxis-ai.md §6.13, Partnerships)
 * ------------------------------------------------------------------ */

/** An agreement's status and kind as a person reads them, in the lifecycle's order (§6.8). */
const STATUS_WORDS = Object.freeze({
  draft: "Draft",
  review: "In Review",
  approval: "In Approval",
  sent: "Sent",
  viewed: "Viewed",
  signed: "Signed",
  active: "Active",
  expiring: "Expiring",
  renewed: "Renewed",
  closed: "Closed",
});
const KIND_WORDS = Object.freeze({ deal_merchant: "Deal Merchant", mou: "MOU", service_agreement: "Service Agreement", contract: "Contract" });

/**
 * The agreements the reader may see, in figures: every agreement unless a period (made) is asked, by
 * status, by kind and by owner (the grouping asked first), and those in force ending in each of the next
 * 12 months. Runs on the client the assistant hands over, inside its read timeout.
 * @param {{query: Function}} client
 * @param {object} params   AgreementSummaryQuery, parsed
 * @param {{scope: string, scope_ids: string[]|null}} scope
 */
async function aiSummary(client, params, scope, now = new Date()) {
  const { figure, group, series, askedPeriod } = require("../../shared/ai/summary");
  const period = askedPeriod(params, now);
  const r = await repo.aiSummary(client, { ...params, from: period && period.from, to: period && period.to }, scope);
  const f = r.figures;
  const inOrder = (rows, words) => Object.keys(words).map((k) => rows.find((x) => x.key === k)).filter(Boolean).map((x) => ({ key: x.key, label: words[x.key], value: x.value }));
  const groups = {
    status: group("status", "Agreements by status", inOrder(r.by_status, STATUS_WORDS)),
    kind: group("kind", "Agreements by kind", inOrder(r.by_kind, KIND_WORDS)),
    owner: group("owner", "Agreements by owner", r.by_owner),
  };
  const first = groups[params.by] ? params.by : "status";
  return {
    figures: [
      figure("agreements", "Agreements", f.agreements || 0),
      figure("draft", "Drafts", f.draft || 0),
      figure("in_approval", "In approval", f.in_approval || 0),
      figure("awaiting_signature", "Waiting for signature", f.awaiting_signature || 0),
      figure("signed", "Signed", f.signed || 0),
      figure("active", "Active", f.active || 0),
      figure("ending_soon", "Ending within 60 days", f.ending_soon || 0),
      figure("renewed", "Renewed", f.renewed || 0),
      figure("closed", "Closed", f.closed || 0),
    ],
    groups: [groups[first], ...Object.keys(groups).filter((k) => k !== first).map((k) => groups[k])],
    series: [series("renewals", "Renewals due by month, next 12 months", r.renewals)],
    total: f.agreements || 0,
  };
}

module.exports = {
  tx,
  visibleIn,
  rowOf,
  detailOf,
  countersignedOf,
  list,
  get,
  summary,
  aiSummary,
  renewals,
  documentOf,
  mayOpenFile,
  moveToPartnerIn,
  awaitingSignature,
  cardLabel,
  cardAgreement,
  agreementIdOf,
  cardReadback,
  generate: (actor, scope, body) => lifecycle().generateOne(actor, scope, body),
  update: (actor, scope, id, body) => lifecycle().update(actor, scope, id, body),
  submit: (actor, scope, id) => lifecycle().submit(actor, scope, id),
  send: (actor, scope, id, body) => signing.send(actor, scope, id, body),
  resend: (actor, scope, id) => signing.resend(actor, scope, id),
  signedCopy: (actor, scope, id, body) => signing.signedCopy(actor, scope, id, body),
  renew: (actor, scope, id, body) => lifecycle().renew(actor, scope, id, body),
  close: (actor, scope, id, body) => lifecycle().close(actor, scope, id, body),
};
