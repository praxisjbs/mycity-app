"use strict";
/**
 * Canonical signature payloads (M5 e-signature, A12).
 *
 * THIS IS THE FILE EVERY SIGNATURE RESTS ON. Read the warning below before
 * changing anything in it.
 *
 * What a canonical payload is
 * ---------------------------
 * A versioned struct holding ONLY the contract-relevant fields of a document:
 * the figures, parties and references a signature actually attests to. It is
 * hashed at signing time and recomputed from the live record on every later
 * read. A mismatch means the document changed after somebody signed it.
 *
 * A signed document carries two hashes (REUSE_MAP §6):
 *   content_hash   over this payload: recomputable, "this says the same thing"
 *   artifact_hash  over the stored PDF bytes (document.content_hash): frozen,
 *                  "these are the same bytes"
 * The verification page reports both verdicts.
 *
 * Why not just hash the PDF
 * -------------------------
 * Because the QR carrying the hash has to be INSIDE the PDF. Hashing rendered
 * bytes is circular. A hash over business data is known BEFORE rendering, so it
 * can be printed on the page, and it can be recomputed years later, which
 * rendered bytes cannot (Chromium stamps /CreationDate, so no two renders match).
 *
 * The input shape
 * ---------------
 * Builders take the data the document is RENDERED from (documents/generate.js
 * `data` for the same doc type), so the hash covers what is on the page a person
 * signed, not a parallel projection of the record that could drift away from it.
 *
 * MUST NOT edit a field name, drop a field, or reorder keys in an existing
 * builder. Every signature ever issued against that doc type would stop
 * verifying at once: the recomputed hash would match no stored one, and every
 * signed document would read as amended.
 *
 * TO CHANGE A PAYLOAD: add a new branch under a bumped `v`, keep the old branch
 * reachable, and pin a golden fixture for the new version. `hash()` dispatches on
 * the version stored on the signature row, never on "whatever the code does today".
 * The unit test pins one fixed input per doc type to a literal sha256; it is the
 * only thing standing between a routine refactor and every signature going stale.
 *
 * Money is a two-place string ("1250000.00"), never a JS number (gate 20).
 */
const crypto = require("node:crypto");
const { AppError } = require("../errors");
const m = require("../money/money");

/**
 * Normalisation is part of the contract, applied INSIDE the builders: "1200",
 * 1200 and "1200.004" must hash identically, or a signature would go stale on a
 * rounding artefact nobody can see.
 */
const str = (v) => (v === null || v === undefined ? "" : String(v));
const money = (v) => {
  if (v === null || v === undefined || v === "") return "0.00";
  try {
    return m.toWire(v);
  } catch {
    return "0.00";
  }
};
const int = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? n : 0;
};

// One builder per doc type. Key order below is the hashed order: JSON.stringify
// preserves insertion order for string keys, and these objects are built from
// literals, so the order is fixed by the source, not by a runtime sort. (A sort
// would be MORE fragile: it would silently re-order if a key were renamed.)

/**
 * LOOKED UP THROUGH A Map, NEVER BY PROPERTY ACCESS. `docType` arrives from a
 * request body. With a plain object, BUILDERS["constructor"] resolves to
 * `Object`, truthy AND callable, so a guard of `if (!builder) throw` passes and
 * hash("constructor", {}) returns a real-looking sha256 for a document type that
 * does not exist. A Map has no prototype chain to walk; `get` returns undefined
 * for anything not registered. The literal below is the readable source of
 * truth; the Map is the lookup.
 *
 * Builders are added here as their modules land (M5 offer letter and contract,
 * M7 MOU, M8 requisition). Each one says what it attests to and what it
 * deliberately leaves out.
 */
const BUILDER_SOURCE = Object.assign(Object.create(null), {
  /**
   * Employment terms. The most sensitive payload: an edited salary on a signed
   * contract must invalidate the signature, loudly and immediately. `clauses`
   * carries clause HEADINGS only: the public verification page shows them, and
   * clause bodies are not for a stranger holding a scan.
   */
  EMPLOYMENT_CONTRACT: (d) => ({
    v: 1,
    type: "EMPLOYMENT_CONTRACT",
    number: str(d.number),
    date: str(d.date),
    employee: str(d.employee || (d.party && d.party.name)),
    job_title: str(d.job_title),
    contract_type: str(d.contract_type),
    start_date: str(d.start_date),
    end_date: str(d.end_date),
    currency: str(d.currency || m.CURRENCY),
    gross_salary: money(d.gross_salary),
    probation_months: int(d.probation_months),
    clauses: (Array.isArray(d.clauses) ? d.clauses : []).map((c) =>
      str(c && c.heading ? c.heading : c),
    ),
  }),
});

/** The only thing anything looks a builder up in. Insertion order preserved. */
const BUILDERS = new Map(Object.entries(BUILDER_SOURCE));

/** Doc types that can be signed at all. */
const SIGNABLE = Object.freeze([...BUILDERS.keys()]);

const isSignable = (docType) =>
  typeof docType === "string" && BUILDERS.has(docType);

/**
 * Build the canonical payload for a doc type.
 *
 * `version` exists so a signature stored under v1 keeps verifying after a v2 is
 * introduced: pass the version from the signature row, not the current one.
 */
function canonical(docType, doc, version = 1) {
  // Map.get, inline: not a property read, and not behind a helper.
  const builder =
    typeof docType === "string" ? BUILDERS.get(docType) : undefined;
  if (typeof builder !== "function") {
    throw new AppError(
      "NO_CANONICAL_PAYLOAD",
      `'${docType}' has no canonical signature payload. Register one in shared/documents/canonical.js.`,
      422,
      { doc_type: [`signable types: ${SIGNABLE.join(", ") || "none"}`] },
    );
  }
  if (Number(version) !== 1) {
    throw new AppError(
      "UNKNOWN_PAYLOAD_VERSION",
      `Signature payload version ${version} is not implemented for '${docType}'.`,
      422,
    );
  }
  return builder(doc || {});
}

const digest = (payload) =>
  crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");

/** sha256 hex of the canonical payload. */
function hash(docType, doc, version = 1) {
  return digest(canonical(docType, doc, version));
}

/** Both at once: the shape the signing service wants. */
function build(docType, doc, version = 1) {
  const payload = canonical(docType, doc, version);
  return { payload, hash: digest(payload), version: 1 };
}

/**
 * Field-level diff between the payload as signed and the payload now. Feeds the
 * verification page's "signed, then modified" panel, which shows WHAT changed.
 * Arrays are compared whole: "line 3 of 7 changed" is not a claim worth making
 * when a line may also have been inserted.
 */
function diff(before = {}, after = {}) {
  const out = [];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  for (const key of keys) {
    if (key === "v" || key === "type") continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      out.push({
        field: key,
        before: before[key] ?? null,
        after: after[key] ?? null,
      });
    }
  }
  return out;
}

module.exports = {
  canonical,
  hash,
  build,
  diff,
  isSignable,
  SIGNABLE,
  BUILDERS,
};
