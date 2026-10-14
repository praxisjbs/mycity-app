"use strict";
/**
 * The vault: every file the system keeps, uploaded or generated, is a `document`
 * row and a file under MEDIA_ROOT (BACKEND_STRUCTURE §5). A module never keeps its
 * own file table or a path column; it keeps a document_id.
 *
 *   // controller: upload.single("file", { purpose: "document" }) ran first
 *   const doc = await atomically(client, () =>
 *     vault.store(client, {
 *       file: readUpload(req),
 *       purpose: "document",
 *       doc_type: "employee_certificate",
 *       entity: { type: "employee", id: employeeId },
 *       subject_employee_id: employeeId,           // whose document it is (ESS "self" access)
 *       sensitivity: "personal",                   // normal | personal | restricted
 *       actor: req.user,
 *     }));
 *
 * What store() does, in order:
 *   1. the type from the bytes (sniff), refused unless the purpose allows it (mime-policy);
 *   2. an image goes through the image pipeline (profile from the purpose), so the master
 *      is re-encoded, upright and stripped of GPS and other metadata;
 *   3. the master is stored under a generated key (<area>/<yyyy>/<mm>/<uuid>.<ext>) and
 *      hashed AS STORED; image variants go to derived/<document id>/;
 *   4. the row is written in the caller's transaction and document.stored is emitted, so
 *      the follow-on work (scan, voice/video transcoding) runs in the worker after commit.
 *
 * A stranger's upload (`stranger: true`: a CV, a candidate's document) is not touched
 * beyond the type check: it lands in quarantine/ with scan_status "pending", and only
 * completeScan() after a clean clamd verdict processes it and moves it into the vault.
 * Nothing serves a pending or infected file.
 *
 * Versions, not overwrites: supersede() adds a new row pointing at the old one; the old
 * bytes stay. A locked document (signed, sent, filed) cannot be superseded.
 *
 * Who may read a document (canRead): the CEO; the employee it is about; whoever uploaded
 * it; otherwise a `view` grant on the module the record belongs to (route map), within
 * scope (all, or the subject is in the caller's team, or is the caller). A `restricted`
 * document (payslip, bank letter, ID) also needs that module's `edit` grant, so view-only
 * roles cannot open them. A module whose records need a finer rule (a direct message's
 * attachment is for the two people in it) registers it with defineAccess(); that rule
 * then decides alone.
 *
 * Tables (migration 0080; BACKEND_STRUCTURE §11.1): document, document_variant.
 */
const crypto = require("node:crypto");
const { AppError } = require("../errors");
const { inTransaction } = require("../db/tx");
const { sniff, typeForExt } = require("../files/sniff");
const policy = require("../files/mime-policy");
const { sha256 } = require("../files/hash");
const { displayName, storageKey, contentDisposition } = require("../files/safe-name");
const { emit } = require("../events/emit");
const { defineEvents } = require("../events/catalogue");
const routeMap = require("../route-map");
const grantsCache = require("../rbac/grants-cache");
const storage = require("../../services/storage/storage.service");
const images = require("../../services/media/image-pipeline");

const EVENTS = defineEvents("settings", {
  "document.stored": { summary: "A file was stored" },
  "document.superseded": { summary: "A file was replaced by a new version" },
  "document.locked": { summary: "A document was locked" },
  "document.scanned": { summary: "A file from outside was scanned" },
  "document.render_requested": { summary: "A document was queued for generation" },
  "document.generated": { summary: "A document was generated" },
  "document.render_failed": { summary: "A document could not be generated" },
});

const SENSITIVITIES = new Set(["normal", "personal", "restricted"]);
const SOURCES = new Set(["upload", "generated", "import"]);
const DOC_TYPE_RE = /^[a-z][a-z0-9_]{1,63}$/;

const COLUMNS = `document_id, doc_type, title, original_name, storage_key, mime, bytes, content_hash, version,
  supersedes_id, is_current, entity_type, entity_id, subject_employee_id, sensitivity, locked_at, expires_on,
  scan_status, source, number, template_key, template_version, render_status, render_error, width, height,
  duration_ms, uploaded_by, created_at`;

/** Where a purpose's files live (BACKEND_STRUCTURE §1). */
const AREA_FOR = Object.freeze({
  avatar: "avatars",
  photo: "vault",
  document: "vault",
  signature: "vault",
  voice_note: "comms",
  video: "comms",
  attachment: "comms",
  import_sheet: "imports",
});

const PROFILE_FOR = Object.freeze({ avatar: "avatar", photo: "photo", signature: "signature" });

/** entity_type → (client, user, doc) => Promise<boolean> */
const ACCESS = new Map();

function moduleFor(entityType) {
  return routeMap.moduleOf(entityType) || "settings";
}

function actorId(actor) {
  if (!actor) return null;
  return typeof actor === "string" ? actor : actor.user_id || null;
}

function checkMeta({ doc_type: docType, entity, sensitivity, source }) {
  if (!DOC_TYPE_RE.test(String(docType || ""))) throw new Error(`vault: doc_type "${docType}" is snake_case`);
  if (!entity || !/^[a-z][a-z0-9_]*$/.test(String(entity.type || "")) || !entity.id) throw new Error("vault: entity { type, id } is required");
  if (!SENSITIVITIES.has(sensitivity)) throw new Error(`vault: sensitivity is normal, personal or restricted (got "${sensitivity}")`);
  if (!SOURCES.has(source)) throw new Error(`vault: source is upload, generated or import (got "${source}")`);
}

async function insertRow(client, row) {
  const cols = Object.keys(row);
  const { rows } = await client.query(
    `INSERT INTO document (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING ${COLUMNS}`,
    cols.map((c) => row[c]),
  );
  return rows[0];
}

async function insertVariants(client, documentId, variants) {
  for (const v of variants) {
    await client.query(
      `INSERT INTO document_variant (document_id, kind, storage_key, mime, bytes, width, height)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (document_id, kind) DO UPDATE
         SET storage_key = EXCLUDED.storage_key, mime = EXCLUDED.mime, bytes = EXCLUDED.bytes,
             width = EXCLUDED.width, height = EXCLUDED.height`,
      [documentId, v.kind, v.key, v.mime, v.bytes, v.width || null, v.height || null],
    );
  }
}

/** Store image variants beside a master; one that fails to store is skipped. */
async function putVariants(documentId, variants) {
  const stored = [];
  for (const v of variants) {
    const key = `derived/${documentId}/${v.kind}.${v.ext}`;
    try {
      await storage.put(key, v.buffer, { overwrite: true });
      stored.push({ kind: v.kind, key, mime: v.mime, bytes: v.buffer.length, width: v.width, height: v.height });
    } catch {
      /* a missing variant is a slower list, never a lost document */
    }
  }
  return stored;
}

/** Bytes in → { master buffer, type, variants, width, height }, through the image pipeline when it is one. */
async function prepare(buffer, type, purpose) {
  if (!images.isProcessable(type)) return { buffer, type, variants: [], width: null, height: null };
  const out = await images.processImage(buffer, type, PROFILE_FOR[purpose] || "document");
  return { buffer: out.master.buffer, type: out.master.type, variants: out.variants, width: out.master.width, height: out.master.height };
}

/**
 * Store a file and record it.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {object} opts
 * @param {{buffer: Buffer, originalname: string}} opts.file   readUpload(req), or bytes the system made
 * @param {string} opts.purpose      an upload purpose (shared/http/body-limits.js)
 * @param {string} opts.doc_type     what the document is ("employee_certificate", "cv")
 * @param {{type: string, id: string}} opts.entity  the record it belongs to
 * @param {string} [opts.subject_employee_id]  the employee it is about
 * @param {"normal"|"personal"|"restricted"} [opts.sensitivity]
 * @param {"upload"|"import"} [opts.source]
 * @param {boolean} [opts.stranger]  sent by someone outside (public surface): quarantine and scan
 * @param {string} [opts.title]
 * @param {string} [opts.expires_on]  YYYY-MM-DD (an ID card, a certificate)
 * @param {object|string|null} opts.actor
 * @returns {Promise<object>} the document row
 */
async function store(client, opts) {
  if (!inTransaction(client)) throw new Error("vault.store must run inside atomically()");
  const { file, purpose, sensitivity = "normal", source = "upload", stranger = false } = opts;
  checkMeta({ ...opts, sensitivity, source });
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw new AppError("FILE_REQUIRED", "Choose a file to upload", 422, { file: ["is empty"] });
  }
  const sniffed = policy.assertAllowed(purpose, sniff(file.buffer, file.originalname));

  const id = crypto.randomUUID();
  const ready = stranger ? { buffer: file.buffer, type: sniffed, variants: [], width: null, height: null } : await prepare(file.buffer, sniffed, purpose);
  const key = stranger ? storageKey("quarantine", ready.type.ext) : storageKey(AREA_FOR[purpose] || "vault", ready.type.ext);
  await storage.put(key, ready.buffer);
  const variants = await putVariants(id, ready.variants);

  const row = await insertRow(client, {
    document_id: id,
    doc_type: opts.doc_type,
    title: opts.title ? String(opts.title).trim().slice(0, 200) : null,
    original_name: displayName(file.originalname, ready.type.ext),
    storage_key: key,
    mime: ready.type.mime,
    bytes: ready.buffer.length,
    content_hash: sha256(ready.buffer),
    version: opts.version || 1,
    supersedes_id: opts.supersedes_id || null,
    entity_type: opts.entity.type,
    entity_id: String(opts.entity.id),
    subject_employee_id: opts.subject_employee_id || null,
    sensitivity,
    expires_on: opts.expires_on || null,
    scan_status: stranger ? "pending" : "skipped",
    source,
    width: ready.width,
    height: ready.height,
    uploaded_by: actorId(opts.actor),
  });
  await insertVariants(client, id, variants);

  const needs = [];
  if (stranger) needs.push("scan");
  else if (sniffed.kind === "audio" || sniffed.kind === "video") needs.push("av");
  await emit(client, {
    key: EVENTS.DOCUMENT_STORED,
    entity: { type: "document", id },
    module: moduleFor(opts.entity.type),
    actor: opts.actor,
    after: row,
    payload: { document_id: id, doc_type: row.doc_type, kind: sniffed.kind, needs, entity_type: row.entity_type, entity_id: row.entity_id },
  });
  return row;
}

/**
 * Replace a document with a new version. The old row and bytes stay; the new row
 * points at it. Refused for a locked document.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {{document_id: string, file: object, purpose: string, actor: object, title?: string}} opts
 */
async function supersede(client, { document_id: oldId, file, purpose, actor, title }) {
  if (!inTransaction(client)) throw new Error("vault.supersede must run inside atomically()");
  const { rows } = await client.query(`SELECT ${COLUMNS} FROM document WHERE document_id = $1 FOR UPDATE`, [oldId]);
  const old = rows[0];
  if (!old) throw new AppError("NOT_FOUND", "Document not found", 404);
  if (old.locked_at) throw new AppError("DOCUMENT_LOCKED", "This document is locked and cannot be replaced", 409);
  if (!old.is_current) throw new AppError("DOCUMENT_SUPERSEDED", "A newer version of this document already exists", 409);
  await client.query("UPDATE document SET is_current = false WHERE document_id = $1", [oldId]);
  const next = await store(client, {
    file,
    purpose,
    doc_type: old.doc_type,
    title: title || old.title,
    entity: { type: old.entity_type, id: old.entity_id },
    subject_employee_id: old.subject_employee_id,
    sensitivity: old.sensitivity,
    source: old.source,
    expires_on: old.expires_on,
    version: old.version + 1,
    supersedes_id: oldId,
    actor,
  });
  await emit(client, {
    key: EVENTS.DOCUMENT_SUPERSEDED,
    entity: { type: "document", id: next.document_id },
    module: moduleFor(old.entity_type),
    actor,
    payload: { document_id: next.document_id, supersedes_id: oldId, version: next.version },
  });
  return next;
}

/** Lock a document (signed, sent, filed). Idempotent: locking twice changes nothing. */
async function lock(client, documentId, actor) {
  if (!inTransaction(client)) throw new Error("vault.lock must run inside atomically()");
  const { rows } = await client.query(`SELECT ${COLUMNS} FROM document WHERE document_id = $1 FOR UPDATE`, [documentId]);
  if (!rows[0]) throw new AppError("NOT_FOUND", "Document not found", 404);
  if (rows[0].locked_at) return rows[0];
  const { rows: up } = await client.query(`UPDATE document SET locked_at = now() WHERE document_id = $1 RETURNING ${COLUMNS}`, [documentId]);
  await emit(client, {
    key: EVENTS.DOCUMENT_LOCKED,
    entity: { type: "document", id: documentId },
    module: moduleFor(up[0].entity_type),
    actor,
    payload: { document_id: documentId },
  });
  return up[0];
}

async function get(client, documentId) {
  const { rows } = await client.query(`SELECT ${COLUMNS} FROM document WHERE document_id = $1`, [documentId]);
  return rows[0] || null;
}

async function variantOf(client, documentId, kind) {
  const { rows } = await client.query(
    "SELECT kind, storage_key, mime, bytes, width, height FROM document_variant WHERE document_id = $1 AND kind = $2",
    [documentId, kind],
  );
  return rows[0] || null;
}

/* ------------------------------------------------------------------ *
 * Access
 * ------------------------------------------------------------------ */

/**
 * A finer read rule for one entity type's documents. The rule decides alone.
 * @param {string} entityType
 * @param {(client, user, doc) => Promise<boolean>} fn
 */
function defineAccess(entityType, fn) {
  if (ACCESS.has(entityType) && ACCESS.get(entityType) !== fn) throw new Error(`vault.defineAccess: ${entityType} already has a rule`);
  ACCESS.set(entityType, fn);
}

async function canRead(client, user, doc) {
  if (!user || !user.user_id || !doc) return false;
  const rule = ACCESS.get(doc.entity_type);
  if (rule) return Boolean(await rule(client, user, doc));
  if (user.is_ceo === true) return true;
  if (doc.subject_employee_id && doc.subject_employee_id === user.employee_id) return true;
  if (doc.uploaded_by && doc.uploaded_by === user.user_id) return true;

  const module = routeMap.moduleOf(doc.entity_type);
  if (!module) return false;
  const { scopeFromGrants } = require("../../middleware/rbac");
  const rows = await grantsCache.getGrants(client, { role_ids: user.role_ids || [], module });
  const scope = scopeFromGrants(rows, "view");
  if (!scope) return false;
  if (doc.sensitivity === "restricted" && !scopeFromGrants(rows, "edit")) return false;
  if (scope === "all") return true;
  if (!doc.subject_employee_id) return false;
  if (scope === "own") return doc.subject_employee_id === user.employee_id;
  const team = await grantsCache.getTeamEmployeeIds(client, user.employee_id);
  return team.includes(doc.subject_employee_id);
}

/** The document, or a 404 when it does not exist OR the caller may not read it. */
async function getReadable(client, user, documentId) {
  const doc = await get(client, documentId);
  if (!doc || !(await canRead(client, user, doc))) throw new AppError("NOT_FOUND", "Document not found", 404);
  return doc;
}

/* ------------------------------------------------------------------ *
 * Serving
 * ------------------------------------------------------------------ */

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || "").trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start;
  let end;
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return "unsatisfiable";
  return { start, end };
}

/**
 * Send a document's bytes (or one variant's). The caller has already checked access
 * (getReadable). Single byte ranges are honoured, so audio and video seek.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {object} doc
 * @param {{variant?: object|null, inline?: boolean}} [opts]
 */
async function serve(req, res, doc, { variant = null, inline = false } = {}) {
  if (doc.scan_status === "pending") throw new AppError("DOCUMENT_SCANNING", "This file is still being checked. Try again in a minute.", 409);
  if (doc.scan_status === "infected") throw new AppError("DOCUMENT_INFECTED", "This file failed its virus check and cannot be opened.", 410);
  if (doc.render_status === "pending") throw new AppError("DOCUMENT_RENDERING", "This document is still being generated.", 409);
  if (doc.render_status === "failed") throw new AppError("DOCUMENT_RENDER_FAILED", "This document could not be generated.", 410);

  const key = variant ? variant.storage_key : doc.storage_key;
  const mime = variant ? variant.mime : doc.mime;
  const meta = await storage.stat(key);
  if (!meta) throw new AppError("FILE_MISSING", "The file for this document is missing", 410);

  const range = req.headers.range ? parseRange(req.headers.range, meta.bytes) : null;
  if (range === "unsatisfiable") {
    res.status(416).set("Content-Range", `bytes */${meta.bytes}`).end();
    return;
  }
  res.set({
    "Content-Type": mime,
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
    "Cache-Control": variant ? "private, max-age=300" : "private, no-store",
    "Content-Disposition": contentDisposition(variant ? `${doc.original_name}` : doc.original_name, { inline: inline || Boolean(variant) }),
  });
  if (mime !== "application/pdf") res.set("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self'; media-src 'self'");
  if (doc.content_hash && !variant) res.set("ETag", `"${doc.content_hash}"`);

  const { stream } = await storage.open(key, range || {});
  if (range) {
    res.status(206).set({ "Content-Range": `bytes ${range.start}-${range.end}/${meta.bytes}`, "Content-Length": String(range.end - range.start + 1) });
  } else {
    res.status(200).set("Content-Length", String(meta.bytes));
  }
  await new Promise((resolve, reject) => {
    stream.on("error", reject);
    res.on("close", () => {
      stream.destroy();
      resolve();
    });
    stream.pipe(res);
  });
}

/* ------------------------------------------------------------------ *
 * Worker follow-ups
 * ------------------------------------------------------------------ */

/**
 * Record a clamd verdict for a quarantined upload. Clean: processed like any upload and
 * moved into the vault. Infected: left in quarantine, marked, never served.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {string} documentId
 * @param {{clean: boolean, signature?: string}} verdict
 */
async function completeScan(client, documentId, verdict) {
  if (!inTransaction(client)) throw new Error("vault.completeScan must run inside atomically()");
  const { rows } = await client.query(`SELECT ${COLUMNS} FROM document WHERE document_id = $1 FOR UPDATE`, [documentId]);
  const doc = rows[0];
  if (!doc || doc.scan_status !== "pending") return doc || null;

  if (!verdict.clean) {
    const { rows: up } = await client.query(`UPDATE document SET scan_status = 'infected' WHERE document_id = $1 RETURNING ${COLUMNS}`, [documentId]);
    await emit(client, {
      key: EVENTS.DOCUMENT_SCANNED,
      entity: { type: "document", id: documentId },
      module: moduleFor(doc.entity_type),
      actor: null,
      payload: { document_id: documentId, clean: false, signature: verdict.signature || null },
    });
    return up[0];
  }

  const bytes = await storage.get(doc.storage_key);
  const type = typeForExt(doc.storage_key.split(".").pop());
  const ready = await prepare(bytes, type, "document");
  const key = storageKey("vault", ready.type.ext);
  await storage.put(key, ready.buffer);
  const variants = await putVariants(documentId, ready.variants);
  const { rows: up } = await client.query(
    `UPDATE document SET scan_status = 'clean', storage_key = $2, mime = $3, bytes = $4, content_hash = $5,
            width = $6, height = $7
      WHERE document_id = $1 RETURNING ${COLUMNS}`,
    [documentId, key, ready.type.mime, ready.buffer.length, sha256(ready.buffer), ready.width, ready.height],
  );
  await insertVariants(client, documentId, variants);
  await emit(client, {
    key: EVENTS.DOCUMENT_SCANNED,
    entity: { type: "document", id: documentId },
    module: moduleFor(doc.entity_type),
    actor: null,
    payload: { document_id: documentId, clean: true, quarantine_key: doc.storage_key },
  });
  return up[0];
}

/** Record transcoded audio/video variants and the duration (av-transcode job). */
async function completeAv(client, documentId, derived) {
  if (!inTransaction(client)) throw new Error("vault.completeAv must run inside atomically()");
  await insertVariants(client, documentId, derived.variants);
  await client.query(
    "UPDATE document SET duration_ms = COALESCE($2, duration_ms), width = COALESCE($3, width), height = COALESCE($4, height) WHERE document_id = $1",
    [documentId, derived.duration_ms, derived.width, derived.height],
  );
}

module.exports = {
  EVENTS,
  COLUMNS,
  AREA_FOR,
  store,
  supersede,
  lock,
  get,
  getReadable,
  variantOf,
  canRead,
  defineAccess,
  serve,
  parseRange,
  completeScan,
  completeAv,
  insertRow,
  moduleFor,
};
