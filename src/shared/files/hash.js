"use strict";
/**
 * SHA-256 of stored bytes: the document's content_hash.
 *
 * Hash what was STORED, never what arrived. The image pipeline re-encodes a
 * photo; the hash must describe the bytes on disk, because M5's verification
 * compares a signed document's recorded hash with the file it reads back.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");

/** @param {Buffer} buffer @returns {string} 64 lowercase hex characters */
function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** Hash a file on disk without reading it whole (a long video). */
function sha256File(absPath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(absPath)
      .on("error", reject)
      .on("data", (chunk) => h.update(chunk))
      .on("end", () => resolve(h.digest("hex")));
  });
}

/** Constant-time comparison of two hex digests. */
function sameHash(a, b) {
  const x = Buffer.from(String(a || ""), "hex");
  const y = Buffer.from(String(b || ""), "hex");
  return x.length === 32 && y.length === 32 && crypto.timingSafeEqual(x, y);
}

module.exports = { sha256, sha256File, sameHash };
