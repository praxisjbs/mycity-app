"use strict";
/**
 * The policy types the code knows (docs/guides/policies.md §6.1). A written document is built in; a
 * rules type is registered by the module that enforces it (attendance.policy-type.js), with:
 *
 *   title         the policy's name, the one policy of that type ("Attendance Policy")
 *   read          the contract schema a version's stored rules are parsed with (defaults filled)
 *   draft         the stricter schema a draft is saved with
 *   suggestions   the rules a first draft starts from: the code's, never seeded (A26)
 *   sections      (rules, changed) => the sections and sentences staff read
 *   changed       (before, after) => the rule keys `after` changes
 *   changeLines   (before, after) => those changes as lines a person reads
 *
 * One registry, so the screen, the PDF, search and Praxis AI read the same words.
 */
const { AppError } = require("../../shared/errors");

const TYPES = new Map();

/**
 * @param {string} kind  a value of the contract's PolicyKind other than `document`
 * @param {object} spec
 */
function register(kind, spec) {
  for (const key of ["title", "read", "draft", "suggestions", "sections", "changed", "changeLines"])
    if (!spec[key]) throw new Error(`policies.types: "${kind}" has no ${key}`);
  TYPES.set(kind, Object.freeze({ kind, ...spec }));
}

/** The spec of a rules type, or null for a written document. */
function typeOf(kind) {
  if (kind === "document") return null;
  const spec = TYPES.get(kind);
  if (!spec) throw new AppError("UNKNOWN_POLICY_TYPE", `No policy type "${kind}"`, 500);
  return spec;
}

/** The rules types registered, in the order they were. */
const rulesKinds = () => [...TYPES.keys()];

module.exports = { register, typeOf, rulesKinds };
