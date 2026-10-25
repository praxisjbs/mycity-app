"use strict";
/**
 * Which row is the header, and which column is which field.
 *
 * Real sheets are not tidy: a title and a date sit above the header, a column is
 * "Staff No." one month and "Employee ID" the next. So:
 *
 *  - detectHeaderRow() looks at the first 20 rows and picks the one whose cells match
 *    the most field labels and aliases (at least two), so "MyCity Staff List, October"
 *    above the header is skipped.
 *  - autoMap() matches each header cell to a field by its normalised key or label first,
 *    across the whole header, then by an alias for the columns still unmatched. Each field
 *    is used once; a column nobody recognises is left unmapped and shown to the person to
 *    choose. So "Designation" takes the job title even when a "Title" (Mr, Mrs) column
 *    comes before it, and "Work Email" wins over a personal "Email" to its left.
 *  - A mapping a person confirmed is saved as a profile keyed by the header signature
 *    (the set of normalised headers), so next month's sheet with the same columns maps
 *    itself, and a renamed column is mapped once and remembered.
 *
 * A mapping is stored as { columns: [{ index, header, field }] }, field null when the
 * column is ignored.
 *
 * Table (migration 0085; BACKEND_STRUCTURE §11.1):
 *   import_mapping_profile  import_mapping_profile_id, importer_key, name, header_signature,
 *                           mapping jsonb, created_by, last_used_at;
 *                           UNIQUE (importer_key, header_signature)
 */
const crypto = require("node:crypto");

const SCAN_ROWS = 20;

/** "Staff No." → "staff no"; accents folded, punctuation to spaces. */
function normalise(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Every normalised spelling that names a field. */
function namesOf(field) {
  return new Set(
    [field.key, field.label, ...(field.aliases || [])]
      .map(normalise)
      .filter(Boolean),
  );
}

/**
 * @param {Array<Array<*>>} rows  the sheet grid
 * @param {object[]} fields
 * @returns {number|null} 0-based index of the header row, or null when none is found
 */
function detectHeaderRow(rows, fields) {
  const names = fields.map(namesOf);
  let best = null;
  let bestScore = 1;
  rows.slice(0, SCAN_ROWS).forEach((row, i) => {
    const used = new Set();
    let score = 0;
    for (const cell of row || []) {
      const n = normalise(cell);
      if (!n) continue;
      const hit = names.findIndex((set, fi) => !used.has(fi) && set.has(n));
      if (hit >= 0) {
        used.add(hit);
        score += 1;
      }
    }
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

/**
 * @param {Array<*>} headerCells
 * @param {object[]} fields
 * @returns {{columns: Array<{index: number, header: string, field: string|null}>}}
 */
function autoMap(headerCells, fields) {
  const used = new Set();
  const cells = (headerCells || []).map(normalise);
  const chosen = new Array(cells.length).fill(null);
  const own = (f) => new Set([f.key, f.label].map(normalise).filter(Boolean));
  for (const pass of [own, namesOf]) {
    cells.forEach((n, index) => {
      if (!n || chosen[index]) return;
      const field = fields.find((f) => !used.has(f.key) && pass(f).has(n));
      if (!field) return;
      used.add(field.key);
      chosen[index] = field.key;
    });
  }
  const columns = (headerCells || []).map((cell, index) => ({
    index,
    header: cell === null || cell === undefined ? "" : String(cell),
    field: chosen[index],
  }));
  return { columns };
}

/** The set of normalised headers, order-free, hashed. */
function headerSignature(headerCells) {
  const set = [
    ...new Set((headerCells || []).map(normalise).filter(Boolean)),
  ].sort();
  return crypto
    .createHash("sha256")
    .update(set.join("|"))
    .digest("hex")
    .slice(0, 32);
}

/**
 * Problems with a mapping, as sentences: a field mapped twice, an unknown field, a
 * required field with no column.
 */
function problemsOf(mapping, fields) {
  const out = [];
  const keys = new Set(fields.map((f) => f.key));
  const seen = new Map();
  for (const c of (mapping && mapping.columns) || []) {
    if (!c.field) continue;
    if (!keys.has(c.field))
      out.push(
        `"${c.header}" is mapped to "${c.field}", which this import does not have`,
      );
    else if (seen.has(c.field))
      out.push(
        `"${c.header}" and "${seen.get(c.field)}" are both mapped to ${fields.find((f) => f.key === c.field).label}`,
      );
    else seen.set(c.field, c.header);
  }
  for (const f of fields)
    if (f.required && !seen.has(f.key))
      out.push(`No column is mapped to ${f.label}, which is required`);
  return out;
}

/** The saved mapping for this header signature, or null. */
async function findProfile(client, importerKey, signature) {
  const { rows } = await client.query(
    "SELECT mapping FROM import_mapping_profile WHERE importer_key = $1 AND header_signature = $2",
    [importerKey, signature],
  );
  return rows[0] ? rows[0].mapping : null;
}

/** Remember a confirmed mapping (upsert by signature). */
async function saveProfile(
  client,
  { importer_key: key, name, signature, mapping, user_id: userId },
) {
  await client.query(
    `INSERT INTO import_mapping_profile (importer_key, name, header_signature, mapping, created_by, last_used_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, now())
     ON CONFLICT (importer_key, header_signature)
     DO UPDATE SET mapping = EXCLUDED.mapping, name = EXCLUDED.name, last_used_at = now()`,
    [
      key,
      name || "Saved mapping",
      signature,
      JSON.stringify(mapping),
      userId || null,
    ],
  );
}

/** Apply a saved mapping to this file's header cells (columns may have moved). */
function applyProfile(profile, headerCells) {
  const byHeader = new Map(
    (profile.columns || [])
      .filter((c) => c.field)
      .map((c) => [normalise(c.header), c.field]),
  );
  return {
    columns: (headerCells || []).map((cell, index) => ({
      index,
      header: cell === null || cell === undefined ? "" : String(cell),
      field: byHeader.get(normalise(cell)) || null,
    })),
  };
}

module.exports = {
  normalise,
  detectHeaderRow,
  autoMap,
  headerSignature,
  problemsOf,
  findProfile,
  saveProfile,
  applyProfile,
  SCAN_ROWS,
};
