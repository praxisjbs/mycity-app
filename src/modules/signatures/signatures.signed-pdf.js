"use strict";
/**
 * Sealing (docs/guides/partnerships.md §6.9 step 7; A12): when the last signer signs, the document
 * is generated once more with every signature stamped into it, the certificate after it, and a QR
 * on it that opens go.mycityapp.io/verify/t/<key>. The worker renders it, stores it and hashes the
 * stored bytes; that hash is every signature row's artifact_hash, and the signers are mailed the copy.
 *
 *   seal(requestId)        outbox, on signature.completed: generate the sealed copy (pending render)
 *   sealed(documentId)     outbox, on document.generated: record the artifact hash, emit signature.sealed
 *   mailSealed(requestId)  outbox, on signature.sealed: the copy to each signer
 *
 * Each step is safe to run twice: a request already sealed is left alone.
 */
const { pool } = require("../../config/db");
const { config } = require("../../config/env");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const storage = require("../../services/storage/storage.service");
const qr = require("../../services/qr/qr");
const vault = require("../../shared/documents/vault");
const repo = require("./signatures.repo");
const certificate = require("./signatures.certificate");
const { EVENTS, EMAILS } = require("./signatures.events");

const origin = () => String(config.PUBLIC_ORIGIN).replace(/\/+$/, "");
const service = () => require("./signatures.service");

/** signature_document_id → PNG data URL, for the drawn signatures the copy prints. */
async function imagesOf(db, signatures) {
  const out = new Map();
  for (const s of signatures) {
    if (!s.signature_document_id) continue;
    const doc = await vault.get(db, s.signature_document_id);
    if (!doc) continue;
    const bytes = await storage.get(doc.storage_key);
    out.set(s.signature_document_id, `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`);
  }
  return out;
}

async function seal(requestId) {
  const client = await pool.connect();
  try {
    return await atomically(client, async () => {
      const r = await repo.request(client, requestId, { forUpdate: true });
      if (!r || r.status !== "completed" || r.sealed_document_id) return null;
      const adapter = service().adapterOf(r.subject_type);
      const signatures = await repo.signaturesOf(client, requestId);
      const images = await imagesOf(client, signatures);
      const { key, hash } = service().verifyKey();
      const verifyUrl = `${origin()}/verify/t/${key}`;
      const doc = await adapter.seal(client, {
        request: r,
        signatures: signatures.map((s) => ({
          ...service().signerView(s),
          signature: s.signature_document_id ? images.get(s.signature_document_id) || null : null,
          typed: (s.evidence && s.evidence.typed) || null,
        })),
        certificate: certificate.rows(signatures, images),
        verify_url: verifyUrl,
        verify_reference: r.reference,
        qr: await qr.dataUrl(verifyUrl),
      });
      if (!doc || !doc.document_id) throw new Error(`signatures: ${r.subject_type}.seal returned no document`);
      await repo.setSealing(client, requestId, { sealed_document_id: doc.document_id, verify_key_hash: hash });
      return doc.document_id;
    });
  } finally {
    client.release();
  }
}

async function sealed(documentId) {
  const r = await repo.requestBySealedDocument(pool, documentId);
  if (!r || r.sealed_at) return null;
  const doc = await vault.get(pool, documentId);
  if (!doc || !doc.content_hash) return null;
  const client = await pool.connect();
  try {
    return await atomically(client, async () => {
      if (!(await repo.setSealed(client, r.signature_request_id, doc.content_hash))) return null;
      await emit(client, {
        key: EVENTS.SIGNATURE_SEALED,
        entity: { type: "signature_request", id: r.signature_request_id },
        actor: null,
        payload: { signature_request_id: r.signature_request_id, subject_type: r.subject_type, subject_id: r.subject_id, document_id: documentId },
      });
      return r.signature_request_id;
    });
  } finally {
    client.release();
  }
}

/**
 * The sealed copy to each signer. A module may word one signer's mail itself, where the document is
 * about that person and its own email says more than this one does (`sealedMailFor` on its
 * defineSignable: the candidate of an offer gets `offer-signed`). It answers null for the signers it
 * leaves to `signature-completed`. The sealed copy is attached either way, and the jobId stays the
 * signature's, so a handler that runs twice still mails once.
 */
async function mailSealed(requestId) {
  const r = await repo.request(pool, requestId);
  if (!r || !r.sealed_at) return 0;
  const queues = require("../../jobs/queues");
  const adapter = service().adapterOf(r.subject_type);
  let sent = 0;
  for (const s of await repo.signaturesOf(pool, requestId)) {
    if (s.status !== "signed") continue;
    const own = adapter.sealedMailFor ? await adapter.sealedMailFor(pool, { request: r, signer: s }) : null;
    await queues.enqueue(
      "email-send",
      own ? own.template : EMAILS.completed,
      {
        to: { name: s.signer_name, email: s.signer_email },
        ...(own && own.recipient ? { recipient: own.recipient } : {}),
        template: own ? own.template : EMAILS.completed,
        data: own
          ? own.data
          : { title: r.title, reference: r.reference, verify_url: `${origin()}/verify/${encodeURIComponent(r.reference)}` },
        attachments: [{ document_id: r.sealed_document_id }],
      },
      { jobId: `signature-completed-${s.signature_id}` },
    );
    sent += 1;
  }
  return sent;
}

module.exports = { seal, sealed, mailSealed };
