"use strict";
/**
 * Document types: the single source of truth for every `doc_type` a document is
 * stored under (vault.store, documents.generate).
 *
 * Why a registry and not free strings: the doc type is also the key a template
 * and a signature payload are found by. Passed as a hand-written literal, a typo
 * silently severs a document from its template, its signature rules and its
 * reader, with nothing to catch it. So vault.store() refuses a doc type nobody
 * registered (422 UNKNOWN_DOC_TYPE), at the first upload in development.
 *
 * A module registers its types where it defines its events:
 *
 *   defineDocumentType("query_letter", {
 *     label: "Query letter",
 *     module: "queries",          // whose `view` grant governs READING it
 *     sensitivity: "personal",    // the default when store() is not told
 *     signable: true,             // may be e-signed at all (M5)
 *     wet: false,                 // may be printed and signed in ink
 *   });
 *
 * `module` decides who may open the file: reading follows the module that owns
 * the document, never a Settings grant. Leave it out and reading follows the
 * record the document is attached to (its entity type's module in the route
 * map). An unknown module never falls back to Settings; it reads as "no grant".
 *
 * The signature CEILING (signable, wet) is code, deliberately: a setting may
 * narrow it but never widen it. Anything not marked signable is NOT signable,
 * the conservative default: a new doc type appearing in a signing menu because
 * somebody forgot to think about it is the failure this table exists to prevent.
 * There is no third-party certification tier (REUSE_MAP §6: canvas, hash and a
 * public verification page only).
 *
 * Looked up through a Map: `docType` reaches this file from request bodies, and
 * a plain object would resolve "constructor" to a function.
 */
const { AppError } = require("../errors");

const DOC_TYPE_RE = /^[a-z][a-z0-9_]{1,63}$/;
const MODULE_RE = /^[a-z][a-z0-9_]*$/;
const SENSITIVITIES = new Set(["normal", "personal", "restricted"]);

/** doc_type → frozen spec */
const TYPES = new Map();

/**
 * @param {string} docType  snake_case
 * @param {{label: string, module?: string|null, sensitivity?: "normal"|"personal"|"restricted",
 *          signable?: boolean, wet?: boolean}} spec
 */
function defineDocumentType(docType, spec) {
  if (!DOC_TYPE_RE.test(String(docType || "")))
    throw new Error(`defineDocumentType: "${docType}" is snake_case`);
  if (!spec || typeof spec.label !== "string" || !spec.label.trim())
    throw new Error(`defineDocumentType(${docType}): label is required`);
  if (
    spec.module !== undefined &&
    spec.module !== null &&
    !MODULE_RE.test(String(spec.module))
  )
    throw new Error(`defineDocumentType(${docType}): module is a module key`);
  if (spec.sensitivity && !SENSITIVITIES.has(spec.sensitivity))
    throw new Error(
      `defineDocumentType(${docType}): sensitivity is normal, personal or restricted`,
    );
  if (spec.wet && !spec.signable)
    throw new Error(
      `defineDocumentType(${docType}): wet signing needs signable`,
    );
  const frozen = Object.freeze({
    doc_type: docType,
    label: spec.label.trim(),
    module: spec.module || null,
    sensitivity: spec.sensitivity || "normal",
    signable: spec.signable === true,
    wet: spec.wet === true,
  });
  const existing = TYPES.get(docType);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(frozen))
      throw new Error(
        `defineDocumentType: ${docType} is already defined differently`,
      );
    return existing;
  }
  TYPES.set(docType, frozen);
  return frozen;
}

/** The registered spec, or null. */
function typeOf(docType) {
  return (typeof docType === "string" && TYPES.get(docType)) || null;
}

/** The registered spec, or 422 UNKNOWN_DOC_TYPE. */
function assertDocType(docType) {
  const spec = typeOf(docType);
  if (!spec) {
    throw new AppError(
      "UNKNOWN_DOC_TYPE",
      `"${docType}" is not a registered document type`,
      422,
      {
        doc_type: [
          "register it with defineDocumentType() in the owning module",
        ],
      },
    );
  }
  return spec;
}

const NOT_SIGNABLE = Object.freeze({ signable: false, wet: false });

/** What signing a doc type may ever allow. Unregistered or unmarked: nothing. */
function signatureCeiling(docType) {
  const spec = typeOf(docType);
  return spec ? { signable: spec.signable, wet: spec.wet } : NOT_SIGNABLE;
}

/** Every registered type, for the Settings template screen and the docs. */
function all() {
  return [...TYPES.values()];
}

/* The types the shared layer itself stores. */
defineDocumentType("import_source", {
  label: "Imported spreadsheet",
  sensitivity: "restricted",
});

module.exports = {
  defineDocumentType,
  typeOf,
  assertDocType,
  signatureCeiling,
  all,
};
