"use strict";
/**
 * Every document the system produces, from M3 query letters to M6 payslips to M7
 * proposals, through one call (BACKEND_STRUCTURE §5.5):
 *
 *   const doc = await documents.generate(client, {
 *     doc_type: "query_letter",
 *     entity: { type: "query", id: query.query_id },
 *     subject_employee_id: query.employee_id,
 *     data,                                      // checked against the template's variables
 *     actor,
 *   });
 *
 * In the caller's transaction, generate():
 *   1. checks `data` against the template's declared variables (shared/templates/variables.js),
 *      so a missing value fails BEFORE anything is numbered or stored;
 *   2. allocates the number when the type is numbered (shared/numbering, rolls back with you);
 *   3. renders the HTML from the current template version inside the letterhead;
 *   4. writes the document row (render_status "pending", the HTML kept until rendered,
 *      the template version recorded) and emits document.render_requested.
 *
 * After commit the worker's pdf-render job calls renderPending(), which turns the HTML
 * into a PDF with Chromium, stores it, hashes the stored bytes, locks the document and
 * emits document.generated. Chromium never runs inside a request.
 *
 * A module declares each type it generates once, beside its events:
 *
 *   defineDocType("query_letter", {
 *     label: "Query letter",             // registered as a document type too (types.js)
 *     module: "queries",                 // whose view grant governs reading it
 *     template: "query-letter",          // templates/documents/query-letter.html
 *     numbering: "letter",               // a key of shared/numbering/schemes.js, or null
 *     sensitivity: "personal",
 *     title: (data) => `Query: ${data.subject}`,
 *     signable: false,                   // M5 offer letters and contracts: true
 *     export: false,                     // a file somebody pressed Download for: true, kept a
 *                                        // day and never locked (shared/documents/exports.js)
 *   });
 *   defineVariables("document", "query-letter", c.queries.QueryLetterVars);
 *
 * A doc type whose letters people write on a screen (M3: a rung added to the chain sends
 * a letter nobody shipped) declares `templateChoice: true`. A caller then names the
 * template with `template`; `template` in the spec stays the default. The chosen key's
 * variables must be declared like any other (defineVariables), and the caller decides
 * which keys a person may choose:
 *
 *   defineDocType("sanction_letter", { template: "warning-letter", templateChoice: true, ... });
 *   await documents.generate(client, { doc_type: "sanction_letter", template: step.letter_template, ... });
 *
 * A doc type whose documents someone signs off declares `signedBy: (data) => data.signer`. The
 * letterhead then closes the body with that person's block, `{ name, role, signature }` (a PNG
 * data URL drawn on a SignatureField, or null), whatever the template, so a letter written on a
 * screen in Markdown is signed like a shipped one.
 *
 * A doc type that is a letter to one person declares `letter: (data) => ({ date, to })`, `to`
 * the addressee's lines (name, job title, department). The letterhead then opens the body as a
 * letter (the date, then the addressee) and closes it with "Yours faithfully" and "For" the
 * organisation above the signer, as MyCity's own letters are laid out; it prints no title, the
 * wording carrying its own heading.
 *
 * Brand: the Logo uploaded on Settings · Organisation (else assets/brand/logo.png when
 * present, else the company's name in the letterhead's type) and the Geist fonts
 * (assets/fonts/*.woff2) are embedded as data URLs, because the PDF renderer fetches nothing.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { config } = require("../../config/env");
const { inTransaction, atomically } = require("../db/tx");
const numbering = require("../numbering/numbering");
const { SCHEMES } = require("../numbering/schemes");
const lagos = require("../time/lagos");
const { emit } = require("../events/emit");
const { render } = require("./render");
const { markdownToHtml } = require("./markdown");
const { sha256 } = require("../files/hash");
const { storageKey, displayName } = require("../files/safe-name");
const templates = require("../templates/template-store");
const variables = require("../templates/variables");
const vault = require("./vault");
const docTypes = require("./types");
const organisation = require("../organisation/profile");
const storage = require("../../services/storage/storage.service");

const ASSETS = path.resolve(__dirname, "..", "..", "..", "assets");
const DOC_TYPES = new Map();
const SENSITIVITIES = new Set(["normal", "personal", "restricted"]);

/**
 * @param {string} docType  snake_case
 * @param {{template: string, numbering?: string|null, sensitivity?: string, title: (data: object) => string,
 *          landscape?: boolean, label?: string, module?: string|null, signable?: boolean, wet?: boolean,
 *          export?: boolean, templateChoice?: boolean,
 *          signedBy?: (data: object) => ({name: string, role: string, signature?: string|null}|null)}} spec
 */
function defineDocType(docType, spec) {
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(docType))
    throw new Error(`defineDocType: "${docType}" is snake_case`);
  if (!spec || !/^[a-z][a-z0-9-]{1,63}$/.test(String(spec.template || "")))
    throw new Error(`defineDocType(${docType}): template is a file key`);
  if (spec.numbering && !SCHEMES[spec.numbering])
    throw new Error(
      `defineDocType(${docType}): numbering "${spec.numbering}" is not in shared/numbering/schemes.js`,
    );
  if (spec.sensitivity && !SENSITIVITIES.has(spec.sensitivity))
    throw new Error(
      `defineDocType(${docType}): sensitivity is normal, personal or restricted`,
    );
  if (typeof spec.title !== "function")
    throw new Error(`defineDocType(${docType}): title is (data) => string`);
  if (spec.signedBy !== undefined && typeof spec.signedBy !== "function")
    throw new Error(`defineDocType(${docType}): signedBy is (data) => the signer`);
  if (spec.letter !== undefined && typeof spec.letter !== "function")
    throw new Error(`defineDocType(${docType}): letter is (data) => ({ date, to })`);
  if (DOC_TYPES.has(docType) && DOC_TYPES.get(docType) !== spec)
    throw new Error(`defineDocType: ${docType} is already defined`);
  DOC_TYPES.set(
    docType,
    Object.freeze({
      numbering: null,
      sensitivity: "normal",
      landscape: false,
      templateChoice: false,
      ...spec,
    }),
  );
  // One registry for every doc type, generated or uploaded: reading, signing and the
  // template join all look the type up there.
  docTypes.defineDocumentType(docType, {
    label:
      spec.label ||
      docType.charAt(0).toUpperCase() + docType.slice(1).replace(/_/g, " "),
    module: spec.module || null,
    sensitivity: spec.sensitivity || "normal",
    signable: spec.signable === true,
    wet: spec.wet === true,
    export: spec.export === true,
  });
}

const TEMPLATE_KEY_RE = /^[a-z][a-z0-9-]{1,63}$/;

/** The template a document of this type is rendered from: the spec's, or the caller's choice. */
function templateKeyOf(docType, spec, chosen) {
  if (chosen === undefined || chosen === null || chosen === spec.template)
    return spec.template;
  if (!spec.templateChoice)
    throw new Error(
      `documents.generate: ${docType} always uses "${spec.template}"; it does not take a template`,
    );
  if (!TEMPLATE_KEY_RE.test(String(chosen)))
    throw new Error(`documents.generate: "${chosen}" is not a template key`);
  return String(chosen);
}

function specOf(docType) {
  const spec = DOC_TYPES.get(docType);
  if (!spec)
    throw new Error(
      `documents.generate: "${docType}" is not defined; call defineDocType()`,
    );
  return spec;
}

/* ------------------------------------------------------------------ *
 * Brand and organisation
 * ------------------------------------------------------------------ */

let brandCache = null;

/** Logo and font data URLs, read once per process. */
function brand() {
  if (brandCache) return brandCache;
  const logoFile = ["logo.png", "logo.jpg"]
    .map((f) => path.join(ASSETS, "brand", f))
    .find((f) => fs.existsSync(f) && fs.statSync(f).size > 0);
  const logo = logoFile
    ? `data:image/${logoFile.endsWith(".png") ? "png" : "jpeg"};base64,${fs.readFileSync(logoFile).toString("base64")}`
    : null;
  const fontDir = path.join(ASSETS, "fonts");
  const faces = fs.existsSync(fontDir)
    ? fs
        .readdirSync(fontDir)
        .filter((f) => /^Geist-(\w+)\.woff2$/.test(f))
        .map((f) => {
          const weight =
            { Regular: 400, Medium: 500, SemiBold: 600, Bold: 700 }[
              /^Geist-(\w+)\./.exec(f)[1]
            ] || 400;
          const data = fs
            .readFileSync(path.join(fontDir, f))
            .toString("base64");
          return `@font-face{font-family:"Geist";font-weight:${weight};src:url(data:font/woff2;base64,${data}) format("woff2");}`;
        })
    : [];
  brandCache = { logo, fontCss: faces.join("") };
  return brandCache;
}

/**
 * The organisation for letterheads, spreadsheets and system mail: Settings · Organisation,
 * read through its one reader (shared/organisation/profile.js), with the brand files fitted
 * to where they are drawn (foundation.md §6.11).
 *
 *   name          the legal name (what a letter is from), else the trading name
 *   display_name  the name the company goes by, for a heading
 *   rc            "RC 1234567", or null
 *   logo          the Logo as a data URL for white paper, or null
 *   logo_white    the White Logo for Deep Green, { data, buffer, width, height }, or null
 */
async function orgProfile(client) {
  const p = await organisation.readProfile(client);
  const logo = await organisation.brandPicture(client, p.logo_document_id, { height: 40, scale: 4 });
  const white = await organisation.brandPicture(client, p.logo_white_document_id, { height: 28 });
  return {
    name: p.legal_name || p.trading_name || "MyCity App Ltd",
    display_name: organisation.displayName(p),
    rc: organisation.rcOf(p.registration_number),
    address: p.address,
    phone: p.phone,
    email: p.email,
    website: p.website,
    logo: logo ? organisation.dataUrl(logo) : brand().logo,
    logo_white: white
      ? { data: organisation.dataUrl(white), buffer: white.buffer, width: white.width, height: white.height }
      : null,
  };
}

/**
 * Render a document template inside the letterhead to a complete HTML page.
 * @param {object} template  from template-store (body, format)
 * @param {object} data      checked data
 * @param {object} context   { org, number, today, doc }
 */
function renderDocumentHtml(template, data, context) {
  const values = { ...data, ...context, staging: config.APP_ENV === "staging" };
  const inner = render(template.body, values);
  const body = template.format === "markdown" ? markdownToHtml(inner) : inner;
  const page = render(templates.layout("document").body, values, { body });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${brand().fontCss}</style></head><body>${page}</body></html>`;
}

/** What the letterhead is told about the document: its title, its signer, and whether it is a letter. */
function docOf(spec, data, title) {
  const letter = spec.letter ? spec.letter(data) || null : null;
  return {
    title,
    signer: spec.signedBy ? spec.signedBy(data) || null : null,
    letter: letter ? { date: letter.date, to: (letter.to || []).filter(Boolean).map((line) => ({ line })) } : null,
  };
}

/**
 * A document's PDF exactly as it would be generated, from a template key and data, and nothing
 * stored, numbered or emailed: Letter Templates' preview (docs/guides/queries.md §6.7). The number
 * printed is the one given.
 * @param {{query: Function}} db
 * @param {{doc_type: string, template?: string, data: object, number?: string}} opts
 * @returns {Promise<{pdf: Buffer, title: string}>}
 */
async function previewPdf(db, { doc_type: docType, template: chosen, data, number = null }, { renderPdf } = {}) {
  const spec = specOf(docType);
  const templateKey = templateKeyOf(docType, spec, chosen);
  const checked = variables.parseData("document", templateKey, data);
  const template = await templates.current(db, "document", templateKey);
  const title = String(spec.title(checked) || "").trim().slice(0, 200) || docType;
  const html = renderDocumentHtml(template, checked, {
    org: await orgProfile(db),
    number,
    today: lagos.today(),
    doc: docOf(spec, checked, title),
  });
  const toPdf = renderPdf || require("../../services/pdf/pdf.service").render;
  return { pdf: await toPdf(html, { footer: number, landscape: spec.landscape }), title };
}

/* ------------------------------------------------------------------ *
 * Generate (in the request) and render (in the worker)
 * ------------------------------------------------------------------ */

/**
 * Queue a document for generation, in the caller's transaction.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {{doc_type: string, entity: {type: string, id: string}, subject_employee_id?: string|null,
 *          data: object, actor: object|string|null, date?: string, template?: string}} opts
 *   date      the document's business date (numbering period, the date printed); default today in Lagos
 *   template  a template key, for a doc type declared with templateChoice
 * @returns {Promise<object>} the document row, render_status "pending"
 */
async function generate(
  client,
  {
    doc_type: docType,
    entity,
    subject_employee_id: subjectId = null,
    data,
    actor,
    date,
    template: chosen,
  },
) {
  if (!inTransaction(client))
    throw new Error("documents.generate must run inside atomically()");
  const spec = specOf(docType);
  const templateKey = templateKeyOf(docType, spec, chosen);
  const checked = variables.parseData("document", templateKey, data);
  const template = await templates.current(client, "document", templateKey);
  const day = date
    ? lagos.assertDate(String(date).slice(0, 10), "date")
    : lagos.today();
  const number = spec.numbering
    ? (await numbering.allocate(client, spec.numbering, { date: day })).number
    : null;
  const title =
    String(spec.title(checked) || "")
      .trim()
      .slice(0, 200) || docType;
  const org = await orgProfile(client);
  const html = renderDocumentHtml(template, checked, {
    org,
    number,
    today: day,
    doc: docOf(spec, checked, title),
  });

  const id = crypto.randomUUID();
  const doc = await vault.insertRow(client, {
    document_id: id,
    doc_type: docType,
    title,
    original_name: displayName(`${number || title}.pdf`, "pdf"),
    storage_key: storageKey("generated", "pdf", { date: day }),
    mime: "application/pdf",
    bytes: 0,
    content_hash: null,
    version: 1,
    entity_type: entity.type,
    entity_id: String(entity.id),
    subject_employee_id: subjectId,
    sensitivity: spec.sensitivity,
    scan_status: "skipped",
    source: "generated",
    number,
    template_key: templateKey,
    template_version: template.version,
    render_status: "pending",
    render_html: html,
    uploaded_by: actor
      ? typeof actor === "string"
        ? actor
        : actor.user_id || null
      : null,
  });
  await emit(client, {
    key: vault.EVENTS.DOCUMENT_RENDER_REQUESTED,
    entity: { type: "document", id },
    module: vault.moduleFor(entity.type),
    actor,
    payload: {
      document_id: id,
      doc_type: docType,
      number,
      entity_type: entity.type,
      entity_id: String(entity.id),
    },
  });
  return doc;
}

/**
 * Turn a pending document into its PDF. Called by the pdf-render job after commit;
 * safe to call twice (a document already rendered is left alone). The PDF is locked, unless
 * it is an export: a copy made for one person, removed after a day (exports.js).
 * @param {string} documentId
 * @param {{db?: import("pg").Pool, renderPdf?: (html: string, opts: object) => Promise<Buffer>}} [opts]
 * @returns {Promise<object|null>} the rendered document, or null when there was nothing to do
 */
async function renderPending(
  documentId,
  { db = require("../../config/db").pool, renderPdf = null } = {},
) {
  const { rows } = await db.query(
    "SELECT document_id, doc_type, number, storage_key, render_status, render_html, entity_type FROM document WHERE document_id = $1",
    [documentId],
  );
  const row = rows[0];
  if (!row || row.render_status !== "pending") return null;
  const spec = DOC_TYPES.get(row.doc_type) || { landscape: false };
  const toPdf = renderPdf || require("../../services/pdf/pdf.service").render;
  const bytes = await toPdf(row.render_html, {
    footer: row.number,
    landscape: spec.landscape,
  });
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.subarray(0, 5).toString("latin1") !== "%PDF-"
  )
    throw new Error(
      "documents.renderPending: the renderer did not return a PDF",
    );

  await storage.put(row.storage_key, bytes, { overwrite: true });
  const client = await db.connect();
  try {
    return await atomically(client, async () => {
      const { rows: up } = await client.query(
        `UPDATE document
            SET render_status = 'done', render_html = NULL, render_error = NULL, bytes = $2, content_hash = $3,
                locked_at = CASE WHEN $4::boolean THEN NULL ELSE now() END
          WHERE document_id = $1 AND render_status = 'pending'
          RETURNING ${vault.COLUMNS}`,
        [documentId, bytes.length, sha256(bytes), docTypes.isExport(row.doc_type)],
      );
      if (!up[0]) return null;
      await emit(client, {
        key: vault.EVENTS.DOCUMENT_GENERATED,
        entity: { type: "document", id: documentId },
        module: vault.moduleFor(row.entity_type),
        actor: null,
        payload: {
          document_id: documentId,
          doc_type: row.doc_type,
          number: row.number,
          content_hash: up[0].content_hash,
        },
      });
      return up[0];
    });
  } finally {
    client.release();
  }
}

/** Mark a render as failed for good (the job's last attempt). */
async function failRender(
  documentId,
  error,
  { db = require("../../config/db").pool } = {},
) {
  const client = await db.connect();
  try {
    await atomically(client, async () => {
      const { rows } = await client.query(
        "UPDATE document SET render_status = 'failed', render_error = $2 WHERE document_id = $1 AND render_status = 'pending' RETURNING entity_type, doc_type",
        [documentId, String((error && error.message) || error).slice(0, 1000)],
      );
      if (!rows[0]) return;
      await emit(client, {
        key: vault.EVENTS.DOCUMENT_RENDER_FAILED,
        entity: { type: "document", id: documentId },
        module: vault.moduleFor(rows[0].entity_type),
        actor: null,
        payload: { document_id: documentId, doc_type: rows[0].doc_type },
      });
    });
  } finally {
    client.release();
  }
}

/** Tests only. */
function __reset() {
  DOC_TYPES.clear();
  brandCache = null;
}

module.exports = {
  defineDocType,
  specOf,
  generate,
  renderPending,
  failRender,
  renderDocumentHtml,
  previewPdf,
  orgProfile,
  brand,
  __reset,
};
