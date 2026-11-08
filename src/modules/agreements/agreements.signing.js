"use strict";
/**
 * Signing an agreement (docs/guides/partnerships.md §6.8, §6.9) through the shared signatures service:
 * the hooks it declared (defineSignable("partnership_agreement"), agreements.events.js) and the presses
 * that send it.
 *
 *   Send for Signature  approved only: the PDF rendered from the frozen wording, a signature request
 *                       with the partner's signatory first and MyCity's countersignatory second when
 *                       the template is countersigned, each mailed their link after commit. Sent.
 *   Send Again          from sent or viewed: the open request ended as withdrawn (its links stop), a new
 *                       one opened, with corrected signers when the person gave them. Sent.
 *   Record Signed Copy  a signature made on paper: the scan among the record's documents, a request
 *                       completed and sealed at once over it (signatures.recordPaperIn). Signed.
 *
 * What the signatures service tells it, in its transactions:
 *   viewed      the first signer opened the page: sent → viewed (outbox)
 *   signedOne   the partner signed; MyCity's signature waits: the owner is told
 *   completed   the last signature: signed, then the deal enters MyCity's first signed stage with
 *               source `signature`, which converts a lead into a partner (§6.4); a renewal's
 *               predecessor becomes renewed
 *   ended       declined by a signer or lapsed: back to sent, with Send Again
 *   seal        the sealed copy: the wording again, the partner's signature stamped into it, every
 *               other signature after it, the certificate and the QR (generate.js ownWording)
 *   sealed      the copy stored and hashed: signed_document_id, and among the partner's documents
 *
 * The content hash (A12) is over the canonical PARTNERSHIP_AGREEMENT payload: the frozen wording, the
 * term, the value and the template version, never the signers or the record's later edits.
 */
const { config } = require("../../config/env");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const canonical = require("../../shared/documents/canonical");
const documents = require("../../shared/documents/generate");
const md = require("../../shared/documents/markdown");
const { fillMarkdown } = require("../../shared/documents/render");
const vault = require("../../shared/documents/vault");
const profile = require("../../shared/organisation/profile");
const lagos = require("../../shared/time/lagos");
const signatures = require("../signatures/signatures.service");
const wording = require("../templates/templates.agreements");
const pipelineRepo = require("../partner_pipeline/partner_pipeline.repo");
const lists = require("../partner_pipeline/partner_pipeline.lists");
const repo = require("./agreements.repo");
const approval = require("./agreements.approval");
const { EVENTS, ENTITY, SUBJECT, DOC_TYPE, EMAILS } = require("./agreements.events");

/** How long a signing link lives once sent. */
const SIGN_DAYS = 30;

const refused = (code, message, status = 409, fields) => new AppError(code, message, status, fields);
const service = () => require("./agreements.service");
const origin = () => String(config.PUBLIC_ORIGIN).replace(/\/+$/, "");

/* ------------------------------------------------------------------ *
 * The agreement as it reads
 * ------------------------------------------------------------------ */

/** A `{{ name }}` the wording still holds: a field to fill, or one the signing fills. */
const TAG = /\{\{\s*(?:(?:date|longdate|datetime|month|money|number)\s+)?([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s*\}\}/g;

/** The labels of every field a template of this agreement's category may name. */
async function catalogOf(db, a) {
  const custom = await pipelineRepo.listFields(db, { partner_category_id: a.partner_category_id, active: true });
  const t = a.template_key
    ? (await pipelineRepo.templatesOf(db, a.partner_category_id)).find((x) => x.template_key === a.template_key)
    : null;
  return wording.catalogOf(custom, t ? t.asks : []);
}

/** The fields Submit waits for: every name still in the wording but the signer's own (§6.8). */
async function missingOf(db, a) {
  const names = [...new Set([...String(a.body || "").matchAll(TAG)].map((m) => m[1]).filter((p) => !p.startsWith("signer.")))];
  if (!names.length) return [];
  const catalog = await catalogOf(db, a);
  return names.map((p) => (catalog.get(p) ? catalog.get(p).label : p));
}

/** The partner's signature as the agreement's wording prints it, once they have signed. */
async function partnerSigner(db, a) {
  if (!a.signature_request_id) return null;
  const p = await signatures.progressOf(db, a.signature_request_id);
  if (!p) return null;
  return p.signers.find((s) => s.role === "partner" && s.status === "signed") || null;
}

/**
 * The wording as a person reads it on a screen or the signing page: the signer's name, title and date
 * once signed, the signature as words (its picture is the PDF's), and a field still empty as its label.
 */
async function readable(db, a) {
  const signer = await partnerSigner(db, a);
  const catalog = await catalogOf(db, a);
  const values = signer
    ? {
        signer: {
          name: signer.name,
          title: signer.title,
          signed_on: signer.signed_at ? lagos.today(new Date(signer.signed_at)) : null,
          signature: signer.method === "paper" ? "Signed on paper" : "Signed electronically",
        },
      }
    : { signer: {} };
  const filled = fillMarkdown(String(a.body || ""), values, { keepEmpty: true });
  return filled.replace(TAG, (_, path) => (path.startsWith("signer.") ? "" : `[${catalog.get(path) ? catalog.get(path).label : path}]`));
}

/** The signing page's text: one string a paragraph (SigningView.letter). */
async function letterOf(db, id) {
  const a = await repo.get(db, id);
  if (!a) return [];
  return md
    .markdownToText(await readable(db, a))
    .split(/\n{2,}/)
    .map((x) => x.replace(/\n/g, " ").trim())
    .filter(Boolean);
}

/** The same wording as blocks: headings, numbered clauses, the options table (SigningView.blocks). */
async function blocksOf(db, id) {
  const a = await repo.get(db, id);
  if (!a) return [];
  return md.markdownToBlocks(await readable(db, a));
}

/** What its signers attest to (A12): the canonical payload, recomputed from the agreement as it stands. */
const payloadOf = (a) => ({
  number: a.number,
  title: a.title,
  kind: a.kind,
  body_markdown: a.body,
  starts_on: a.starts_on,
  ends_on: a.ends_on,
  currency: a.currency,
  value: a.value,
  template_key: a.template_key,
  template_version: a.template_version,
});

async function contentHashOf(db, id) {
  const a = await repo.get(db, id);
  if (!a) throw new Error(`agreements: no agreement ${id}`);
  return canonical.hash("PARTNERSHIP_AGREEMENT", payloadOf(a));
}

/** Its state beyond signing for the verification page: active, expiring, expired past its end, renewed, closed. */
async function recordStatusOf(db, id) {
  const a = await repo.get(db, id);
  if (!a) return null;
  if (["signed", "active", "expiring"].includes(a.status) && a.ends_on && String(a.ends_on) < lagos.today()) return "expired";
  return a.status;
}

/** The sealed copy goes to the owner too (§6.9 step 7). */
async function sealedTo(db, id) {
  const a = await repo.get(db, id);
  const who = a && a.owner_id ? await repo.ownerContact(db, a.owner_id) : null;
  return who && who.email ? [who] : [];
}

/* ------------------------------------------------------------------ *
 * The PDF
 * ------------------------------------------------------------------ */

/** Render the agreement's frozen wording as its PDF, in the caller's transaction (pending, the worker renders it). */
function renderIn(client, a, data) {
  wording.declare(a.template_key);
  return documents.generate(client, {
    doc_type: DOC_TYPE,
    entity: { type: ENTITY, id: a.partnership_agreement_id },
    data: { agreement: { number: a.number, title: a.title }, ...data },
    actor: null,
    template: a.template_key,
    template_version: a.template_version,
    wording: a.body,
  });
}

/** The sealed copy: the wording with the partner's signature stamped in, every other one after it, the certificate and the QR. */
async function sealIn(client, ctx) {
  const a = await repo.get(client, ctx.request.subject_id);
  const company = profile.displayName(await profile.readProfile(client));
  const partner = ctx.signatures.find((s) => s.role === "partner" && s.status === "signed") || null;
  const stampedInBody = Boolean(partner) && /\{\{\s*signer\.signature\s*\}\}/.test(String(a.body || ""));
  const recordName = a.record ? a.record.name : company;
  return renderIn(client, a, {
    signer: partner
      ? {
          name: partner.name,
          title: partner.title,
          signed_on: partner.signed_at ? lagos.today(new Date(partner.signed_at)) : null,
          signature: { signature: partner.signature || null, typed: partner.typed || null, name: partner.name },
        }
      : {},
    sealing: {
      signers: ctx.signatures
        .filter((s) => !(stampedInBody && s === partner))
        .map((s) => ({
          name: s.name,
          title: s.title || null,
          label: s.role === "mycity" ? `For ${company}` : `For ${recordName}`,
          signed_at: s.signed_at || null,
          signature: s.signature || null,
          typed: s.typed || null,
        })),
      certificate: ctx.certificate,
      qr: ctx.qr,
      verify_url: ctx.verify_url,
      reference: ctx.verify_reference,
    },
  });
}

/* ------------------------------------------------------------------ *
 * What the signatures service tells it
 * ------------------------------------------------------------------ */

/** The facts every agreement event carries: who to tell, and what it is. */
async function payloadFor(db, a, extra = {}) {
  const user = await repo.userOf(db, a.owner_id);
  return {
    partnership_agreement_id: a.partnership_agreement_id,
    number: a.number,
    deal_id: a.deal_id,
    record_name: a.record ? a.record.name : "",
    owner_id: a.owner_id,
    owner_user_id: user ? user.user_id : null,
    ...extra,
  };
}

/** The first opening of a signing link (outbox): sent → viewed. */
async function viewed(requestId) {
  return service().tx(async (client) => {
    const ref = await repo.bySignatureRequest(client, requestId);
    if (!ref) return null;
    const a = await repo.get(client, ref.partnership_agreement_id);
    if (!(await repo.set(client, a.partnership_agreement_id, ["sent"], { status: "viewed" }))) return null;
    await emit(client, {
      key: EVENTS.AGREEMENT_VIEWED,
      entity: { type: ENTITY, id: a.partnership_agreement_id },
      actor: null,
      before: { status: "sent" },
      after: { status: "viewed" },
      payload: await payloadFor(client, a),
    });
    return "viewed";
  });
}

/** One signer signed: when it was the partner and MyCity's countersignature waits, the owner is told. */
async function signedOneIn(client, ctx) {
  const p = await signatures.progressOf(client, ctx.request.signature_request_id);
  if (!p || p.status !== "pending") return;
  const partnerDone = p.signers.some((s) => s.role === "partner" && s.status === "signed");
  const mycityWaits = p.signers.some((s) => s.role === "mycity" && s.status === "pending");
  if (!partnerDone || !mycityWaits) return;
  const a = await repo.get(client, ctx.request.subject_id);
  await emit(client, {
    key: EVENTS.AGREEMENT_PARTNER_SIGNED,
    entity: { type: ENTITY, id: a.partnership_agreement_id },
    actor: ctx.actor || null,
    payload: await payloadFor(client, a),
  });
}

/**
 * The last signature (or a signed copy recorded), in the signing's transaction: signed, then its deal
 * enters MyCity's first signed stage (source `signature`), which converts a lead into a partner and
 * raises its deliverables after commit; the agreement it renews becomes renewed.
 */
async function completedIn(client, ctx) {
  const a = await repo.get(client, ctx.request.subject_id, null, { lock: true });
  if (!a || !["approval", "sent", "viewed"].includes(a.status)) return;
  const p = await signatures.progressOf(client, ctx.request.signature_request_id);
  const signedAt = p.signers.map((s) => s.signed_at).filter(Boolean).sort().pop() || new Date().toISOString();
  await repo.set(client, a.partnership_agreement_id, [a.status], {
    status: "signed",
    signed_at: new Date(signedAt),
    signed_outside: ctx.paper === true,
    signature_request_id: ctx.request.signature_request_id,
  });
  await emit(client, {
    key: EVENTS.AGREEMENT_SIGNED,
    entity: { type: ENTITY, id: a.partnership_agreement_id },
    actor: ctx.actor || null,
    before: { status: a.status },
    after: { status: "signed" },
    payload: await payloadFor(client, a, { paper: ctx.paper === true }),
  });

  const deal = await pipelineRepo.lock(client, a.deal_id);
  if (deal && !deal.signed_at) {
    const stage = lists.firstOf(await lists.stagesOf(client), "signed");
    if (stage) {
      await require("../partner_pipeline/partner_pipeline.stages").moveIn(
        client,
        ctx.actor || null,
        deal,
        { stage: stage.code, reason: `Signed agreement ${a.number}` },
        { source: "signature" },
      );
    }
  }

  if (a.renews_agreement_id) {
    const before = await repo.get(client, a.renews_agreement_id, null, { lock: true });
    if (before && (await repo.set(client, before.partnership_agreement_id, ["signed", "active", "expiring"], { status: "renewed" }))) {
      await emit(client, {
        key: EVENTS.AGREEMENT_RENEWED,
        entity: { type: ENTITY, id: before.partnership_agreement_id },
        actor: ctx.actor || null,
        before: { status: before.status },
        after: { status: "renewed" },
        payload: await payloadFor(client, before, { renewed_by: a.partnership_agreement_id, renewed_by_number: a.number }),
      });
    }
  }
}

/**
 * Its signing ended unsigned: a signer declined, or it lapsed. Back to sent, with Send Again; the
 * other signatures on it are void (the signatures service shows them so). A withdrawal is the
 * module's own (Send Again, Record Signed Copy, Close), so it changes nothing here.
 */
async function endedIn(client, ctx) {
  if (!["declined", "expired"].includes(ctx.status)) return;
  const a = await repo.get(client, ctx.request.subject_id, null, { lock: true });
  if (!a || a.signature_request_id !== ctx.request.signature_request_id) return;
  if (!(await repo.set(client, a.partnership_agreement_id, ["sent", "viewed"], { status: "sent" }))) return;
  await emit(client, {
    key: EVENTS.AGREEMENT_SIGNATURE_ENDED,
    entity: { type: ENTITY, id: a.partnership_agreement_id },
    actor: null,
    before: { status: a.status },
    after: { status: "sent" },
    payload: await payloadFor(client, a, { status: ctx.status, reason: ctx.reason || null }),
  });
}

/** The sealed copy is stored and hashed (outbox): the signed document, and among the partner's documents. */
async function sealed(id, documentId) {
  return service().tx(async (client) => {
    const a = await repo.get(client, id, null, { lock: true });
    if (!a || a.signed_document_id === documentId) return null;
    await repo.set(client, id, null, { signed_document_id: documentId });
    await fileCopyIn(client, null, a, documentId);
    await emit(client, {
      key: EVENTS.AGREEMENT_SEALED,
      entity: { type: ENTITY, id },
      actor: null,
      payload: await payloadFor(client, a, { document_id: documentId }),
    });
    return documentId;
  });
}

/** File the signed copy among the record's documents, on its deal (once). */
async function fileCopyIn(client, actor, a, documentId) {
  const fresh = await repo.get(client, a.partnership_agreement_id);
  const record = fresh.partner_id ? { kind: "partner", id: fresh.partner_id } : { kind: "lead", id: fresh.lead_id };
  await require("../partners/partners.documents").fileIn(client, actor, { record, deal_id: fresh.deal_id, document_id: documentId, origin: "agreement" });
}

/* ------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------ */

/** The signers in signing order: the partner's first, MyCity's after (§6.9 step 1). */
function orderOf(signers, countersigned) {
  const partner = signers.filter((s) => s.side === "partner");
  const mycity = signers.filter((s) => s.side === "mycity");
  if (!partner.length) throw refused("VALIDATION_FAILED", "Add the partner's signer", 422, { signers: ["Add the partner's signer"] });
  if (countersigned && !mycity.length) throw refused("VALIDATION_FAILED", "Add MyCity's signer", 422, { signers: ["Add MyCity's signer"] });
  const seen = new Set();
  for (const s of [...partner, ...mycity]) {
    const e = String(s.email).toLowerCase();
    if (seen.has(e)) throw refused("VALIDATION_FAILED", "Each signer needs their own email", 422, { signers: ["Two signers share an email"] });
    seen.add(e);
  }
  return [...partner, ...mycity];
}

/**
 * Send for Signature and Send Again, in the caller's transaction: end the open request, render the PDF
 * when it has none, open the request, Sent. The links are returned to mail after commit.
 */
async function sendIn(client, actor, a, signers) {
  const again = ["sent", "viewed"].includes(a.status);
  if (!again) {
    if (a.status !== "approval" || !(await approval.isApproved(client, a)))
      throw refused("NOT_APPROVED", "Only an approved agreement can be sent for signature");
  }
  const missing = await missingOf(client, a);
  if (missing.length) throw refused("FIELDS_MISSING", `Fill ${missing.join(", ")} first`, 422, { body_html: missing.map((m) => `${m} is empty`) });
  await signatures.endFor(client, actor, { subject_type: SUBJECT, subject_id: a.partnership_agreement_id, status: "revoked", reason: "Sent again" });
  await signatures.stopLinksFor(client, { subject_type: SUBJECT, subject_id: a.partnership_agreement_id });
  const documentId = a.document_id || (await renderIn(client, a, {})).document_id;
  const ordered = orderOf(signers, await service().countersignedOf(client, a));
  const { signature_request_id: requestId, links } = await signatures.requestIn(client, actor, {
    document_id: documentId,
    subject_type: SUBJECT,
    subject_id: a.partnership_agreement_id,
    reference: a.number,
    title: a.title,
    expires_at: new Date(Date.now() + SIGN_DAYS * 24 * 3600 * 1000),
    signers: ordered.map((s) => ({
      signer_type: s.side === "partner" ? "partner_contact" : "staff",
      signer_id: s.contact_id || null,
      name: s.name,
      email: s.email,
      title: s.title || null,
      role: s.side === "partner" ? "partner" : "mycity",
    })),
  });
  await repo.set(client, a.partnership_agreement_id, [a.status], {
    status: "sent",
    signature_request_id: requestId,
    document_id: documentId,
  });
  await emit(client, {
    key: EVENTS.AGREEMENT_SENT,
    entity: { type: ENTITY, id: a.partnership_agreement_id },
    actor,
    before: { status: a.status },
    after: { status: "sent" },
    payload: await payloadFor(client, a, { again, signers: ordered.length }),
  });
  const partners = ordered.filter((s) => s.side === "partner").map((s) => s.name);
  return links.map((l, i) => ({ ...l, signer: ordered[i], after: ordered[i].side === "mycity" ? partners.join(" and ") : null }));
}

/** Mail each signer their link, after commit (a link is never kept, nor put in the outbox). */
async function mailLinks(a, links, message) {
  const queues = require("../../jobs/queues");
  const company = profile.displayName(await profile.readProfile(require("../../config/db").pool));
  for (const l of links) {
    const first = String(l.signer.name).trim().split(/\s+/)[0] || null;
    await queues.enqueue(
      "email-send",
      EMAILS.sign,
      {
        to: { name: l.signer.name, email: l.email },
        recipient: { first_name: first, email: l.email },
        template: EMAILS.sign,
        data: {
          title: a.title,
          reference: a.number,
          record_name: a.record ? a.record.name : "",
          company,
          sign_url: l.url,
          expires_at: l.expires_at ? new Date(l.expires_at).toISOString() : null,
          message: message || null,
          after: l.after,
        },
      },
      { jobId: `agreement-sign-${l.signature_id}-${Date.now()}` },
    );
  }
}

/** POST /agreements/:id/send: approved only, or from sent or viewed with corrected signers. */
async function send(actor, scope, id, body) {
  const { a, links } = await service().tx(async (client) => {
    const row = await service().visibleIn(client, id, scope, { lock: true });
    return { a: row, links: await sendIn(client, actor, row, body.signers) };
  });
  await mailLinks(a, links, body.message);
  return service().get(id, scope, actor);
}

/** POST /agreements/:id/resend: Send Again to the same signers, every earlier link stopped. */
async function resend(actor, scope, id) {
  const { a, links } = await service().tx(async (client) => {
    const row = await service().visibleIn(client, id, scope, { lock: true });
    if (!["sent", "viewed"].includes(row.status)) throw refused("NOT_SENT", "Only an agreement sent for signature can be sent again");
    const p = row.signature_request_id ? await signatures.progressOf(client, row.signature_request_id) : null;
    const signers = (p ? p.signers : [])
      .filter((s) => s.email)
      .map((s) => ({ contact_id: null, name: s.name, title: s.title, email: s.email, side: s.role === "mycity" ? "mycity" : "partner" }));
    return { a: row, links: await sendIn(client, actor, row, signers) };
  });
  await mailLinks(a, links, null);
  return service().get(id, scope, actor);
}

/**
 * POST /agreements/:id/signed-copy: a signature made on paper. The scan joins the record's documents
 * (origin signed_copy); an open request is withdrawn; the signature is recorded, completed and sealed
 * over the scan, so verification by reference reads "signed outside the hub".
 */
async function signedCopy(actor, scope, id, body) {
  if (body.signed_on > lagos.today()) throw refused("VALIDATION_FAILED", "Check the date", 422, { signed_on: ["Not in the future"] });
  await service().tx(async (client) => {
    const a = await service().visibleIn(client, id, scope, { lock: true });
    const approvedNow = a.status === "approval" && (await approval.isApproved(client, a));
    if (!approvedNow && !["sent", "viewed"].includes(a.status))
      throw refused("NOT_APPROVED", "Only an approved agreement can be recorded as signed");
    const missing = await missingOf(client, a);
    if (missing.length) throw refused("FIELDS_MISSING", `Fill ${missing.join(", ")} first`, 422, { body_html: missing.map((m) => `${m} is empty`) });
    const record = a.partner_id ? { kind: "partner", id: a.partner_id } : { kind: "lead", id: a.lead_id };
    await require("../partners/partners.documents").attachIn(client, actor, {
      record,
      deal_id: a.deal_id,
      document_id: body.document_id,
      origin: "signed_copy",
      field: "document_id",
    });
    await signatures.endFor(client, actor, { subject_type: SUBJECT, subject_id: id, status: "revoked", reason: "Signed on paper" });
    await signatures.recordPaperIn(client, actor, {
      document_id: body.document_id,
      subject_type: SUBJECT,
      subject_id: id,
      reference: a.number,
      title: a.title,
      signed_on: body.signed_on,
      signers: [{ name: body.signed_by_name, title: body.signed_by_title || null, role: "partner" }],
    });
    await repo.set(client, id, null, { signed_document_id: body.document_id });
    await emit(client, {
      key: EVENTS.AGREEMENT_SEALED,
      entity: { type: ENTITY, id },
      actor,
      payload: await payloadFor(client, a, { document_id: body.document_id, paper: true }),
    });
  });
  return service().get(id, scope, actor);
}

/** The suggested Send for Signature signers: the record's signatory contact, then MyCity's when countersigned. */
async function suggestedSigners(db, a, countersigned) {
  const out = [];
  const contact = await repo.signatoryOf(db, a);
  if (contact && contact.email)
    out.push({ contact_id: contact.partner_contact_id, name: contact.full_name, ...(contact.job_title ? { title: contact.job_title } : {}), email: contact.email, side: "partner" });
  if (countersigned) {
    const { rows } = await db.query(
      `SELECT btrim(e.first_name || ' ' || e.last_name) AS name, e.job_title, e.work_email::text AS email
         FROM app_user u JOIN employee e ON e.employee_id = u.employee_id
        WHERE u.is_ceo AND u.status = 'active' ORDER BY u.created_at LIMIT 1`,
    );
    if (rows[0]) out.push({ name: rows[0].name, ...(rows[0].job_title ? { title: rows[0].job_title } : {}), email: rows[0].email, side: "mycity" });
  }
  return out;
}

/** The verification an agreement shows once signed: its reference, the page it opens and that page as a QR. */
async function verifyOf(a) {
  if (!a.signed_document_id) return null;
  const url = `${origin()}/verify/${encodeURIComponent(a.number)}`;
  return { reference: a.number, url, qr: await require("../../services/qr/qr").dataUrl(url) };
}

module.exports = {
  SIGN_DAYS,
  missingOf,
  readable,
  letterOf,
  blocksOf,
  contentHashOf,
  recordStatusOf,
  sealedTo,
  sealIn,
  viewed,
  signedOneIn,
  completedIn,
  endedIn,
  sealed,
  send,
  resend,
  signedCopy,
  suggestedSigners,
  verifyOf,
  catalogOf,
  payloadFor,
};
