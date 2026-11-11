"use strict";
/**
 * The certificate of completion (docs/guides/knowledge.md §6.9, §6.10): drawn, issued, offered for
 * download and verified.
 *
 *   draw       the `training_certificate` document's page: templates/documents/training-certificate.html
 *              from the sample MyCity approved (Cynthia, 11/11/2026), one A4 landscape page with no
 *              letterhead; its faces embedded, its rosette, seal petals and QR drawn here, so the
 *              renderer (JavaScript off, every request but data: refused) needs nothing else
 *   issue      `training.issue_certificate`, after a completion commits: the document generated
 *              through documents.generate for the person, its PDF rendered by the worker, stored
 *              once and never again; a renamed person or course keeps the certificate as issued
 *   ready      when its PDF is stored: "Certificate ready" to the person (`training.certificate_ready`)
 *   download   Download Certificate, for the person and for `training.manage`: the stored PDF,
 *              answered as ExportFile (202), pending while the worker still renders it
 *   verify     Verify a Document on go.mycityapp.io for a CERT- number: the facts as issued, the
 *              publisher, and the two verdicts (A12): the content hash recomputed from the facts
 *              kept on the enrolment, the artifact hash from the stored bytes
 *
 * The certificate and the proof are the person's and `training.manage`'s only: the vault's read
 * rule for a training enrolment's files is set in training.events.js.
 */
const fs = require("node:fs");
const path = require("node:path");
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { config } = require("../../config/env");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { render } = require("../../shared/documents/render");
const templates = require("../../shared/templates/template-store");
const documents = require("../../shared/documents/generate");
const exportFiles = require("../../shared/documents/exports");
const vault = require("../../shared/documents/vault");
const { sha256, sameHash } = require("../../shared/files/hash");
const profile = require("../../shared/organisation/profile");
const lagos = require("../../shared/time/lagos");
const storage = require("../../services/storage/storage.service");
const qr = require("../../services/qr/qr");
const repo = require("./training.repo");
const { EVENTS, ENROLMENT_ENTITY, CERTIFICATE_DOC_TYPE } = require("./training.events");

const service = () => require("./training.service");
const TEMPLATE = "training-certificate";
const FONTS_DIR = path.join(templates.ROOT, "documents", "fonts");
/** Geist, the house sans, as the proposal kit embeds it: one copy of the file in the repository. */
const SANS_DIR = path.join(templates.ROOT, "proposals", "fonts");

const notFound = () => new AppError("NOT_FOUND", "No signed document has this reference", 404);

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------ *
 * Drawing (pure)
 * ------------------------------------------------------------------ */

let fontCache = null;

/** The faces as data: URLs, read once per process. */
function fonts() {
  if (fontCache) return fontCache;
  const woff2 = (dir, file) => `data:font/woff2;base64,${fs.readFileSync(path.join(dir, file)).toString("base64")}`;
  fontCache = Object.freeze({
    serif_500: woff2(FONTS_DIR, "cormorant-garamond-latin-500-normal.woff2"),
    serif_500_ext: woff2(FONTS_DIR, "cormorant-garamond-latin-ext-500-normal.woff2"),
    serif_600: woff2(FONTS_DIR, "cormorant-garamond-latin-600-normal.woff2"),
    serif_600_ext: woff2(FONTS_DIR, "cormorant-garamond-latin-ext-600-normal.woff2"),
    serif_500_italic: woff2(FONTS_DIR, "cormorant-garamond-latin-500-italic.woff2"),
    sans: woff2(SANS_DIR, "geist-latin.woff2"),
    sans_ext: woff2(SANS_DIR, "geist-latin-ext.woff2"),
  });
  return fontCache;
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** One hypotrochoid ring of the watermark's rosette, as path commands. */
function ring(R, r, d, scale, steps) {
  const turns = (r / gcd(R, r)) * Math.PI * 2;
  let out = "";
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * turns;
    const x = (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t);
    const y = (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);
    out += `${i ? "L" : "M"}${(x * scale).toFixed(1)} ${(y * scale).toFixed(1)}`;
  }
  return out;
}

/** 24 round lobes around a circle, as one path: the seal's scalloped edge. */
function petals(radius, lobe, count = 24) {
  let out = "";
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2;
    const cx = Math.cos(a) * radius;
    const cy = Math.sin(a) * radius;
    out += `M${(cx - lobe).toFixed(2)} ${cy.toFixed(2)}a${lobe} ${lobe} 0 1 0 ${lobe * 2} 0a${lobe} ${lobe} 0 1 0 ${-lobe * 2} 0`;
  }
  return out;
}

let drawingCache = null;

/** The sample's ornaments, drawn once: the guilloche rosette and the seal's petals. */
function drawing() {
  if (!drawingCache)
    drawingCache = Object.freeze({
      rosette: [ring(96, 41, 60, 0.92, 3000), ring(77, 29, 24, 0.8, 2200), ring(53, 17, 26, 0.7, 1500)].join(""),
      petals: petals(84, 12),
    });
  return drawingCache;
}

/** A course's length in words: "45 minutes", "1 hour", "2.5 hours"; null without minutes. */
function lengthOf(minutes) {
  const m = Number(minutes) || 0;
  if (m <= 0) return null;
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const hours = Math.round(m / 30) / 2;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/** The ring of the seal: the organisation's name, as the approved sample prints it. */
const sealRing = (name) => `· ${String(name || "MyCity App Ltd").toUpperCase()} · CERTIFIED TRAINING ·`;

/**
 * The certificate's page (defineDocType `draw`): the template, the facts checked against
 * CertificateDocumentVars, and the organisation from Settings (its logo, else its name as a wordmark).
 * @param {object} data  CertificateDocumentVars
 * @param {{org: object}} context  documents.generate's
 * @returns {string} the complete HTML
 */
function draw(data, { org }) {
  const checked = c.training.CertificateDocumentVars.parse(data);
  const template = templates.shipped("document", TEMPLATE);
  if (!template) throw new Error(`training: templates/documents/${TEMPLATE}.html is missing`);
  return render(template.body, {
    ...checked,
    fonts: fonts(),
    drawing: drawing(),
    logo: org && org.logo ? org.logo : null,
    organisation: (org && org.display_name) || "MyCity App",
    seal_ring: sealRing(org && org.name),
    staging: config.APP_ENV === "staging",
  });
}

/* ------------------------------------------------------------------ *
 * Issuing
 * ------------------------------------------------------------------ */

/** Where a certificate is verified: go.mycityapp.io/verify/<number>, which its QR opens. */
function verifyUrl(number) {
  return `${String(config.PUBLIC_ORIGIN).replace(/\/+$/, "")}/verify/${encodeURIComponent(number)}`;
}

/** The publisher's signature, stored at Publish (K7), as a data: URL. */
async function signatureOf(db, documentId) {
  const doc = documentId ? await vault.get(db, documentId) : null;
  if (!doc) throw new Error("training: the course's signature is not in the vault");
  return `data:image/png;base64,${(await storage.get(doc.storage_key)).toString("base64")}`;
}

/** What a completed place's certificate prints (CertificateDocumentVars). */
async function dataFor(db, cert) {
  const completedOn = lagos.dateOf(cert.completed_at);
  const items = Number(cert.items) || 0;
  return {
    number: cert.certificate_number,
    holder_name: cert.certificate_holder_name,
    course_title: cert.certificate_course_title,
    items: Math.max(items, 1),
    items_word: items === 1 ? "item" : "items",
    length: lengthOf(cert.minutes),
    completed_on: completedOn,
    issued_on: completedOn,
    year: completedOn.slice(0, 4),
    signer_name: cert.signer_name,
    signer_title: cert.signer_title || null,
    signature: await signatureOf(db, cert.signature_document_id),
    qr: await qr.dataUrl(verifyUrl(cert.certificate_number), { width: 480 }),
    verify_at: `${new URL(config.PUBLIC_ORIGIN).host}/verify`,
  };
}

/**
 * Generate a completed place's certificate, in the caller's transaction, once: a place that has
 * one, or no number (Issue Certificate off), is left as it is.
 * @returns {Promise<object|null>} the document row, or null
 */
async function issueIn(client, enrolmentId, actor = null) {
  const e = await repo.lockEnrolment(client, enrolmentId);
  if (!e || !e.certificate_number) return null;
  if (e.certificate_document_id) return vault.get(client, e.certificate_document_id);
  const cert = await repo.certificateOf(client, enrolmentId);
  const doc = await documents.generate(client, {
    doc_type: CERTIFICATE_DOC_TYPE,
    entity: { type: ENROLMENT_ENTITY, id: enrolmentId },
    subject_employee_id: e.employee_id,
    data: await dataFor(client, cert),
    actor,
    date: lagos.dateOf(cert.completed_at),
  });
  await repo.setCertificateDocument(client, enrolmentId, doc.document_id);
  return doc;
}

/** `training.issue_certificate`: after a completion commits. Safe to run twice. */
async function issue(enrolmentId) {
  return tx((client) => issueIn(client, enrolmentId, null));
}

/** `training.certificate_ready`: the PDF is stored, so the person is told. */
async function ready(documentId) {
  return tx(async (client) => {
    const doc = await vault.get(client, documentId);
    if (!doc || doc.doc_type !== CERTIFICATE_DOC_TYPE || doc.entity_type !== ENROLMENT_ENTITY) return false;
    const cert = await repo.certificateOf(client, doc.entity_id);
    if (!cert || cert.certificate_document_id !== documentId) return false;
    await emit(client, {
      key: EVENTS.TRAINING_CERTIFICATE_READY,
      entity: { type: ENROLMENT_ENTITY, id: cert.training_enrolment_id },
      actor: null,
      payload: {
        training_enrolment_id: cert.training_enrolment_id,
        training_course_id: cert.training_course_id,
        certificate_number: cert.certificate_number,
        title: cert.certificate_course_title,
        document_id: documentId,
        subject_employee_id: cert.employee_id,
      },
      dedup_key: `training.certificate_ready:${documentId}`,
    });
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * Download Certificate
 * ------------------------------------------------------------------ */

const noCertificate = () => new AppError("NO_CERTIFICATE", "This course has no certificate for you", 409);

/** The stored PDF of a place, issued now when the worker has not yet: ExportFile, pending until rendered. */
async function fileOf(enrolmentId, actor) {
  return tx(async (client) => {
    const doc = await issueIn(client, enrolmentId, actor);
    if (!doc) throw noCertificate();
    return exportFiles.present(doc);
  });
}

/** POST /training/me/courses/:id/certificate: the person's own (`:id` the course's or their enrolment's). */
async function mine(user, id) {
  const { enrolment } = await service().openable(pool, user, id);
  if (!enrolment || !enrolment.certificate_number) throw noCertificate();
  return fileOf(enrolment.training_enrolment_id, user);
}

/** POST /training/enrolments/:id/certificate: anyone's, for `training.manage`. */
async function forPlace(user, enrolmentId) {
  const e = await repo.enrolmentOf(pool, enrolmentId);
  if (!e) throw new AppError("NOT_FOUND", "That enrolment does not exist", 404);
  if (!e.certificate_number) throw new AppError("NO_CERTIFICATE", "This person has no certificate for this course", 409);
  return fileOf(enrolmentId, user);
}

/* ------------------------------------------------------------------ *
 * Verify a Document (go.mycityapp.io)
 * ------------------------------------------------------------------ */

/**
 * GET /verify/:ref for a CERT- number (signatures.verify.js hands it here): verifiable once its PDF
 * is stored; before that, and for a number nobody holds, the same 404 as any unknown reference.
 * @returns {Promise<object>} VerifyResult
 */
async function verify(number) {
  const found = await repo.byCertificateNumber(pool, String(number).trim());
  if (!found) throw notFound();
  const cert = await repo.certificateOf(pool, found.training_enrolment_id);
  const doc = cert && cert.certificate_document_id ? await vault.get(pool, cert.certificate_document_id) : null;
  if (!doc || doc.render_status !== "done") throw notFound();
  const completedOn = lagos.dateOf(cert.completed_at);
  const recomputed = service().certificateHash({
    number: cert.certificate_number,
    holder_name: cert.certificate_holder_name,
    course_number: cert.course_number,
    course_title: cert.certificate_course_title,
    completed_on: completedOn,
    publisher_name: cert.signer_name,
    publisher_title: cert.signer_title,
  });
  const stored = await storage
    .get(doc.storage_key)
    .then((bytes) => sha256(bytes))
    .catch(() => null);
  const org = await profile.readProfile(pool);
  return {
    reference: cert.certificate_number,
    document_type: "training_certificate",
    title: cert.certificate_course_title,
    issued_by: profile.displayName(org),
    issued_at: new Date(cert.completed_at).toISOString(),
    status: "completed",
    record_status: null,
    signers: [
      { name: cert.signer_name, title: cert.signer_title || null, role: "mycity", status: "signed", signed_at: null, method: null },
    ],
    signed_outside: false,
    content: cert.certificate_hash && sameHash(cert.certificate_hash, recomputed) ? "matches" : "differs",
    artifact: stored && doc.content_hash && sameHash(doc.content_hash, stored) ? "matches" : "differs",
    certificate: {
      holder_name: cert.certificate_holder_name,
      course_number: cert.course_number,
      course_title: cert.certificate_course_title,
      completed_on: completedOn,
      items: Number(cert.items) || 0,
      minutes: cert.minutes === null || cert.minutes === undefined ? null : Number(cert.minutes) || null,
    },
  };
}

module.exports = { draw, issue, issueIn, ready, mine, forPlace, verify, lengthOf, sealRing, verifyUrl, petals, ring };
