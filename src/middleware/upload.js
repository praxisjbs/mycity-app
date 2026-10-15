"use strict";
/**
 * Receive a file. Multipart only, held in memory, never written to disk here.
 *
 *   route(router, "post", "/:id/documents", contract,
 *     requirePermission("people", "edit"),
 *     upload.single("file", { purpose: "document" }),
 *     controller.addDocument);
 *
 *   // controller
 *   const file = readUpload(req);   // { buffer, originalname, size, purpose }
 *
 * What happens next is the vault's job (shared/documents/vault.js): the type is
 * read from the bytes (shared/files/sniff.js), checked against the purpose's
 * allow-list, named by uuid, run through the image or audio/video pipeline,
 * hashed as stored, and recorded. This file only gets the bytes in safely:
 *
 *  - multer's hard cap (25 MB) and one file per field, then the purpose's own cap;
 *  - the browser's Content-Type and file name are kept for display only and are
 *    never trusted for the type;
 *  - multer errors become readable AppErrors (413 with the limit in words);
 *  - there is no base64-in-JSON path; files are multipart only.
 */
const multer = require("multer");
const { AppError } = require("../shared/errors");
const {
  UPLOAD_HARD_CAP,
  UPLOAD_CAPS,
  describeBytes,
} = require("../shared/http/body-limits");

const memory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_HARD_CAP, files: 10, fields: 30, parts: 40 },
});

function tooLarge(limit) {
  return new AppError(
    "FILE_TOO_LARGE",
    `That file is larger than ${describeBytes(limit)}. Choose a smaller file.`,
    413,
  );
}

function translate(err) {
  if (!err) return null;
  if (err.code === "LIMIT_FILE_SIZE") return tooLarge(UPLOAD_HARD_CAP);
  if (err.code === "LIMIT_UNEXPECTED_FILE" || err.code === "LIMIT_FILE_COUNT") {
    return new AppError(
      "UNEXPECTED_FILE",
      "This upload has a file where none was expected",
      400,
    );
  }
  if (err.code && String(err.code).startsWith("LIMIT_")) {
    return new AppError("UPLOAD_REJECTED", "This upload is malformed", 400);
  }
  return err;
}

function capFor(purpose) {
  const cap = UPLOAD_CAPS[purpose];
  if (!cap)
    throw new Error(
      `upload: unknown purpose "${purpose}" (shared/http/body-limits.js UPLOAD_CAPS)`,
    );
  return cap;
}

function checkSizes(files, cap) {
  for (const f of files) if (f.size > cap) throw tooLarge(cap);
}

/**
 * One file from `field`.
 * @param {string} field
 * @param {{purpose: string, required?: boolean}} opts
 */
function single(field, { purpose, required = true }) {
  const cap = capFor(purpose);
  const handler = memory.single(field);
  return function uploadSingle(req, res, next) {
    handler(req, res, (err) => {
      const e = translate(err);
      if (e) return next(e);
      try {
        if (!req.file && required)
          throw new AppError("FILE_REQUIRED", "Choose a file to upload", 422, {
            [field]: ["is required"],
          });
        if (req.file) checkSizes([req.file], cap);
        req.upload_purpose = purpose;
        return next();
      } catch (checkErr) {
        return next(checkErr);
      }
    });
  };
}

/**
 * Up to `max` files from `field` (a chat message with several attachments).
 * @param {string} field
 * @param {{purpose: string, max?: number}} opts
 */
function array(field, { purpose, max = 5 }) {
  const cap = capFor(purpose);
  const handler = memory.array(field, max);
  return function uploadArray(req, res, next) {
    handler(req, res, (err) => {
      const e = translate(err);
      if (e) return next(e);
      try {
        checkSizes(req.files || [], cap);
        req.upload_purpose = purpose;
        return next();
      } catch (checkErr) {
        return next(checkErr);
      }
    });
  };
}

const toUpload = (f, purpose) => ({
  buffer: f.buffer,
  size: f.size,
  originalname: f.originalname || "upload",
  declared_type: f.mimetype || null,
  purpose,
});

/**
 * The file a single() upload received, or null.
 * @returns {{buffer: Buffer, size: number, originalname: string, declared_type: string|null, purpose: string}|null}
 */
function readUpload(req) {
  return req.file && Buffer.isBuffer(req.file.buffer)
    ? toUpload(req.file, req.upload_purpose)
    : null;
}

/** The files an array() upload received. */
function readUploads(req) {
  return (req.files || [])
    .filter((f) => Buffer.isBuffer(f.buffer))
    .map((f) => toUpload(f, req.upload_purpose));
}

module.exports = { single, array, readUpload, readUploads };
