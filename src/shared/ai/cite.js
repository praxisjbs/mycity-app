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

/**
 * Each row's record, in the rows' own order: { type, id } or null where `cite` names none. Unlike
 * citationsFor nothing is merged, so row i of an answer's table opens refs[i].
 * @returns {Array<{type: string, id: string}|null>}
 */
function refsFor(read, rows) {
  return (rows || []).map((row) => {
    const c = read && typeof read.cite === "function" ? read.cite(row) : null;
    if (!c || !c.type || c.id === undefined || c.id === null || c.id === "") return null;
    return { type: c.type, id: String(c.id) };
  });
}

/** A record's link when shown, from its ref: null for none, or a type with no screen. */
function linkOfRef(ref) {
  if (!ref || !ref.type) return null;
  const link = routeMap.linkFor(ref.type, ref.id);
  return link ? link.path : null;
}

/** Record types whose own words read badly as a source ("home kpi"): the name From shows instead. */
const TYPE_NAMES = Object.freeze({
  home_alert: "alert",
  home_report: "report",
  home_report_run: "report run",
  home_kpi: "Home figure",
  attendance_pay_item: "deduction or overtime",
  attendance_temporary_site: "temporary site",
  policy_version: "policy",
  import_batch: "import",
});

/** A record type as From names it (§1.1 decision 9): "interaction log" for `interaction_log`. */
function typeLabel(type) {
  if (!type) return "record";
  return TYPE_NAMES[type] || String(type).replace(/_/g, " ");
}

/**
 * What an answer's From shows (decision 9): one entry per record type in the order first cited,
 * with its count; or, when the answer rests on one record, that record, named and linked.
 * @param {Array<{entity_type: string, count: number}>} groups  the answer's citations by type
 * @param {{entity_type: string, label: string|null, link: string|null}|null} only  the one citation, when there is one
 */
function sourcesOf(groups, only) {
  const total = groups.reduce((n, g) => n + g.count, 0);
  if (total === 1 && only)
    return [{ kind: "record", entity_type: only.entity_type, label: only.label || typeLabel(only.entity_type), count: 1, link: only.link || null }];
  return groups.map((g) => ({ kind: "type", entity_type: g.entity_type, label: typeLabel(g.entity_type), count: g.count, link: null }));
}

module.exports = { citationsFor, mergeCitations, labelOf, refsFor, linkOfRef, typeLabel, sourcesOf, TYPE_NAMES };
