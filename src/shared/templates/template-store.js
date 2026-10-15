"use strict";
/**
 * Templates for generated documents and system mail: where they come from, and
 * how an edit is kept (BACKEND_STRUCTURE §5.5).
 *
 *   const t = await templates.current(client, "document", "query-letter");
 *   // { kind, key, version, subject, title, body, format }
 *
 * The shipped default is a file, templates/<documents|email>/<key>.html, reviewed in
 * code like everything else. It is version 0. An edit in Settings (M3 letter templates,
 * M5 offer and mail templates) saves version 1, 2, ... in template_version and the
 * highest one is current. A generated document records the version it used, so a
 * letter can always be traced to the exact wording that produced it, and "back to the
 * default" is saving the default as a new version.
 *
 * A file may open with a front matter block (quote a value that holds {{ }}, so an
 * editor's YAML formatter leaves it alone):
 *
 *   ---
 *   subject: "Your payslip for {{ month period }}"
 *   title: Payslip
 *   ---
 *   <p>Dear {{ recipient.first_name }}, ...</p>
 *
 * `format` is html for the shipped files (developer-written, reviewed). An edit made in
 * Settings is saved as markdown: people editing letters never write HTML, and Markdown
 * cannot carry a script into a PDF or onto the public site.
 *
 * Layouts (templates/documents/letterhead.html, templates/email/layout.html) are not
 * editable: they carry the brand, and the brand is not a setting.
 *
 * Table (migration 0080; BACKEND_STRUCTURE §11.1):
 *   template_version  template_version_id, kind, key, version, subject, title, body, format,
 *                     created_by, created_at; UNIQUE (kind, key, version)
 */
const fs = require("node:fs");
const path = require("node:path");
const { AppError } = require("../errors");
const { inTransaction } = require("../db/tx");
const { parse, TemplateError } = require("../documents/render");
const variables = require("./variables");

const ROOT = path.resolve(__dirname, "..", "..", "..", "templates");
const DIRS = Object.freeze({ document: "documents", email: "email" });
const LAYOUTS = Object.freeze({ document: "letterhead", email: "layout" });
const KEY_RE = /^[a-z][a-z0-9-]{1,63}$/;
const FORMATS = new Set(["html", "markdown"]);

const fileCache = new Map();

function checkKind(kind, key) {
  if (!DIRS[kind])
    throw new Error(`templates: kind is document or email (got "${kind}")`);
  if (!KEY_RE.test(String(key || "")))
    throw new Error(`templates: "${key}" is not a template key`);
}

/** Split "---\nsubject: x\n---\nbody" into { meta, body }. */
function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line.trim());
    // A quoted value is YAML's way of keeping `{{ }}` as text (a YAML formatter turns an
    // unquoted `{{ title }}` into a mapping); the quotes are not part of the value.
    if (kv) meta[kv[1]] = kv[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return { meta, body: text.slice(m[0].length) };
}

/**
 * The shipped default, from templates/. Version 0. Cached per process.
 * @returns {{kind, key, version: 0, subject, title, body, format: "html"}|null}
 */
function shipped(kind, key) {
  checkKind(kind, key);
  const id = `${kind}:${key}`;
  if (fileCache.has(id)) return fileCache.get(id);
  const file = path.join(ROOT, DIRS[kind], `${key}.html`);
  let text = null;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    text = null;
  }
  const out =
    text && text.trim()
      ? (() => {
          const { meta, body } = frontMatter(text);
          return Object.freeze({
            kind,
            key,
            version: 0,
            subject: meta.subject || null,
            title: meta.title || null,
            body,
            format: "html",
          });
        })()
      : null;
  fileCache.set(id, out);
  return out;
}

/** The layout a kind renders inside (letterhead for documents, the mail frame for email). */
function layout(kind) {
  const t = shipped(kind, LAYOUTS[kind]);
  if (!t)
    throw new Error(
      `templates: the ${kind} layout templates/${DIRS[kind]}/${LAYOUTS[kind]}.html is missing or empty`,
    );
  return t;
}

/**
 * The current template: the highest saved version, or the shipped default.
 * @param {{query: Function}} client
 */
async function current(client, kind, key) {
  checkKind(kind, key);
  const { rows } = await client.query(
    `SELECT kind, key, version, subject, title, body, format
       FROM template_version
      WHERE kind = $1 AND key = $2
      ORDER BY version DESC
      LIMIT 1`,
    [kind, key],
  );
  if (rows[0]) return rows[0];
  const def = shipped(kind, key);
  if (!def)
    throw new AppError(
      "TEMPLATE_MISSING",
      `There is no "${key}" template.`,
      500,
    );
  return def;
}

/** A specific version (0 = the shipped default): re-rendering exactly what was produced. */
async function version(client, kind, key, v) {
  if (Number(v) === 0) return shipped(kind, key);
  const { rows } = await client.query(
    "SELECT kind, key, version, subject, title, body, format FROM template_version WHERE kind = $1 AND key = $2 AND version = $3",
    [kind, key, v],
  );
  return rows[0] || null;
}

/**
 * Save an edit as the next version. Parsed and checked against the declared
 * variables first, so a broken or misspelt template is refused with the line.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {{kind: string, key: string, subject?: string, title?: string, body: string, format?: string}} t
 * @param {{created_by?: string|null}} [opts]
 */
async function saveVersion(client, t, { created_by: createdBy = null } = {}) {
  if (!inTransaction(client))
    throw new Error("templates.saveVersion must run inside atomically()");
  checkKind(t.kind, t.key);
  if (t.key === LAYOUTS[t.kind])
    throw new AppError(
      "TEMPLATE_NOT_EDITABLE",
      "The layout carries the brand and is not edited here.",
      409,
    );
  const format = t.format || "markdown";
  if (!FORMATS.has(format))
    throw new Error(`templates: format is html or markdown (got "${format}")`);
  for (const [field, source] of [
    ["body", t.body],
    ["subject", t.subject || ""],
    ["title", t.title || ""],
  ]) {
    try {
      parse(source);
    } catch (err) {
      if (err instanceof TemplateError)
        throw new AppError("TEMPLATE_INVALID", err.message, 422, {
          [field]: [err.message],
        });
      throw err;
    }
    variables.assertTemplate(t.kind, t.key, source);
  }
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('template:' || $1 || ':' || $2))",
    [t.kind, t.key],
  );
  const { rows } = await client.query(
    `INSERT INTO template_version (kind, key, version, subject, title, body, format, created_by)
     SELECT $1, $2, COALESCE(max(version), 0) + 1, $3, $4, $5, $6, $7 FROM template_version WHERE kind = $1 AND key = $2
     RETURNING kind, key, version, subject, title, body, format`,
    [
      t.kind,
      t.key,
      t.subject || null,
      t.title || null,
      t.body,
      format,
      createdBy,
    ],
  );
  return rows[0];
}

/** Every shipped template key of a kind (the Settings list), layouts excluded. */
function shippedKeys(kind) {
  checkKind(kind, LAYOUTS[kind]);
  return fs
    .readdirSync(path.join(ROOT, DIRS[kind]))
    .filter((f) => f.endsWith(".html"))
    .map((f) => f.slice(0, -5))
    .filter((k) => k !== LAYOUTS[kind] && shipped(kind, k))
    .sort();
}

/** Tests only. */
function __clearCache() {
  fileCache.clear();
}

module.exports = {
  ROOT,
  LAYOUTS,
  frontMatter,
  shipped,
  layout,
  current,
  version,
  saveVersion,
  shippedKeys,
  __clearCache,
};
