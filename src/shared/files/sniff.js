"use strict";
/**
 * What a file IS, read from its bytes. Never from the extension, never from the
 * Content-Type the browser sent: both are whatever the sender typed.
 *
 *   const { sniff } = require("../../shared/files/sniff");
 *   sniff(buffer, "Staff list.xlsx")
 *     → { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx", kind: "sheet" }
 *
 * The file name is consulted for one thing only: telling CSV from plain text,
 * which the bytes cannot (both are text). It never decides anything else.
 *
 * Kinds: image, audio, video, pdf, document (docx), sheet (xlsx, csv), slides
 * (pptx), text, markup (html, svg, xml: recognised so they can be REFUSED), and
 * unknown. shared/files/mime-policy.js decides what each upload purpose accepts.
 *
 * Signatures are the published magic numbers. Office files are ZIP archives; the
 * first entries name the part ("word/", "xl/", "ppt/"), which is what tells a
 * .docx from an .xlsx from any other ZIP (an arbitrary ZIP is refused).
 */

const UNKNOWN = Object.freeze({ mime: "application/octet-stream", ext: "bin", kind: "unknown" });

const t = (mime, ext, kind) => Object.freeze({ mime, ext, kind });

const TYPES = Object.freeze({
  pdf: t("application/pdf", "pdf", "pdf"),
  png: t("image/png", "png", "image"),
  jpeg: t("image/jpeg", "jpg", "image"),
  gif: t("image/gif", "gif", "image"),
  webp: t("image/webp", "webp", "image"),
  heic: t("image/heic", "heic", "image"),
  avif: t("image/avif", "avif", "image"),
  mp4: t("video/mp4", "mp4", "video"),
  mov: t("video/quicktime", "mov", "video"),
  m4a: t("audio/mp4", "m4a", "audio"),
  webm: t("video/webm", "webm", "video"),
  webm_audio: t("audio/webm", "webm", "audio"),
  ogg: t("audio/ogg", "ogg", "audio"),
  mp3: t("audio/mpeg", "mp3", "audio"),
  wav: t("audio/wav", "wav", "audio"),
  docx: t("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx", "document"),
  xlsx: t("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx", "sheet"),
  pptx: t("application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx", "slides"),
  ole: t("application/x-ole-storage", "ole", "legacy_office"),
  zip: t("application/zip", "zip", "archive"),
  csv: t("text/csv", "csv", "sheet"),
  txt: t("text/plain", "txt", "text"),
  html: t("text/html", "html", "markup"),
  svg: t("image/svg+xml", "svg", "markup"),
  xml: t("application/xml", "xml", "markup"),
});

const startsWith = (buf, bytes, offset = 0) => bytes.every((b, i) => buf[offset + i] === b);
const ascii = (buf, start, end) => buf.subarray(start, Math.min(end, buf.length)).toString("latin1");

/** ISO base media (MP4, MOV, HEIC, AVIF): "ftyp" at 4, brand at 8. */
function isoBrand(buf) {
  if (buf.length < 12 || ascii(buf, 4, 8) !== "ftyp") return null;
  const major = ascii(buf, 8, 12);
  const size = buf.readUInt32BE(0);
  const compatible = [];
  for (let i = 16; i + 4 <= Math.min(size, buf.length, 64); i += 4) compatible.push(ascii(buf, i, i + 4));
  return { major, compatible };
}

function fromIso(brand) {
  const all = [brand.major, ...brand.compatible];
  if (all.some((b) => ["avif", "avis"].includes(b))) return TYPES.avif;
  if (all.some((b) => ["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(b))) return TYPES.heic;
  if (brand.major === "qt  ") return TYPES.mov;
  if (["M4A ", "M4B "].includes(brand.major)) return TYPES.m4a;
  return TYPES.mp4;
}

/** The first ZIP entry names, from the local file headers at the front of the archive. */
function zipEntryNames(buf, limit = 40) {
  const names = [];
  let at = 0;
  while (names.length < limit && at + 30 <= buf.length && startsWith(buf, [0x50, 0x4b, 0x03, 0x04], at)) {
    const compressed = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const extraLen = buf.readUInt16LE(at + 28);
    const flags = buf.readUInt16LE(at + 6);
    names.push(ascii(buf, at + 30, at + 30 + nameLen));
    // A streamed entry (bit 3) does not know its size up front; stop rather than guess.
    if (flags & 0x08) break;
    at += 30 + nameLen + extraLen + compressed;
  }
  return names;
}

function fromZip(buf) {
  const names = zipEntryNames(buf);
  if (names.some((n) => n.startsWith("word/"))) return TYPES.docx;
  if (names.some((n) => n.startsWith("xl/"))) return TYPES.xlsx;
  if (names.some((n) => n.startsWith("ppt/"))) return TYPES.pptx;
  // [Content_Types].xml first but the part folders later than the scan reached:
  // read the content types file name list cheaply from the raw bytes instead.
  const head = ascii(buf, 0, 64 * 1024);
  if (head.includes("word/document.xml")) return TYPES.docx;
  if (head.includes("xl/workbook.xml")) return TYPES.xlsx;
  if (head.includes("ppt/presentation.xml")) return TYPES.pptx;
  return TYPES.zip;
}

/** Text: valid UTF-8 (BOM allowed), no NUL bytes, few control characters. */
function looksLikeText(buf) {
  const sample = buf.subarray(0, Math.min(buf.length, 64 * 1024));
  if (sample.length === 0) return false;
  if (sample.includes(0)) return false;
  let control = 0;
  for (const b of sample) if (b < 0x09 || (b > 0x0d && b < 0x20)) control += 1;
  if (control > sample.length / 100) return false;
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(sample);
  return (decoded.match(/\uFFFD/g) || []).length <= 2;
}

function textKind(buf, name) {
  const head = buf.subarray(0, 2048).toString("utf8").replace(/^\uFEFF/, "").trimStart().toLowerCase();
  if (head.startsWith("<?xml")) return head.includes("<svg") ? TYPES.svg : TYPES.xml;
  if (head.startsWith("<svg")) return TYPES.svg;
  if (head.startsWith("<!doctype html") || head.startsWith("<html") || /<(script|iframe|body|head)\b/.test(head)) return TYPES.html;
  if (/\.csv$/i.test(String(name || ""))) return TYPES.csv;
  return TYPES.txt;
}

/**
 * @param {Buffer} buf
 * @param {string} [name]  the original file name; only used to tell CSV from text
 * @returns {{mime: string, ext: string, kind: string}}
 */
function sniff(buf, name = "") {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return UNKNOWN;
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return TYPES.pdf; // %PDF-
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return TYPES.png;
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return TYPES.jpeg;
  if (ascii(buf, 0, 6) === "GIF87a" || ascii(buf, 0, 6) === "GIF89a") return TYPES.gif;
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") return TYPES.webp;
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WAVE") return TYPES.wav;
  if (ascii(buf, 0, 4) === "OggS") return TYPES.ogg;
  if (ascii(buf, 0, 3) === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && (buf[1] & 0x06) !== 0)) return TYPES.mp3;
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) {
    // EBML: webm or matroska. A recording with no video track is audio.
    const head = ascii(buf, 0, 4096);
    if (!head.includes("webm")) return UNKNOWN;
    return head.includes("V_VP") || head.includes("V_AV1") || head.includes("V_MPEG") ? TYPES.webm : TYPES.webm_audio;
  }
  const brand = isoBrand(buf);
  if (brand) return fromIso(brand);
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) return fromZip(buf);
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return TYPES.ole;
  if (looksLikeText(buf)) return textKind(buf, name);
  return UNKNOWN;
}

/** The type for a known extension (serving a stored file whose type was sniffed when it arrived). */
function typeForExt(ext) {
  const e = String(ext || "").toLowerCase().replace(/^\./, "");
  return Object.values(TYPES).find((x) => x.ext === e && x.kind !== "markup") || UNKNOWN;
}

module.exports = { sniff, typeForExt, TYPES, UNKNOWN, zipEntryNames };
