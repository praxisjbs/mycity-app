"use strict";
/**
 * File names and storage keys.
 *
 *  - The name a person gave a file is kept for DISPLAY only (the download name,
 *    the list). It never becomes part of a path.
 *  - The storage key is generated: `<area>/<yyyy>/<mm>/<uuid>.<ext>`, the extension
 *    taken from the sniffed type (BACKEND_STRUCTURE §1, the media layout).
 *  - Content-Disposition is written so any name survives: an ASCII fallback plus
 *    the UTF-8 name (RFC 6266 / 5987), so "Chíọmá's CV.pdf" downloads as itself.
 */
const crypto = require("node:crypto");
const path = require("node:path");
const lagos = require("../time/lagos");

/** Areas under MEDIA_ROOT, and whether they are dated (BACKEND_STRUCTURE §1). */
const AREAS = Object.freeze({
  vault: { dated: true },
  comms: { dated: true },
  generated: { dated: true },
  avatars: { dated: false },
  imports: { dated: false },
  derived: { dated: false },
  quarantine: { dated: false },
  public: { dated: false },
});

const MAX_NAME = 180;

/** Control characters and the bidi overrides that make "cv\u202Efdp.exe" read as "cv.exe.pdf". */
const UNSAFE_CHAR = (c) =>
  c < 0x20 ||
  c === 0x7f ||
  (c >= 0x202a && c <= 0x202e) ||
  (c >= 0x2066 && c <= 0x2069);

/**
 * A display name safe to show and to put in a header: the last path segment,
 * control and bidi-override characters removed, whitespace collapsed, bounded.
 * @param {string} original
 * @param {string} [ext]  the sniffed extension, appended when the name lacks it
 */
function displayName(original, ext) {
  let name = String(original || "")
    .split(/[\\/]/)
    .pop();
  name = name
    .normalize("NFC")
    .split("")
    .filter((ch) => !UNSAFE_CHAR(ch.charCodeAt(0)))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (!name || name === "." || name === "..") name = "file";
  if (ext && path.extname(name).slice(1).toLowerCase() !== ext)
    name = `${name.replace(/\.[^.]{1,8}$/, "")}.${ext}`;
  if (name.length > MAX_NAME) {
    const e = path.extname(name);
    name = name.slice(0, MAX_NAME - e.length) + e;
  }
  return name;
}

/**
 * A new storage key in an area.
 * @param {string} area  a key of AREAS
 * @param {string} ext   from sniff()
 * @param {{date?: string, prefix?: string}} [opts]  prefix: a sub-folder for undated areas (imports/<batch>)
 */
function storageKey(area, ext, { date = lagos.today(), prefix = null } = {}) {
  if (!AREAS[area]) throw new Error(`safe-name: unknown area "${area}"`);
  if (!/^[a-z0-9]{1,8}$/.test(String(ext || "")))
    throw new Error(`safe-name: bad extension "${ext}"`);
  if (prefix !== null && !/^[a-z0-9-]{1,64}$/i.test(prefix))
    throw new Error(`safe-name: bad prefix "${prefix}"`);
  const id = crypto.randomUUID();
  const parts = [area];
  if (AREAS[area].dated) parts.push(date.slice(0, 4), date.slice(5, 7));
  if (prefix) parts.push(prefix);
  parts.push(`${id}.${ext}`);
  return parts.join("/");
}

/** The key's area ("vault"). */
const areaOf = (key) => String(key || "").split("/")[0];

const asciiFallback = (name) =>
  name
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/["\\]/g, "")
    .trim() || "file";

/**
 * @param {string} name  a displayName()
 * @param {{inline?: boolean}} [opts]
 */
function contentDisposition(name, { inline = false } = {}) {
  const safe = displayName(name);
  return `${inline ? "inline" : "attachment"}; filename="${asciiFallback(safe)}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

module.exports = { AREAS, displayName, storageKey, areaOf, contentDisposition };
