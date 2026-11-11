"use strict";
/**
 * An SOP's draft, versions and steps as staff read them (docs/guides/knowledge.md §4, §6.3, §6.4):
 * pure, so the service, the AI reads and the unit tests share one copy.
 *
 *   screenOf("people/employees")   → { module, tab, label: "People · Employees" }, or null
 *   stepOut(row)                   a step as the contract's SopStep: its Markdown, its blocks, the
 *                                  screen's name (null when the key no longer resolves, §11)
 *   contentOf(version, steps)      what a version says, for the hash and "has it changed"
 *   hashOf(sop, content, n)        the canonical hash of what staff read in Version n
 */
const routeMap = require("../../shared/route-map");
const catalog = require("../../shared/access/access.catalog");
const screens = require("../../shared/search/screens");
const canonical = require("../../shared/documents/canonical");
const md = require("../../shared/documents/markdown");

const iso = (t) => (t ? new Date(t).toISOString() : null);

/** A route map screen by its key, `<module>/<tab>`, with its name as the hub shows it; null when it is none. */
function screenOf(key) {
  if (!key) return null;
  const [module, tab, extra] = String(key).split("/");
  if (extra !== undefined || !routeMap.SCREENS[module] || !routeMap.SCREENS[module].includes(tab)) return null;
  const s = screens.SCREENS.find((x) => x.module === module && x.tab === tab);
  const moduleLabel = (catalog.MODULE_META[module] || {}).label || module;
  return { module, tab, label: `${moduleLabel} · ${s ? s.label : tab}` };
}

/** A step row as the contract's SopStep. */
function stepOut(row) {
  const screen = screenOf(row.screen_key);
  return {
    position: Number(row.position),
    text: row.text,
    blocks: md.markdownToBlocks(row.text || ""),
    who: row.who || null,
    screen_key: row.screen_key || null,
    screen_label: screen ? screen.label : null,
    document_id: row.document_id || null,
    document_name: row.document_id ? row.document_name || "File" : null,
  };
}

/** What a version says: its fields and its steps in order, nothing about who or when. */
function contentOf(version, steps) {
  return {
    title: version.title,
    purpose: version.purpose || null,
    scope: version.scope || null,
    roles: [...(version.roles || [])],
    steps: steps.map((s) => ({ text: s.text, who: s.who || null, screen_key: s.screen_key || null, document_id: s.document_id || null })),
  };
}

/** Whether two versions say the same thing. */
const sameContent = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The canonical hash of what staff read in Version `n` of an SOP (shared/documents/canonical.js). */
function hashOf(sop, content, n) {
  return canonical.hash("SOP_VERSION", { number: sop.number, department_id: sop.department_id, version: n, ...content });
}

/** A published version row and its steps as the contract's SopVersion. */
function versionOut(sop, row, steps) {
  return {
    sop_version_id: row.sop_version_id,
    sop_id: row.sop_id,
    number: sop.number,
    department_id: sop.department_id,
    department_name: sop.department_name,
    version: Number(row.version),
    title: row.title,
    purpose: row.purpose || "",
    scope: row.scope || null,
    roles: row.roles || [],
    steps: steps.map(stepOut),
    note: row.note || null,
    published_at: iso(row.published_at),
    published_by_name: row.published_by_name || null,
    content_hash: row.content_hash,
  };
}

/** The draft as a writer edits it (SopDraft); `base` is the version in force's content, or null. */
function draftOut(row, steps, base) {
  return {
    sop_version_id: row.sop_version_id,
    title: row.title,
    purpose: row.purpose || null,
    scope: row.scope || null,
    roles: row.roles || [],
    steps: steps.map(stepOut),
    has_changes: !base || !sameContent(base, contentOf(row, steps)),
    updated_at: iso(row.updated_at),
    updated_by_name: row.updated_by_name || null,
  };
}

/** An SOP's state on the list: archived, published (a version in force) or a draft only. */
const stateOf = (status, version) => (status === "archived" ? "archived" : version ? "published" : "draft");

/** A list row as the contract's SopRow. */
const rowOut = (r) => ({
  sop_id: r.sop_id,
  number: r.number,
  title: r.title,
  department_id: r.department_id,
  department_name: r.department_name,
  state: stateOf(r.status, r.version),
  version: r.version === null || r.version === undefined ? null : Number(r.version),
  has_draft: Boolean(r.has_draft),
  updated_at: iso(r.updated_at),
});

module.exports = { screenOf, stepOut, contentOf, sameContent, hashOf, versionOut, draftOut, stateOf, rowOut, iso };
