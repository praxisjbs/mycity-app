"use strict";
/**
 * Verification (A9, A12; docs/guides/offers.md §3 step 9): go.mycityapp.io/verify/<reference> and,
 * from the QR on a sealed copy, /verify/t/<key>. Two verdicts:
 *
 *   content   the record says today what was signed: its canonical payload's hash is recomputed
 *             from the live record and compared with every signature row's content_hash
 *   artifact  the stored file is the one sealed: the stored bytes are hashed again and compared
 *             with every signature row's artifact_hash
 *
 * Typed by reference it shows the status and the signers, never the content (a reference is not a
 * secret); from the QR's key it shows the document too. Only a sealed copy is verifiable; anything
 * else is the same 404 as an unknown reference.
 */
const crypto = require("node:crypto");
const { pool } = require("../../config/db");
const { config } = require("../../config/env");
const { AppError } = require("../../shared/errors");
const { sha256, sameHash } = require("../../shared/files/hash");
const storage = require("../../services/storage/storage.service");
const vault = require("../../shared/documents/vault");
const profile = require("../../shared/organisation/profile");
const repo = require("./signatures.repo");

const notFound = () => new AppError("NOT_FOUND", "No signed document has this reference", 404);
const service = () => require("./signatures.service");

const keyHash = (key) => crypto.createHash("sha256").update(String(key), "utf8").digest("hex");
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;

/** The record's verdicts and signers; the document's when `withDocument`. */
async function resultOf(r, { withDocument = false, key = null } = {}) {
  const adapter = service().adapterOf(r.subject_type);
  const signatures = (await repo.signaturesOf(pool, r.signature_request_id)).filter((s) => s.status === "signed");
  const current = await adapter.contentHash(pool, r.subject_id).catch(() => null);
  const content = signatures.length > 0 && signatures.every((s) => current && sameHash(s.content_hash, current)) ? "matches" : "differs";
  const doc = await vault.get(pool, r.sealed_document_id);
  let stored = null;
  try {
    stored = doc ? sha256(await storage.get(doc.storage_key)) : null;
  } catch {
    stored = null;
  }
  const artifact = signatures.length > 0 && stored && signatures.every((s) => s.artifact_hash && sameHash(s.artifact_hash, stored)) ? "matches" : "differs";
  const org = await profile.readProfile(pool);
  const out = {
    reference: r.reference,
    document_type: r.document_type,
    title: r.title,
    issued_by: profile.displayName(org),
    issued_at: new Date(r.created_at).toISOString(),
    status: r.status,
    record_status: adapter.recordStatus ? await adapter.recordStatus(pool, r.subject_id) : null,
    signers: signatures.map((s) => service().signerView(s, r)),
    signed_outside: signatures.some((s) => s.method === "paper"),
    content,
    artifact,
  };
  if (!withDocument) return out;
  return {
    ...out,
    document: {
      title: r.title,
      letter: await adapter.letter(pool, r.subject_id),
      blocks: await service().blocksOf(pool, adapter, r.subject_id),
      file_name: doc ? doc.original_name : `${r.reference}.pdf`,
      url: `${String(config.PUBLIC_ORIGIN).replace(/\/+$/, "")}/api/public/v1/verify/t/${key}/document`,
    },
  };
}

/** GET /verify/:ref. */
async function byReference(reference) {
  const r = await repo.requestByReference(pool, reference);
  if (!r || !r.sealed_at) throw notFound();
  return resultOf(r);
}

async function sealedByKey(key) {
  if (!KEY_RE.test(String(key))) throw notFound();
  const r = await repo.requestByVerifyKey(pool, keyHash(key));
  if (!r || !r.sealed_at) throw notFound();
  return r;
}

/** GET /verify/t/:token. */
async function byKey(key) {
  return resultOf(await sealedByKey(key), { withDocument: true, key });
}

/** GET /verify/t/:token/document: the sealed copy itself. */
async function sealedDocument(key) {
  const r = await sealedByKey(key);
  const doc = await vault.get(pool, r.sealed_document_id);
  if (!doc) throw notFound();
  return doc;
}

module.exports = { byReference, byKey, sealedDocument, keyHash };
