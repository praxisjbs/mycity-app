"use strict";
/**
 * Citations: which records an answer rests on, from what was actually READ, never from
 * what the answer happens to say (MILESTONES §15: "every answer cites its source
 * records").
 *
 * A model asked to cite will do it often enough to look right and miss silently the
 * rest of the time, and matching record numbers in its prose tells you what it
 * mentioned, not what it read. The reads it ran are the ground truth: authorise.js
 * holds their rows, and each manifest read says how a row is cited (`cite(row)`).
 *
 *   citationsFor(read, rows)
 *   → [{ type: "employee", id: "…", label: "Ada Obi", link: "/people?tab=employees&id=…" }]
 *
 * The link comes from shared/route-map at the moment it is shown, never stored; a type
 * with no screen is cited without a link rather than with a broken one. Duplicates
 * (the same record read twice) are cited once.
 */
const routeMap = require("../route-map");

const LABEL_FIELDS = ["label", "number", "full_name", "name", "title", "ref"];

/** A person-readable name for a row, when the manifest's cite gives none. */
function labelOf(row) {
  if (!row || typeof row !== "object") return null;
  for (const f of LABEL_FIELDS)
    if (typeof row[f] === "string" && row[f].trim()) return row[f].trim();
  if (row.first_name || row.last_name)
    return `${row.first_name || ""} ${row.last_name || ""}`.trim();
  return null;
}

/**
 * @param {{key: string, cite: (row: object) => ({type: string, id: string, label?: string}|null)}} read
 * @param {object[]} rows
 * @returns {Array<{type: string, id: string, label: string|null, link: string|null, read: string}>}
 */
function citationsFor(read, rows) {
  const out = [];
  const seen = new Set();
  for (const row of rows || []) {
    const c = read.cite(row);
    if (!c || !c.type || c.id === undefined || c.id === null || c.id === "")
      continue;
    const id = String(c.id);
    const k = `${c.type}:${id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const link = routeMap.linkFor(c.type, id);
    out.push({
      type: c.type,
      id,
      label: c.label || labelOf(row),
      link: link ? link.path : null,
      read: read.key,
    });
  }
  return out;
}

/** Merge citation lists from several reads into one, first occurrence kept. */
function mergeCitations(lists) {
  const out = [];
  const seen = new Set();
  for (const c of lists.flat()) {
    const k = `${c.type}:${c.id}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(c);
    }
  }
  return out;
}

module.exports = { citationsFor, mergeCitations, labelOf };
