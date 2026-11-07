"use strict";
/**
 * The signature certificate a sealed copy carries (docs/guides/partnerships.md §6.9 step 7): one
 * entry a signer, with the evidence their row keeps. A signable's template prints it after the
 * document, so the certificate and the document are the same PDF and the same artifact hash.
 *
 * Times are Lagos, day-first, as a person reads them; the address is masked; the content hash is
 * printed whole, so anyone can recompute it from the record.
 */
const dayFirst = require("../../shared/time/day-first");
const { maskEmail } = require("./signatures.code");

const METHOD = Object.freeze({ draw: "Drawn", type: "Typed", paper: "Signed on paper" });

/** "Mozilla/5.0 (iPhone; ...)" → "iPhone, Safari": what a person can tell a device by. */
function deviceOf(agent) {
  const a = String(agent || "");
  if (!a) return null;
  const os = /iPhone|iPad/.test(a) ? "iPhone or iPad" : /Android/.test(a) ? "Android" : /Windows/.test(a) ? "Windows" : /Mac OS X/.test(a) ? "Mac" : /Linux/.test(a) ? "Linux" : "Other";
  const browser = /Edg\//.test(a) ? "Edge" : /Chrome\//.test(a) ? "Chrome" : /Firefox\//.test(a) ? "Firefox" : /Safari\//.test(a) ? "Safari" : "Browser";
  return `${os}, ${browser}`;
}

/**
 * The certificate's rows, in signing order.
 * @param {object[]} signatures  signature rows (signatures.repo signaturesOf)
 * @param {Map<string, string>} [images]  signature_document_id → PNG data URL, to print beside each
 */
function rows(signatures, images = new Map()) {
  return signatures
    .filter((s) => s.status === "signed")
    .map((s) => {
      const ev = s.evidence || {};
      return {
        name: s.signer_name,
        title: s.signer_title || null,
        email: maskEmail(s.signer_email),
        method: METHOD[s.method] || s.method,
        signed_at: dayFirst.formatDateTime(s.signed_at),
        code_verified_at: ev.code_verified_at ? dayFirst.formatDateTime(ev.code_verified_at) : null,
        ip: ev.ip || null,
        device: deviceOf(ev.user_agent),
        content_hash: s.content_hash,
        signature: s.signature_document_id ? images.get(s.signature_document_id) || null : null,
        typed: ev.typed || null,
      };
    });
}

module.exports = { rows, deviceOf, METHOD };
