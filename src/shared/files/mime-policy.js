"use strict";
/**
 * What each upload purpose accepts. The allow-list is the security boundary: a
 * type that is not listed for a purpose is refused, whatever its extension says.
 *
 * Never accepted anywhere: HTML, SVG, XML, scripts, archives, old binary Office
 * files. A file the app stores is later served from the app's own origin, and an
 * HTML or SVG file served from there runs as the app. Old .doc/.xls files are
 * refused with a message asking for the modern format, because they cannot be
 * read safely and the staff sheet must be .xlsx or .csv (BACKEND_STRUCTURE §9.2).
 *
 * Purposes are the same names as the size caps in shared/http/body-limits.js, so a
 * purpose cannot have a size and no type list, or the reverse (checked at load).
 */
const { AppError } = require("../errors");
const { UPLOAD_CAPS } = require("../http/body-limits");
const { TYPES } = require("./sniff");

const IMAGES = [TYPES.jpeg, TYPES.png, TYPES.webp, TYPES.heic];
const AUDIO = [
  TYPES.webm_audio,
  TYPES.ogg,
  TYPES.m4a,
  TYPES.mp3,
  TYPES.wav,
  TYPES.mp4,
];
const VIDEO = [TYPES.mp4, TYPES.mov, TYPES.webm];

const ALLOW = Object.freeze({
  avatar: [...IMAGES],
  photo: [...IMAGES, TYPES.avif],
  document: [TYPES.pdf, ...IMAGES, TYPES.docx, TYPES.xlsx],
  voice_note: AUDIO,
  video: VIDEO,
  attachment: [
    TYPES.pdf,
    ...IMAGES,
    TYPES.gif,
    TYPES.docx,
    TYPES.xlsx,
    TYPES.pptx,
    TYPES.csv,
    TYPES.txt,
    ...AUDIO,
    ...VIDEO,
  ],
  import_sheet: [TYPES.xlsx, TYPES.csv],
  signature: [TYPES.png],
  brand: [TYPES.png, TYPES.webp],
  performance_evidence: [TYPES.pdf, ...IMAGES, TYPES.docx, TYPES.xlsx, TYPES.pptx, TYPES.csv],
});

const NEVER = new Set(["markup", "archive", "unknown"]);

for (const purpose of new Set([
  ...Object.keys(ALLOW),
  ...Object.keys(UPLOAD_CAPS),
])) {
  if (!ALLOW[purpose] || !UPLOAD_CAPS[purpose]) {
    throw new Error(
      `mime-policy: purpose "${purpose}" needs both a type list here and a size cap in body-limits.js`,
    );
  }
}

/** "PDF, JPG, PNG" for a message a person reads. */
function describe(purpose) {
  return [...new Set(ALLOW[purpose].map((x) => x.ext.toUpperCase()))].join(
    ", ",
  );
}

/**
 * Refuse a sniffed type the purpose does not accept.
 * @param {string} purpose
 * @param {{mime: string, ext: string, kind: string}} type  from sniff()
 * @returns the type, when accepted
 */
function assertAllowed(purpose, type) {
  const list = ALLOW[purpose];
  if (!list) throw new Error(`mime-policy: unknown purpose "${purpose}"`);
  if (type.kind === "legacy_office") {
    throw new AppError(
      "FILE_TYPE_REFUSED",
      "This is an old Office file. Save it as .docx or .xlsx and upload it again.",
      415,
    );
  }
  const accepted =
    !NEVER.has(type.kind) && list.some((x) => x.mime === type.mime);
  if (!accepted) {
    throw new AppError(
      "FILE_TYPE_REFUSED",
      `This file type is not accepted here. Accepted: ${describe(purpose)}.`,
      415,
    );
  }
  return type;
}

/**
 * The Content-Type a stored file is SERVED with. Only a type some purpose accepts
 * goes out as itself; anything else (a row written before a policy change, a
 * mistake in a migration) goes out as application/octet-stream, which no browser
 * renders or runs in place. Preview code decides what to DISPLAY from this, so
 * widening an ALLOW list above widens what a preview frames: add a type with that
 * in mind.
 */
const SERVABLE = new Set(
  Object.values(ALLOW)
    .flat()
    .map((x) => x.mime),
);
const FALLBACK_TYPE = "application/octet-stream";
const servedType = (mime) =>
  SERVABLE.has(String(mime || "")) ? mime : FALLBACK_TYPE;

const isAllowed = (purpose, type) =>
  Boolean(ALLOW[purpose]) &&
  !NEVER.has(type.kind) &&
  ALLOW[purpose].some((x) => x.mime === type.mime);

module.exports = {
  ALLOW,
  assertAllowed,
  isAllowed,
  describe,
  servedType,
  FALLBACK_TYPE,
};
