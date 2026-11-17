"use strict";
/**
 * The text of the library's files, so a word inside an agreement finds it (docs/guides/document-centre.md
 * §6.7, D9). Read in the worker after the file exists, never in a request:
 *
 *   queueFor(event)   document.stored, .claimed and .generated: a library type's file queues `document-text`
 *   read(documentId)  the job: the file's text into document_text, once (idempotent)
 *   sweep()           nightly: library documents with no text row, or a failed one, in batches
 *
 * A PDF is read by services/media/pdf-text.js (its first 200 pages and 500,000 characters); a Word
 * file's word/document.xml through jszip. Anything else (a picture, a spreadsheet) and a scanned
 * page have no text: `empty`, found by name. Only the library's types are read: a chat file's or a
 * mail attachment's text is never kept. The text is never sent to a model (D12).
 */
const JSZip = require("jszip");
const { pool } = require("../../config/db");
const { logger } = require("../../config/logger");
const library = require("../../shared/documents/library");
const storage = require("../../services/storage/storage.service");
const pdfText = require("../../services/media/pdf-text");

/** How much of a file is read (§6.7). */
const LIMITS = Object.freeze({ pages: 200, chars: 500_000 });
/** A long PDF takes longer than a CV: two minutes and 512 MB, in its own process. */
const PDF_RUN = Object.freeze({ timeoutMs: 120_000, memoryMb: 512 });
/** Files one sweep queues. */
const SWEEP_BATCH = 100;
/** A failed read is tried again by the sweep once this long has passed. */
const RETRY_AFTER_HOURS = 24;

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Whether a doc type is one the library lists, so its text is worth keeping. */
const isLibraryType = (docType) => library.sources().some((s) => s.doc_types.includes(docType));

/** Outbox: queue the read for a library type's file. */
async function queueFor(event) {
  const p = event.payload || {};
  if (!p.document_id || !isLibraryType(p.doc_type)) return;
  await require("../../jobs/queues").enqueue("document-text", "document-text", { document_id: p.document_id }, { jobId: `document-text-${p.document_id}-${event.event_id}` });
}

/** The text of a Word file: its paragraphs, in order, tabs kept, at most `chars` characters. */
async function wordText(buffer, { chars = LIMITS.chars } = {}) {
  const zip = await JSZip.loadAsync(buffer);
  const part = zip.file("word/document.xml");
  if (!part) return null;
  const xml = await part.async("string");
  const text = xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\/>|<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, chars);
  return text || null;
}

/** What a file says: { status, text, pages }. */
async function extract(doc) {
  if (doc.mime === PDF) return pdfText.read(doc.storage_key, { ...LIMITS, ...PDF_RUN, detail: true });
  if (doc.mime === DOCX) {
    try {
      const text = await wordText(await storage.get(doc.storage_key));
      return { status: text ? "done" : "empty", text, pages: null };
    } catch (err) {
      logger.warn({ err: err.message, document_id: doc.document_id }, "a Word file's text could not be read");
      return { status: "failed", text: null, pages: null };
    }
  }
  return { status: "empty", text: null, pages: null };
}

/**
 * The job: read one file's text into document_text. A file already read is left as it is (a failed
 * read is read again); a file gone, superseded before it was read or not a library type is skipped.
 * @returns {Promise<{status: string}|null>}
 */
async function read(documentId, db = pool) {
  const { rows } = await db.query(
    `SELECT d.document_id, d.doc_type, d.mime, d.storage_key, d.scan_status, dt.status AS text_status
       FROM document d LEFT JOIN document_text dt ON dt.document_id = d.document_id
      WHERE d.document_id = $1`,
    [documentId],
  );
  const doc = rows[0];
  if (!doc || !isLibraryType(doc.doc_type) || doc.scan_status === "pending" || doc.scan_status === "infected") return null;
  if (doc.text_status === "done" || doc.text_status === "empty") return { status: doc.text_status };
  const found = await extract(doc);
  await db.query(
    `INSERT INTO document_text (document_id, status, text, pages, chars, extracted_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (document_id) DO UPDATE
       SET status = EXCLUDED.status, text = EXCLUDED.text, pages = EXCLUDED.pages, chars = EXCLUDED.chars,
           extracted_at = EXCLUDED.extracted_at`,
    [documentId, found.status, found.text, found.pages, found.text ? found.text.length : null],
  );
  return { status: found.status };
}

/**
 * Nightly: the library's current documents with no text yet (stored before the Document Centre read
 * text, or whose read never ran) and those whose read failed a day ago or more, a batch at a time.
 */
async function sweep(db = pool) {
  const types = library.sources().flatMap((s) => s.doc_types);
  const { rows } = await db.query(
    `SELECT d.document_id
       FROM document d LEFT JOIN document_text dt ON dt.document_id = d.document_id
      WHERE d.is_current AND d.doc_type = ANY($1::text[]) AND d.scan_status IN ('clean', 'skipped')
        AND COALESCE(d.render_status, 'done') = 'done'
        AND (dt.document_id IS NULL OR (dt.status = 'failed' AND dt.updated_at < now() - make_interval(hours => $2::int)))
      ORDER BY d.created_at DESC, d.document_id
      LIMIT $3 -- pagination:batch the files one nightly sweep queues`,
    [types, RETRY_AFTER_HOURS, SWEEP_BATCH],
  );
  const queues = require("../../jobs/queues");
  const day = new Date().toISOString().slice(0, 10);
  for (const r of rows) await queues.enqueue("document-text", "document-text", { document_id: r.document_id }, { jobId: `document-text-${r.document_id}-sweep-${day}` });
  return { queued: rows.length };
}

module.exports = { LIMITS, queueFor, read, sweep, wordText, extract, isLibraryType };
