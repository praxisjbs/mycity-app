"use strict";
/**
 * The wording of a category's agreement templates, on the one document engine (shared/templates,
 * `template_version`): what a template may name, how the editor's HTML becomes the Markdown that is
 * kept, and how a saved version is read back for the editor (docs/guides/partnerships.md §6.8).
 *
 *   A template's wording is Markdown (headings, numbered clauses, pipe tables) with named fields in
 *   `{{ }}`: a record field (`partner.name`), a custom field of the category (`custom.ticketing`) or an ask
 *   of the template (`ask.opening_hours`). The editor draws each as a chip, so a person never types
 *   braces; a name that is none of the three is refused when the wording is saved, naming it.
 *
 * Letters (queries.md §6.7) stay as they are: their module declares its own variables and keeps its own
 * routes. Nothing here touches a letter.
 */
const c = require("@mycity/contract");
const { AppError } = require("../../shared/errors");
const md = require("../../shared/documents/markdown");
const { parse, variablesOf, TemplateError } = require("../../shared/documents/render");
const store = require("../../shared/templates/template-store");
const { defineVariables } = require("../../shared/templates/variables");

const KIND = "document";
const RECORD_FIELDS = c.partner_pipeline.AGREEMENT_RECORD_FIELDS;

/** Let an agreement template's key fill from the one agreement schema. Safe to call again. */
function declare(key) {
  defineVariables(KIND, key, c.agreements.AgreementVars);
}

/** The house format a value of this type is written with (shared/documents/render.js HELPERS). */
const HELPER_OF = Object.freeze({ date: "longdate", money: "money", number: "number" });

/** How a custom field's type reads as a template value. */
const TYPE_OF = Object.freeze({ money: "money", number: "number", date: "date" });

/**
 * Every name a template of one category may use, by path: the record fields, the category's custom fields
 * and the template's own asks. `custom` rows are `partnership_field` rows; `asks` are `TemplateAsk`s.
 * @returns {Map<string, {field: string, label: string, type: string, source: string}>}
 */
function catalogOf(customFields, asks) {
  const out = new Map();
  for (const f of RECORD_FIELDS) out.set(f.field, f);
  for (const f of customFields)
    out.set(`custom.${f.key}`, { field: `custom.${f.key}`, label: f.label, type: TYPE_OF[f.field_type] || "text", source: "custom" });
  for (const a of asks || [])
    out.set(`ask.${a.key}`, { field: `ask.${a.key}`, label: a.label, type: TYPE_OF[a.type] || "text", source: "ask" });
  return out;
}

/** `{{ longdate deal.valid_until }}`, as the chip writes it: the house format of its type, when it has one. */
const tagOf = (entry) => {
  const helper = HELPER_OF[entry.type];
  return helper ? `{{ ${helper} ${entry.field} }}` : `{{ ${entry.field} }}`;
};

const TAG = /\{\{\s*(?:(date|longdate|datetime|month|money|number)\s+)?([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s*\}\}/g;
const attr = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

/**
 * The editor's HTML for kept wording: the one Markdown renderer's output, every `{{ field }}` wrapped as a
 * chip the editor draws by its label. A name the catalogue lacks is still wrapped, labelled by its path,
 * so a retired field shows rather than disappears.
 */
function editorHtml(markdown, catalog) {
  return md.markdownToHtml(markdown || "").replace(TAG, (whole, _helper, path) => {
    const entry = catalog.get(path);
    return `<span data-field="${attr(path)}" data-label="${attr(entry ? entry.label : path)}">${whole}</span>`;
  });
}

/** The Markdown to keep: the editor's HTML through the whitelist, tables kept, no tag surviving. */
function wordingFrom(bodyHtml) {
  const kept = md.htmlToMarkdown(bodyHtml, { tables: true }).trim();
  if (md.markdownToText(kept).replace(TAG, "x").trim().length < 40)
    throw new AppError("VALIDATION_FAILED", "Write the agreement", 422, { body_html: ["Write the agreement"] });
  return kept;
}

/** Refuse asks that cannot be filled: a key twice. */
function checkAsks(asks) {
  const seen = new Set();
  for (const a of asks || []) {
    if (seen.has(a.key))
      throw new AppError("ASK_DUPLICATE", `Two asks are called ${a.key}`, 422, { asks: ["Two asks share a name"] });
    seen.add(a.key);
  }
}

/**
 * Refuse wording that names something the agreement cannot fill: a path that is no record field, no custom
 * field of the category and no ask of the template. Names inside {{#each}} are the item's own and are not
 * checked (shared/templates/variables).
 */
function checkNames(markdown, catalog) {
  let used;
  try {
    used = [...variablesOf(parse(markdown))];
  } catch (err) {
    if (err instanceof TemplateError) throw new AppError("TEMPLATE_INVALID", err.message, 422, { body_html: [err.message] });
    throw err;
  }
  const bad = [...new Set(used.filter((p) => !p.startsWith("~")))].filter((p) => !catalog.has(p) && !/^(org|today)(\.|$)/.test(p));
  if (bad.length)
    throw new AppError(
      "TEMPLATE_UNKNOWN_VARIABLE",
      `This agreement uses ${bad.map((b) => `"${b}"`).join(", ")}, which it cannot fill.`,
      422,
      { body_html: bad.map((b) => `${b} is not a field of this agreement`) },
    );
}

/**
 * Validate and keep new wording as the key's next version, inside the caller's transaction.
 * @param {import("pg").PoolClient} client
 * @param {{key: string, title?: string|null, body_html: string, customFields: object[], asks: object[]}} t
 * @param {{created_by?: string|null}} [opts]
 * @returns {Promise<{version: number, body: string}>}
 */
async function saveWording(client, t, opts = {}) {
  checkAsks(t.asks);
  const body = wordingFrom(t.body_html);
  const catalog = catalogOf(t.customFields, t.asks);
  checkNames(body, catalog);
  declare(t.key);
  const saved = await store.saveVersion(client, { kind: KIND, key: t.key, title: t.title || undefined, body, format: "markdown" }, opts);
  return { version: saved.version, body };
}

/** The kept wording of a key, ready for the editor; `version` 0 and empty before any is saved. */
async function readWording(db, key, customFields, asks) {
  declare(key);
  let t = null;
  try {
    t = await store.current(db, KIND, key);
  } catch (err) {
    if (!(err instanceof AppError && err.code === "TEMPLATE_MISSING")) throw err;
  }
  const catalog = catalogOf(customFields, asks);
  if (!t) return { version: 0, title: null, body_html: "", catalog };
  const markdown = t.format === "markdown" ? t.body : md.htmlToMarkdown(t.body, { tables: true });
  return { version: t.version, title: t.title || null, body_html: editorHtml(markdown, catalog), catalog };
}

/** Whether a key is already some template's: a saved version, a shipped file or a letter. */
async function keyTaken(db, key) {
  const { rows } = await db.query(
    `SELECT 1 FROM template_version WHERE key = $1
      UNION ALL SELECT 1 FROM letter_template WHERE key = $1
      UNION ALL SELECT 1 FROM partner_category_template WHERE template_key = $1
      LIMIT 1`,
    [key],
  );
  return rows.length > 0 || Boolean(store.shipped(KIND, key));
}

/** `events-deal-merchant` from a category and a label, with a number after it when another has it. */
async function freeKey(db, ...words) {
  const base =
    words
      .join(" ")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 56)
      .replace(/-+$/, "") || "agreement";
  const start = /^[a-z]/.test(base) ? base : `agreement-${base}`;
  for (let n = 1; n < 100; n += 1) {
    const key = n === 1 ? start : `${start}-${n}`;
    if (!(await keyTaken(db, key))) return key;
  }
  throw new AppError("TEMPLATE_KEY", "Give the template a different name", 409, { label: ["Name in use"] });
}

module.exports = { KIND, RECORD_FIELDS, declare, catalogOf, tagOf, editorHtml, wordingFrom, checkNames, checkAsks, saveWording, readWording, keyTaken, freeKey };
