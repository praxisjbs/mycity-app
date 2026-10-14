"use strict";
/**
 * Every size limit a request meets, in one place, in the order it meets them
 * (BACKEND_STRUCTURE §5.2). The "works locally, fails live with a 413" bug is
 * always two of these disagreeing; written together, they cannot drift.
 *
 *   1. proxy        client_max_body_size 30m        hosting panel, docs/runbooks/proxy.md
 *   2. JSON body    JSON_LIMIT (1 MB)               express.json() in app.js
 *   3. multipart    UPLOAD_HARD_CAP (25 MB)         multer in middleware/upload.js
 *   4. per purpose  UPLOAD_CAPS[purpose]            middleware/upload.js, after multer
 *
 * The proxy cap sits above the hard cap so an oversized file is refused by Node
 * with a readable message, not by the proxy with an HTML 413 page.
 *
 * Files only ever arrive as multipart. There is no base64-in-JSON path, which is
 * why the JSON limit can stay small and needs no per-route exceptions.
 */
const MB = 1024 * 1024;

/** Documented here; set in the hosting panel. Must stay above UPLOAD_HARD_CAP. */
const PROXY_BODY_CAP = "30m";

const JSON_LIMIT = "1mb";

const UPLOAD_HARD_CAP = 25 * MB;

/**
 * Per purpose. A purpose names what the file is for; shared/files/mime-policy.js
 * keys its allow-list by the same names.
 */
const UPLOAD_CAPS = Object.freeze({
  avatar: 5 * MB,
  photo: 10 * MB,
  document: 15 * MB,
  voice_note: 10 * MB,
  video: 25 * MB,
  attachment: 25 * MB,
  import_sheet: 10 * MB,
  signature: 2 * MB,
});

/** "15 MB", for messages people read. */
function describeBytes(bytes) {
  return bytes >= MB ? `${Math.round(bytes / MB)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

module.exports = { PROXY_BODY_CAP, JSON_LIMIT, UPLOAD_HARD_CAP, UPLOAD_CAPS, describeBytes, MB };
