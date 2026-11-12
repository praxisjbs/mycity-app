"use strict";
/**
 * The signatures service (docs/guides/offers.md §3, §6; docs/guides/partnerships.md §6.9): one way
 * to sign a document, for every module that has documents signed. M5's offer letters and
 * employment contracts first, M7's agreements next; never a second copy.
 *
 * A module declares what it has signed once, beside its events:
 *
 *   signatures.defineSignable("offer", {
 *     document_type: "offer_letter",
 *     letter: (db, offerId) => [...lines],              // the text the PDF holds, one renderer
 *     blocks: (db, offerId) => [...RichTextBlock] | null, // optional: the same text with headings,
 *                                                        // clauses and tables (an agreement)
 *     contentHash: (db, offerId) => "<sha256 hex>",      // canonical payload (shared/documents/canonical)
 *     seal: (client, ctx) => documentRow,                // documents.generate with the signatures,
 *                                                        // the certificate and the QR (ctx below)
 *     onSigned, onCompleted, onDeclined, onEnded,        // (client, ctx) in the same transaction
 *     sealedMailFor,                                     // (db, {request, signer}) the module's own
 *                                                        // wording for one signer's sealed copy, or null
 *     sealedTo,                                          // (db, id) others who get the sealed copy
 *   });
 *
 * and sends a document for signature inside its own transaction:
 *
 *   const { signature_request_id, links } = await signatures.requestIn(client, actor, {
 *     document_id, subject_type: "offer", subject_id, reference: "OFF-0018", title, expires_at,
 *     signers: [{ signer_type: "user", signer_id, name, email, title, role: "mycity" },
 *               { signer_type: "candidate", signer_id, name, email, role: "candidate" }],
 *   });
 *   // links[i].url is go.mycityapp.io/sign/<token>; the module mails it from its own outbox handler.
 *   // Opened before it is sent (an offer approved, then sent): `issue_links: false`, then
 *   // issueLinks(client, actor, signature_request_id) at Send and at Resend (earlier links revoked).
 *
 * Signers sign in their order. A staff signer signs in the hub (signAsStaff, already signed in);
 * anyone else signs on the public page: Send Code, the six-digit code from their email, full name
 * and title, a drawn or typed signature, I Agree to Sign Electronically. Each signed row keeps its
 * evidence and the content hash (A12); when the last one signs the copy is sealed from the outbox
 * (signatures.signed-pdf.js) and every row gains the artifact hash.
 *
 * A document signed on paper is recorded instead (recordPaperIn, Record Signed Copy): a request that is
 * completed and sealed at once over the uploaded scan, each signature `paper` with the content it attests
 * to and the scan's stored hash as its artifact hash. It has no QR, so it verifies by reference only,
 * and verification says it was signed outside the hub.
 *
 * A request that ends before everyone signed (declined by one signer, lapsed, withdrawn) voids the
 * signatures already on it: the pages show them `void`. Correcting a signer means ending the request
 * (endFor, revoked, which kills its links) and opening a new one (requestIn): an agreement's Send Again.
 */
const crypto = require("node:crypto");
const { pool } = require("../../config/db");
const { config } = require("../../config/env");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const publicToken = require("../../shared/tokens/public-token");
const vault = require("../../shared/documents/vault");
const profile = require("../../shared/organisation/profile");
const repo = require("./signatures.repo");
const code = require("./signatures.code");
const { EVENTS, EMAILS, SIGNATURE_IMAGE, SIGNATURE_ENTITY } = require("./signatures.events");

/** The one thing a signing link does (public_token scope). */
const SCOPE = "signature.sign";
/** A signing link lives as long as its request, and never more than a public link may. */
const MAX_LINK_HOURS = publicToken.MAX_TTL_HOURS;

const SIGNABLE = new Map();

const notFound = () => new AppError("NOT_FOUND", "This link is not valid or has expired", 404);
const refused = (code_, message, status = 409) => new AppError(code_, message, status);
const origin = () => String(config.PUBLIC_ORIGIN).replace(/\/+$/, "");

/**
 * Declare a record type that is signed through this service.
 * @param {string} subjectType  e.g. "offer", "employment_contract", "partnership_agreement"
 * @param {{document_type: string, letter: Function, blocks?: Function, contentHash: Function, seal: Function,
 *          onSigned?: Function, onCompleted?: Function, onDeclined?: Function, onEnded?: Function,
 *          recordStatus?: Function, sealedTo?: Function, sealedMailFor?: Function}} adapter
 *   blocks    (db, id) => RichTextBlock[] | null: the document as blocks, where it has headings,
 *             numbered clauses or tables; the pages draw these instead of the letter's lines
 *   sealedTo  (db, id) => [{ name, email }]: who besides the signers receives the sealed copy (the
 *             record's owner), mailed with the signers once it is sealed
 *   sealedMailFor (db, {request, signer}) => {template, data, recipient?} | null: the module's own
 *             wording for one signer's sealed copy; null leaves that signer to signature-completed
 */
function defineSignable(subjectType, adapter) {
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(subjectType)) throw new Error(`defineSignable: "${subjectType}" is snake_case`);
  for (const fn of ["letter", "contentHash", "seal"])
    if (typeof adapter[fn] !== "function") throw new Error(`defineSignable(${subjectType}): ${fn} is a function`);
  for (const fn of ["blocks", "onSigned", "onCompleted", "onDeclined", "onEnded", "recordStatus", "sealedTo", "sealedMailFor"])
    if (adapter[fn] !== undefined && typeof adapter[fn] !== "function")
      throw new Error(`defineSignable(${subjectType}): ${fn} is a function`);
  if (!["offer_letter", "employment_contract", "agreement"].includes(adapter.document_type))
    throw new Error(`defineSignable(${subjectType}): document_type is offer_letter, employment_contract or agreement`);
  if (SIGNABLE.has(subjectType) && SIGNABLE.get(subjectType) !== adapter)
    throw new Error(`defineSignable: ${subjectType} is already declared`);
  SIGNABLE.set(subjectType, Object.freeze({ ...adapter }));
}

function adapterOf(subjectType) {
  const a = SIGNABLE.get(subjectType);
  if (!a) throw new Error(`signatures: nothing declared "${subjectType}" signable (defineSignable)`);
  return a;
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------ *
 * Sending for signature
 * ------------------------------------------------------------------ */

/**
 * Open a signature request, one row a signer, and a link for each signer who signs outside the hub.
 * In the caller's transaction. The links are returned once and never stored (only their hashes).
 * @returns {Promise<{signature_request_id: string, links: Array<{signature_id: string, email: string, token: string, url: string, expires_at: Date}>}>}
 */
async function requestIn(client, actor, req) {
  const adapter = adapterOf(req.subject_type);
  if (!Array.isArray(req.signers) || req.signers.length < 1 || req.signers.length > 4)
    throw new Error("signatures.requestIn: one to four signers");
  const expires = req.expires_at ? new Date(req.expires_at) : null;
  const requestId = await repo.insertRequest(client, {
    document_id: req.document_id,
    subject_type: req.subject_type,
    subject_id: req.subject_id,
    expires_at: expires,
    created_by: actor.user_id,
    reference: req.reference,
    title: req.title,
    document_type: adapter.document_type,
  });
  const links = [];
  let position = 0;
  for (const s of req.signers) {
    position += 1;
    const signatureId = await repo.insertSignature(client, {
      signature_request_id: requestId,
      signer_type: s.signer_type,
      signer_id: s.signer_id || null,
      signer_name: s.name,
      signer_email: s.email,
      signer_title: s.title || null,
      signer_role: s.role,
      position,
    });
    if (s.signer_type === "user" || req.issue_links === false) continue; // a staff signer signs in the hub
    links.push(await mintLink(client, actor, signatureId, s.email, expires));
  }
  await emit(client, {
    key: EVENTS.SIGNATURE_REQUESTED,
    entity: { type: "signature_request", id: requestId },
    actor,
    payload: { signature_request_id: requestId, subject_type: req.subject_type, subject_id: req.subject_id, reference: req.reference },
  });
  return { signature_request_id: requestId, links };
}

/** A link for one signer, living as long as the request (and never more than a public link may). */
async function mintLink(client, actor, signatureId, email, expires) {
  const hours = expires
    ? Math.max(1, Math.min(MAX_LINK_HOURS, Math.ceil((new Date(expires).getTime() - Date.now()) / 3600000)))
    : MAX_LINK_HOURS;
  const t = await publicToken.issue(client, {
    scope: SCOPE,
    subject_type: SIGNATURE_ENTITY,
    subject_id: signatureId,
    ttl_hours: hours,
    created_by: actor ? actor.user_id : null,
  });
  return { signature_id: signatureId, email, token: t.token, url: `${origin()}/sign/${t.token}`, expires_at: t.expires_at };
}

/**
 * A fresh link for the signers outside the hub who have not signed, every earlier one revoked: for
 * Send Offer when the request was opened earlier (`issue_links: false`), and for Resend. Only a
 * link's hash is kept, so a link is always made at the moment it is mailed. In the caller's transaction.
 */
async function issueLinks(client, actor, signatureRequestId) {
  const r = await repo.request(client, signatureRequestId, { forUpdate: true });
  if (!r || r.status !== "pending") throw refused("NOT_OPEN", "This document can no longer be signed");
  const links = [];
  for (const s of await repo.signaturesOf(client, signatureRequestId)) {
    if (s.signer_type === "user" || s.status !== "pending") continue;
    await publicToken.revokeFor(client, { subject_type: SIGNATURE_ENTITY, subject_id: s.signature_id, scope: SCOPE });
    links.push(await mintLink(client, actor, s.signature_id, s.signer_email, r.expires_at));
  }
  return links;
}

/**
 * Set when a pending request ends, in the caller's transaction: an offer opened at approval has no
 * end until Send Offer sets its expiry. The links issued after it live until then.
 */
async function setExpiryIn(client, signatureRequestId, expiresAt) {
  if (!(await repo.setExpiry(client, signatureRequestId, new Date(expiresAt))))
    throw refused("NOT_OPEN", "This document can no longer be signed");
}

/**
 * A pending signer's address corrected, in the caller's transaction (an offer's Change Email):
 * the signer of `role` outside the hub. Make their link afterwards with issueLinks, which revokes
 * the old one. Refused when nobody of that role still has to sign.
 */
async function setSignerEmailIn(client, signatureRequestId, role, email) {
  const r = await repo.request(client, signatureRequestId, { forUpdate: true });
  if (!r || r.status !== "pending") throw refused("NOT_OPEN", "This document can no longer be signed");
  if (!(await repo.setSignerEmail(client, signatureRequestId, role, email)))
    throw refused("NOT_OPEN", "This document can no longer be signed");
}

/** The signers of a request as a record shows them (SignerView), in signing order. */
async function signersOf(db, signatureRequestId) {
  const r = await repo.request(db, signatureRequestId);
  return (await repo.signaturesOf(db, signatureRequestId)).map((x) => signerView(x, r));
}

/**
 * Where a request stands, for the record that sent it (an agreement's signers on Contracts & MOUs):
 * its status and why it ended, and each signer as SignerView with the address their link went to,
 * whether they opened it, and whether it is their turn. Null for no request.
 */
async function progressOf(db, signatureRequestId) {
  const r = await repo.request(db, signatureRequestId);
  if (!r) return null;
  const rows = await repo.signaturesOf(db, signatureRequestId);
  return {
    status: r.status,
    end_reason: r.end_reason || null,
    sealed: Boolean(r.sealed_at),
    signers: rows.map((x) => ({
      ...signerView(x, r),
      email: x.signer_email || null,
      viewed: Boolean(x.viewed_at),
      turn: x.status === "pending" && r.status === "pending" && rows.filter((y) => y.position < x.position).every((y) => y.status === "signed"),
    })),
  };
}

/**
 * End a record's open requests (an offer withdrawn, a case cancelled), in the caller's transaction:
 * every pending signer's link stops working. `status` is revoked or expired.
 */
async function endFor(client, actor, { subject_type: subjectType, subject_id: subjectId, status = "revoked", reason = null }) {
  const open = await repo.openRequestsFor(client, subjectType, subjectId);
  for (const r of open) await endOne(client, actor, r, status, reason);
  return open.length;
}

async function endOne(client, actor, r, status, reason) {
  if (!(await repo.endRequest(client, r.signature_request_id, status, reason))) return false;
  await repo.markSignatureEnded(client, r.signature_request_id, "expired");
  for (const s of await repo.signaturesOf(client, r.signature_request_id))
    await publicToken.revokeFor(client, { subject_type: SIGNATURE_ENTITY, subject_id: s.signature_id, scope: SCOPE });
  await emit(client, {
    key: EVENTS.SIGNATURE_ENDED,
    entity: { type: "signature_request", id: r.signature_request_id },
    actor,
    payload: { signature_request_id: r.signature_request_id, subject_type: r.subject_type, subject_id: r.subject_id, status },
  });
  const a = SIGNABLE.get(r.subject_type);
  if (a && a.onEnded) await a.onEnded(client, { request: r, status, reason, actor });
  return true;
}

/**
 * Record a document signed on paper (Record Signed Copy), in the caller's transaction: a request completed
 * and sealed at once over the scan, which the upload engine has already vaulted and hashed. Each signer
 * is a `paper` signature dated `signed_on`, carrying the content hash (A12) of the record as it stands;
 * the scan's stored hash is its artifact hash, so both verdicts hold until either changes. The record's
 * onCompleted runs as for a signature made in the hub. End any open request first (endFor).
 * @param {import("pg").PoolClient} client
 * @param {object} actor  who recorded it
 * @param {{document_id: string, subject_type: string, subject_id: string, reference: string, title: string,
 *          signed_on: string, signers: Array<{name: string, title?: string|null, role: string}>}} req
 * @returns {Promise<{signature_request_id: string}>}
 */
async function recordPaperIn(client, actor, req) {
  const adapter = adapterOf(req.subject_type);
  if (!Array.isArray(req.signers) || req.signers.length < 1 || req.signers.length > 4)
    throw new Error("signatures.recordPaperIn: one to four signers");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.signed_on))) throw new Error("signatures.recordPaperIn: signed_on is a date");
  const scan = await vault.get(client, req.document_id);
  if (!scan || !/^[0-9a-f]{64}$/.test(String(scan.content_hash || "")))
    throw new AppError("VALIDATION_FAILED", "Upload the signed copy", 422, { document_id: ["Upload the signed copy"] });
  const contentHash = await adapter.contentHash(client, req.subject_id);
  if (!/^[0-9a-f]{64}$/.test(String(contentHash))) throw new Error(`signatures: ${req.subject_type}.contentHash gave no sha256`);
  const requestId = await repo.insertRequest(client, {
    document_id: req.document_id,
    subject_type: req.subject_type,
    subject_id: req.subject_id,
    expires_at: null,
    created_by: actor.user_id,
    reference: req.reference,
    title: req.title,
    document_type: adapter.document_type,
  });
  // Noon in Lagos on the day it was signed: a date on paper has no hour.
  const signedAt = new Date(`${req.signed_on}T12:00:00+01:00`);
  let position = 0;
  for (const s of req.signers) {
    position += 1;
    await repo.insertPaperSignature(client, {
      signature_request_id: requestId,
      signer_name: s.name,
      signer_title: s.title || null,
      signer_role: s.role,
      position,
      signed_at: signedAt,
      content_hash: contentHash,
      evidence: { signed_on: req.signed_on, recorded_by: actor.user_id, recorded_at: new Date().toISOString(), consent: null },
    });
  }
  await repo.completeRequest(client, requestId);
  await repo.setSealing(client, requestId, { sealed_document_id: req.document_id, verify_key_hash: null });
  await repo.setSealed(client, requestId, scan.content_hash);
  const r = await repo.request(client, requestId);
  await emit(client, {
    key: EVENTS.SIGNATURE_COMPLETED,
    entity: { type: "signature_request", id: requestId },
    actor,
    payload: { signature_request_id: requestId, subject_type: req.subject_type, subject_id: req.subject_id, paper: true },
  });
  if (adapter.onCompleted) await adapter.onCompleted(client, { request: r, signature_id: null, actor, paper: true });
  return { signature_request_id: requestId };
}

/**
 * Stop every signing link a record was ever sent, in the caller's transaction: when it is sent again,
 * a link from an earlier request (one another signer declined, or that lapsed) opens nothing, as the
 * guide's "the old link stops working" asks (partnerships.md §11). End its open request first (endFor).
 */
async function stopLinksFor(client, { subject_type: subjectType, subject_id: subjectId }) {
  for (const id of await repo.signaturesForSubject(client, subjectType, subjectId))
    await publicToken.revokeFor(client, { subject_type: SIGNATURE_ENTITY, subject_id: id, scope: SCOPE });
}

/** Requests past their end, ended (signature-reminders, daily). */
async function expireLapsed() {
  let ended = 0;
  for (const id of await repo.lapsed(pool)) {
    ended += await tx(async (client) => {
      const r = await repo.request(client, id, { forUpdate: true });
      if (!r || r.status !== "pending") return 0;
      return (await endOne(client, null, r, "expired", "The signing period ended")) ? 1 : 0;
    });
  }
  return { ended };
}

/* ------------------------------------------------------------------ *
 * The signing page
 * ------------------------------------------------------------------ */

/** The signature row and request a link opens; the link's 404 for anything else. */
async function opened(db, token, { forUpdate = false } = {}) {
  if (!token || token.subject_type !== SIGNATURE_ENTITY) throw notFound();
  const s = await repo.signature(db, token.subject_id, { forUpdate });
  if (!s) throw notFound();
  const r = await repo.request(db, s.signature_request_id, { forUpdate });
  if (!r) throw notFound();
  return { s, r };
}

/** A request that ended before everyone signed: a signature on it binds nobody. */
const endedUnsigned = (r) => Boolean(r) && ["declined", "expired", "revoked"].includes(r.status);

function stateOf(r, s) {
  if (s.status === "signed") return endedUnsigned(r) ? "void" : "signed";
  if (s.status === "declined" || r.status === "declined") return "declined";
  if (r.status === "revoked") return "withdrawn";
  if (r.status === "expired" || s.status === "expired" || (r.expires_at && new Date(r.expires_at) <= new Date())) return "expired";
  return "awaiting";
}

const verifiedRecently = (s) =>
  Boolean(s.code_verified_at) && Date.now() - new Date(s.code_verified_at).getTime() < code.VERIFIED_MINUTES * 60000;

/**
 * One signer as the pages and records list them (SignerView). Given its request, a signature on a
 * request that ended unsigned (declined by another, lapsed, withdrawn) reads `void`, and says so.
 */
const signerView = (x, r = null) => ({
  name: x.signer_name,
  title: x.signer_title || null,
  role: x.signer_role,
  status: x.status === "signed" && endedUnsigned(r) ? "void" : x.status,
  signed_at: x.signed_at ? new Date(x.signed_at).toISOString() : null,
  method: x.method || null,
});

/** The document as blocks where its type has them (an agreement), else null. */
async function blocksOf(db, adapter, subjectId) {
  if (!adapter.blocks) return null;
  const blocks = await adapter.blocks(db, subjectId);
  return Array.isArray(blocks) && blocks.length > 0 ? blocks : null;
}

/** SigningView for one signer's link. */
async function viewOf(db, r, s) {
  const adapter = adapterOf(r.subject_type);
  // One after another: inside a write, `db` is one client.
  const org = await profile.readProfile(db);
  const letter = await adapter.letter(db, r.subject_id);
  const blocks = await blocksOf(db, adapter, r.subject_id);
  const all = await repo.signaturesOf(db, r.signature_request_id);
  const signedAt = s.signed_at ? new Date(s.signed_at).toISOString() : null;
  return {
    reference: r.reference,
    document_type: r.document_type,
    title: r.title,
    company: profile.displayName(org),
    signer_name: s.signer_name,
    issued_at: new Date(r.created_at).toISOString(),
    expires_at: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    state: stateOf(r, s),
    letter,
    blocks,
    code_verified: verifiedRecently(s),
    signers: all.map((x) => signerView(x, r)),
    signed_at: signedAt,
    verify_number: r.sealed_at ? r.reference : null,
  };
}

/** GET /sign/:token. The first opening is recorded once. */
async function view(token) {
  return tx(async (client) => {
    const { r, s } = await opened(client, token);
    if (await repo.markViewed(client, s.signature_id)) {
      await emit(client, {
        key: EVENTS.SIGNATURE_VIEWED,
        entity: { type: "signature_request", id: r.signature_request_id },
        actor: null,
        payload: { signature_request_id: r.signature_request_id, signature_id: s.signature_id },
      });
    }
    return viewOf(client, r, s);
  });
}

/** Refuse anything but a pending row on a pending request, whose turn it is. */
async function assertMayAct(db, r, s) {
  const state = stateOf(r, s);
  if (state === "signed") throw refused("ALREADY_SIGNED", "You have already signed");
  if (state !== "awaiting") throw refused("NOT_OPEN", "This document can no longer be signed");
  const earlier = (await repo.signaturesOf(db, r.signature_request_id)).filter((x) => x.position < s.position);
  if (earlier.some((x) => x.status !== "signed")) throw refused("NOT_YOUR_TURN", "Waiting for an earlier signature");
}

/** POST /sign/:token/code: a new code to the address the link was sent to. */
async function sendCode(token) {
  const sent = await tx(async (client) => {
    const { r, s } = await opened(client, token, { forUpdate: true });
    await assertMayAct(client, r, s);
    if (s.code_sent_at && Date.now() - new Date(s.code_sent_at).getTime() < code.RESEND_SECONDS * 1000) {
      const after = new Date(new Date(s.code_sent_at).getTime() + code.RESEND_SECONDS * 1000);
      throw new AppError("TOO_SOON", "Wait a minute, then ask again", 429, { resend_after: [after.toISOString()] });
    }
    const fresh = code.fresh();
    const at = await repo.setCode(client, s.signature_id, { code_hash: code.hashOf(s.signature_id, fresh), minutes: code.CODE_MINUTES });
    return { s, r, fresh, at };
  });
  // Queued after commit: the code travels in the mail job only, never in the outbox.
  await require("../../jobs/queues").enqueue(
    "email-send",
    EMAILS.code,
    {
      to: { name: sent.s.signer_name, email: sent.s.signer_email },
      template: EMAILS.code,
      data: { code: sent.fresh, title: sent.r.title, minutes: code.CODE_MINUTES },
    },
    { jobId: `signature-code-${sent.s.signature_id}-${new Date(sent.at.code_sent_at).getTime()}` },
  );
  return {
    sent_to: code.maskEmail(sent.s.signer_email),
    expires_at: new Date(sent.at.code_expires_at).toISOString(),
    resend_after: new Date(new Date(sent.at.code_sent_at).getTime() + code.RESEND_SECONDS * 1000).toISOString(),
  };
}

/** POST /sign/:token/code/verify. A wrong code counts; five, and a new one must be asked for. */
async function verifyCode(token, entered) {
  const outcome = await tx(async (client) => {
    const { r, s } = await opened(client, token, { forUpdate: true });
    await assertMayAct(client, r, s);
    if (!s.code_hash || !s.code_expires_at || new Date(s.code_expires_at) <= new Date())
      return { error: new AppError("CODE_EXPIRED", "Ask for a new code", 422, { code: ["Ask for another code"] }) };
    if (s.code_attempts >= code.CODE_TRIES)
      return { error: new AppError("CODE_LOCKED", "Too many tries. Ask for a new code", 422, { code: ["Ask for another code"] }) };
    if (!code.matches(s.signature_id, entered, s.code_hash)) {
      await repo.countWrongCode(client, s.signature_id);
      return { error: new AppError("CODE_WRONG", "That code is not right", 422, { code: ["Wrong code"] }) };
    }
    await repo.markCodeVerified(client, s.signature_id);
    return { view: await viewOf(client, r, await repo.signature(client, s.signature_id)) };
  });
  // A wrong try is counted even though the answer is a refusal: it commits before the throw.
  if (outcome.error) throw outcome.error;
  return outcome.view;
}

/** The evidence one signature keeps, beside its row's columns. */
function evidenceOf(meta, s, body) {
  return {
    ip: meta.ip || null,
    user_agent: meta.user_agent ? String(meta.user_agent).slice(0, 400) : null,
    code_verified_at: s.code_verified_at ? new Date(s.code_verified_at).toISOString() : null,
    consent: true,
    typed: body.method === "type" ? body.typed : null,
  };
}

/**
 * Store a drawn signature through the vault, for the row it signs. The contract has already held it
 * to a PNG data URL; the vault's image pipeline re-encodes it (the `signature` profile), so nothing
 * the pad did not draw survives, and it is not quarantined: the sealed copy needs it straight away.
 */
async function storeImage(client, png, signatureId, actor) {
  const buffer = Buffer.from(String(png).replace(/^data:image\/png;base64,/, ""), "base64");
  const doc = await vault.store(client, {
    file: { buffer, originalname: "signature.png" },
    purpose: "signature",
    doc_type: SIGNATURE_IMAGE,
    entity: { type: SIGNATURE_ENTITY, id: signatureId },
    sensitivity: "personal",
    actor,
  });
  return doc.document_id;
}

/**
 * Hold a request for the caller's transaction, before the record it signs: the signing page takes the
 * request first and the record in its hooks, so a module's own write (Withdraw, Resend) takes them in
 * the same order and the two never wait on each other.
 */
async function holdRequestIn(client, signatureRequestId) {
  return repo.request(client, signatureRequestId, { forUpdate: true });
}

/** Write one signature, then complete the request when it was the last. In the caller's transaction. */
async function signRow(client, r, s, body, meta, actor) {
  const adapter = adapterOf(r.subject_type);
  const imageId = body.method === "draw" ? await storeImage(client, body.signature_png, s.signature_id, actor) : null;
  const contentHash = await adapter.contentHash(client, r.subject_id);
  if (!/^[0-9a-f]{64}$/.test(String(contentHash))) throw new Error(`signatures: ${r.subject_type}.contentHash gave no sha256`);
  await repo.markSigned(client, s.signature_id, {
    signer_name: body.full_name,
    signer_title: body.title || s.signer_title,
    method: body.method,
    signature_document_id: imageId,
    content_hash: contentHash,
    evidence: evidenceOf(meta, s, body),
  });
  const ctx = { request: r, signature_id: s.signature_id, actor };
  await emit(client, {
    key: EVENTS.SIGNATURE_SIGNED,
    entity: { type: "signature_request", id: r.signature_request_id },
    actor,
    payload: { signature_request_id: r.signature_request_id, signature_id: s.signature_id, subject_type: r.subject_type, subject_id: r.subject_id },
  });
  if (adapter.onSigned) await adapter.onSigned(client, ctx);
  const all = await repo.signaturesOf(client, r.signature_request_id);
  if (all.every((x) => x.status === "signed") && (await repo.completeRequest(client, r.signature_request_id))) {
    await emit(client, {
      key: EVENTS.SIGNATURE_COMPLETED,
      entity: { type: "signature_request", id: r.signature_request_id },
      actor,
      payload: { signature_request_id: r.signature_request_id, subject_type: r.subject_type, subject_id: r.subject_id },
    });
    if (adapter.onCompleted) await adapter.onCompleted(client, ctx);
  }
}

/**
 * POST /sign/:token/sign. A second press answers with the signed state, never an error. The email
 * code must have been entered within the last half hour.
 */
async function sign(token, body, meta = {}) {
  return tx(async (client) => {
    const { r, s } = await opened(client, token, { forUpdate: true });
    if (s.status === "signed") return viewOf(client, r, s);
    await assertMayAct(client, r, s);
    if (!verifiedRecently(s)) throw new AppError("CODE_NEEDED", "Enter the code from your email", 422, { code: ["Enter the code"] });
    await signRow(client, r, s, body, meta, null);
    return viewOf(client, await repo.request(client, r.signature_request_id), await repo.signature(client, s.signature_id));
  });
}

/**
 * A staff signer signs in the hub, already signed in (no email code): the company's signatory on
 * an offer when it is approved. In the caller's transaction; the caller has checked the person may.
 */
async function signAsStaffIn(client, actor, signatureRequestId, body, meta = {}) {
  const r = await repo.request(client, signatureRequestId, { forUpdate: true });
  if (!r) throw notFound();
  const mine = (await repo.signaturesOf(client, r.signature_request_id)).find(
    (x) => x.signer_type === "user" && x.signer_id === actor.user_id && x.status === "pending",
  );
  if (!mine) throw refused("NOT_A_SIGNER", "You are not asked to sign this", 403);
  await assertMayAct(client, r, mine);
  await signRow(client, r, mine, body, meta, actor);
  return repo.request(client, r.signature_request_id);
}

/** POST /sign/:token/decline. The request ends for everyone; the owner hears why. */
async function decline(token, reason) {
  return tx(async (client) => {
    const { r, s } = await opened(client, token, { forUpdate: true });
    if (s.status === "declined") return viewOf(client, r, s);
    await assertMayAct(client, r, s);
    await repo.markDeclined(client, s.signature_id);
    await repo.endRequest(client, r.signature_request_id, "declined", reason);
    await repo.markSignatureEnded(client, r.signature_request_id, "expired");
    await emit(client, {
      key: EVENTS.SIGNATURE_DECLINED,
      entity: { type: "signature_request", id: r.signature_request_id },
      actor: null,
      payload: { signature_request_id: r.signature_request_id, signature_id: s.signature_id, subject_type: r.subject_type, subject_id: r.subject_id },
    });
    const adapter = adapterOf(r.subject_type);
    if (adapter.onDeclined) await adapter.onDeclined(client, { request: r, signature_id: s.signature_id, reason, actor: null });
    return viewOf(client, await repo.request(client, r.signature_request_id), await repo.signature(client, s.signature_id));
  });
}

/** GET /sign/:token/document: the sealed copy once there is one, else the document to sign. */
async function documentFor(token) {
  const { r } = await opened(pool, token);
  const doc = await vault.get(pool, r.sealed_at ? r.sealed_document_id : r.document_id);
  if (!doc) throw notFound();
  return doc;
}

/** A verification key for a sealed copy's QR: shown once, its hash kept. */
function verifyKey() {
  const key = crypto.randomBytes(32).toString("base64url");
  return { key, hash: crypto.createHash("sha256").update(key, "utf8").digest("hex") };
}

module.exports = {
  SCOPE,
  defineSignable,
  adapterOf,
  requestIn,
  issueLinks,
  setExpiryIn,
  setSignerEmailIn,
  recordPaperIn,
  stopLinksFor,
  progressOf,
  signersOf,
  endFor,
  expireLapsed,
  view,
  sendCode,
  verifyCode,
  sign,
  signAsStaffIn,
  holdRequestIn,
  decline,
  documentFor,
  verifyKey,
  signerView,
  blocksOf,
  /** Tests only. */
  __reset: () => SIGNABLE.clear(),
};
