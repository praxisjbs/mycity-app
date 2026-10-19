"use strict";
/**
 * The organisation's profile as Settings · Organisation keeps it: one `setting` row per field
 * (`organisation.<field>`), entered on screen and never seeded (docs/guides/foundation.md §4).
 * This is the one reader for everything that prints the company: the settings screens,
 * letterheads and PDFs, system mail and email signatures. The writes are the settings
 * service's alone.
 *
 * The brand files (§6.11) are three of those rows, each a document id: the logo for white
 * paper, the white logo for Deep Green and the icon. `brandFile()` reads one's bytes and
 * `brandPicture()` fits one to the height it is drawn at, both kept in memory by document id:
 * a replaced file has a new id, so the cache never serves an old one.
 */
const sharp = require("sharp");
const { logger } = require("../../config/logger");
const storage = require("../../services/storage/storage.service");

const FIELDS = Object.freeze([
  "legal_name",
  "trading_name",
  "registration_number",
  "tax_id",
  "address",
  "phone",
  "email",
  "website",
]);

/** Each brand slot and the setting field that holds its document id. */
const BRAND = Object.freeze({
  logo: "logo_document_id",
  logo_white: "logo_white_document_id",
  icon: "icon_document_id",
});

const keyOf = (field) => `organisation.${field}`;

/**
 * Every field, null where nobody has entered it.
 * @param {{query: Function}} db
 * @returns {Promise<Record<string, string|null>>}
 */
async function readProfile(db) {
  const fields = [...FIELDS, ...Object.values(BRAND)];
  let rows = [];
  try {
    ({ rows } = await db.query(
      "SELECT key, value FROM setting WHERE key = ANY($1::text[])",
      [fields.map(keyOf)],
    ));
  } catch (err) {
    // Before the settings migration has run (a fresh test database), the profile is empty.
    if (err.code !== "42P01") throw err;
  }
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const out = {};
  for (const f of fields) {
    const v = stored[keyOf(f)];
    out[f] = typeof v === "string" && v ? v : null;
  }
  return out;
}

/** The name the company goes by: its trading name, else its legal name, else the product's. */
function displayName(profile) {
  return (profile && (profile.trading_name || profile.legal_name)) || "MyCity App";
}

/** The RC number as it is printed: "RC" in front unless it is already there; null when not entered. */
function rcOf(registration) {
  const v = String(registration ?? "").trim();
  if (!v) return null;
  return /^rc\b/i.test(v) ? v : `RC ${v}`;
}

const files = new Map();
const MAX_CACHED = 12;

/**
 * A brand file's bytes and type, or null when the document is gone or not readable yet.
 * @param {{query: Function}} db
 * @param {string|null} documentId
 * @returns {Promise<{document_id: string, buffer: Buffer, mime: string}|null>}
 */
async function brandFile(db, documentId) {
  if (!documentId) return null;
  if (files.has(documentId)) return files.get(documentId);
  const { rows } = await db.query(
    "SELECT document_id, storage_key, mime, scan_status FROM document WHERE document_id = $1",
    [documentId],
  );
  const doc = rows[0];
  if (!doc || doc.scan_status === "pending" || doc.scan_status === "infected") return null;
  const file = { document_id: doc.document_id, buffer: await storage.get(doc.storage_key), mime: doc.mime };
  if (files.size >= MAX_CACHED) files.delete(files.keys().next().value);
  files.set(documentId, file);
  return file;
}

const pictures = new Map();

/**
 * A brand file fitted to the height it is drawn at, as a PNG `scale` times that size so it is
 * sharp on a phone and in print. Null when there is no file or it cannot be read: whatever
 * draws it falls back to the company's name, so a missing logo never stops a letter or a mail.
 * @param {{query: Function}} db
 * @param {string|null} documentId
 * @param {{height: number, scale?: number}} size  CSS pixels
 * @returns {Promise<{buffer: Buffer, width: number, height: number, mime: string}|null>}
 */
async function brandPicture(db, documentId, { height, scale = 2 }) {
  if (!documentId) return null;
  const key = `${documentId}:${height}:${scale}`;
  if (pictures.has(key)) return pictures.get(key);
  try {
    const file = await brandFile(db, documentId);
    if (!file) return null;
    const buffer = await sharp(file.buffer).resize({ height: height * scale }).png({ compressionLevel: 9 }).toBuffer();
    const meta = await sharp(buffer).metadata();
    const pic = { buffer, width: Math.round(meta.width / scale), height, mime: "image/png" };
    if (pictures.size >= MAX_CACHED) pictures.delete(pictures.keys().next().value);
    pictures.set(key, pic);
    return pic;
  } catch (err) {
    logger.warn({ err: err.message, document_id: documentId }, "brand file not readable; the name is drawn instead");
    return null;
  }
}

/** A picture as a data: URL, for a page that fetches nothing (a PDF, a preview). */
const dataUrl = (pic) => `data:${pic.mime || "image/png"};base64,${pic.buffer.toString("base64")}`;

module.exports = { FIELDS, BRAND, keyOf, readProfile, displayName, rcOf, brandFile, brandPicture, dataUrl };
