"use strict";
/**
 * Letter templates: the one write path for a letter and its wording, and what the
 * queries and sanctions services ask before they send one (docs/guides/queries.md §6.7).
 *
 *   create()    a new letter, its key made from its name (`<slug>-letter`), saved as a
 *               draft with its first wording, in one transaction
 *   saveBody()  new wording, saved as the next template_version (never over the old)
 *   activate()  a letter with wording becomes available to rungs, rules and queries
 *   usable()    the key a query or sanction may be generated from, or a 422
 *
 * Wording people write is Markdown; the shipped defaults are files. Whether a shipped
 * file has wording is read from the file (template-store.shipped), so a sample MyCity
 * sends later turns `awaiting_sample` into `draft` the moment it is saved.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const store = require("../../shared/templates/template-store");
const variables = require("../../shared/templates/variables");
const documents = require("../../shared/documents/generate");
const lagos = require("../../shared/time/lagos");
const { formatLongDate } = require("../../shared/time/day-first");
const { render } = require("../../shared/documents/render");
const md = require("../../shared/documents/markdown");
const { markdownToHtml } = md;
const repo = require("./templates.repo");
const { EVENTS, SHIPPED, FINE_LETTER_KEY, declare, QUERY_LETTER, SANCTION_LETTER } = require("./templates.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That letter template does not exist", 404);

/** The shipped keys whose file has wording. */
const shippedWithWording = () => SHIPPED.filter((k) => store.shipped("document", k));

/** The names a letter may use, for the help on the editor. */
const VARIABLE_NAMES = Object.freeze(
  Object.keys(require("@mycity/contract").templates.ConsequenceLetterVars.shape),
);

/** `Final Warning` → `final-warning-letter`. */
function keyFrom(name) {
  const slug = String(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-?letter$/, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return `${slug || "letter"}-letter`;
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

const list = (query) => repo.list(pool, query, shippedWithWording());

const summary = () => repo.summary(pool, shippedWithWording());

/** The current wording of a key: the highest saved version, the shipped file, or null. */
async function wordingOf(db, key) {
  try {
    return await store.current(db, "document", key);
  } catch (err) {
    if (err instanceof AppError && err.code === "TEMPLATE_MISSING") return null;
    throw err;
  }
}

const publicRow = ({ stored_status: _s, ...row }) => row;

/** The letters every manual query and every fine send, whatever names them (guide §6.7). */
const DEFAULT_FOR = Object.freeze({ "query-letter": "every manual query", [FINE_LETTER_KEY]: "every fine" });

/** What sends a letter, in words, or null: a step or rule on it, or its being a default. */
function senderOf(row) {
  if (row.used_by.length) return row.used_by.join(", ");
  return DEFAULT_FOR[row.key] || null;
}

/**
 * The wording as the editor opens it. Markdown as saved; a shipped HTML file through the one
 * Markdown whitelist, so the editor shows MyCity's wording with its names, and the first save
 * keeps it as version 1.
 */
function editorHtmlOf(t) {
  if (!t) return null;
  return md.markdownToHtml(t.format === "markdown" ? t.body : md.htmlToMarkdown(t.body));
}

async function get(id) {
  const row = await repo.get(pool, id, shippedWithWording());
  if (!row) throw notFound();
  declare(row.key);
  const t = await wordingOf(pool, row.key);
  return {
    ...publicRow(row),
    title: t ? t.title || null : null,
    body: t ? t.body : null,
    body_html: editorHtmlOf(t),
    format: t ? t.format : null,
    variables: [...VARIABLE_NAMES],
    in_use: senderOf(row) !== null,
  };
}

/** Values a preview fills in. Invented; nothing here is stored or sent. */
function sampleData(purpose) {
  const today = lagos.today();
  return {
    employee: { display_name: "Ada Sample", first_name: "Ada", job_title: "Field Officer", department: "Operations" },
    query_number: "QRY-0000",
    subject: "Late arrival on three days",
    details: "You clocked in late on three working days this month.",
    reason: purpose === "sanction" ? "The explanation given was not accepted." : null,
    step_name: purpose === "sanction" ? "Warning" : null,
    raised_on: today,
    response_due: purpose === "query" ? `${lagos.addDays(today, 2)}T17:00:00.000Z` : null,
    effective_on: purpose === "query" ? null : today,
    ends_on: null,
    days: null,
    // The deduction letter's own sentence names the amount (guide §6.6).
    fine_amount: purpose === "fine" ? "5000.00" : null,
    signer: { name: "Operations & People", role: "Operations & People" },
  };
}

/* Marks around a value the record fills, kept through rendering and split out after. */
const OPEN = "\u0001";
const CLOSE = "\u0002";
/** The sample values that are plain text: dates and money pass through their formatters unmarked. */
const MARKED = new Set(["query_number", "subject", "details", "reason", "step_name"]);

function marked(data) {
  const mark = (v) => (typeof v === "string" && v ? `${OPEN}${v}${CLOSE}` : v);
  const out = { ...data };
  for (const k of MARKED) out[k] = mark(out[k]);
  out.employee = Object.fromEntries(Object.entries(data.employee).map(([k, v]) => [k, mark(v)]));
  out.signer = { name: mark(data.signer.name), role: mark(data.signer.role) };
  return out;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

/** HTML to paragraphs of text: one per block, tags dropped, entities read. */
function paragraphsOf(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .split(/<\/(?:p|h[1-6]|div|li)>|<br\s*\/?>/i)
    .map((chunk) =>
      chunk
        .replace(/<[^>]*>/g, "")
        .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_m, e) => ENTITIES[e])
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((text) => text.replace(new RegExp(`[${OPEN}${CLOSE}]`, "g"), "").trim())
    .map((text) => {
      const runs = [];
      for (const [i, part] of text.split(new RegExp(`[${OPEN}${CLOSE}]`)).entries()) {
        if (part) runs.push({ text: part, filled: i % 2 === 1 });
      }
      return runs;
    });
}

async function preview(id) {
  const row = await repo.get(pool, id, shippedWithWording());
  if (!row) throw notFound();
  declare(row.key);
  const t = await wordingOf(pool, row.key);
  if (!t)
    throw new AppError("TEMPLATE_AWAITING_SAMPLE", "This letter has no wording yet", 409);
  const data = variables.parseData("document", row.key, sampleData(row.purpose));
  const today = lagos.today();
  const values = { ...marked(data), org: await documents.orgProfile(pool), number: "LTR-0000", today, doc: { title: row.name } };
  const body = render(t.body, values);
  const html = t.format === "markdown" ? markdownToHtml(body) : body;
  const title = (t.title ? render(t.title, data) : row.name).trim() || row.name;
  return {
    reference: "LTR-0000",
    title,
    date_line: formatLongDate(today),
    paragraphs: paragraphsOf(html).slice(0, 200),
  };
}

/**
 * GET /letter-templates/:id/preview.pdf: the letter as the employee would receive it, the real PDF
 * from the same letterhead and engine, filled with sample values and signed with the reader's
 * saved signature (guide §6.7, §6.9). Nothing is stored, numbered or sent.
 * @returns {Promise<{pdf: Buffer, filename: string}>}
 */
async function previewPdf(id, user) {
  const row = await repo.get(pool, id, shippedWithWording());
  if (!row) throw notFound();
  declare(row.key);
  if (!(await wordingOf(pool, row.key)))
    throw new AppError("TEMPLATE_AWAITING_SAMPLE", "This letter has no wording yet", 409);
  const me = user.employee_id ? await require("../queries/queries.repo").employeeOf(pool, user.employee_id) : null;
  const saved = await require("../queries/queries.signature").dataUrlOf(pool, user.user_id);
  const data = {
    ...sampleData(row.purpose),
    signer: {
      name: me ? me.display_name : "Operations & People",
      role: (me && me.job_title) || "Operations & People",
      signature: saved ? saved.signature : null,
    },
  };
  const { pdf } = await documents.previewPdf(pool, {
    doc_type: row.purpose === "query" ? QUERY_LETTER : SANCTION_LETTER,
    template: row.key,
    data,
    number: "LTR-0000",
  });
  return { pdf, filename: `${row.name}.pdf` };
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

/**
 * The wording to keep, as Markdown: the editor's HTML through the one renderer's whitelist
 * (htmlToMarkdown, as Policies and query responses), so no tag survives and the letter's
 * {{ names }} stay as written; or Markdown as a script sends it.
 */
function wordingFrom(body) {
  if (body.body_html === undefined) return body.body;
  const kept = md.htmlToMarkdown(body.body_html).trim();
  if (md.markdownToText(kept).trim().length < 40)
    throw new AppError("VALIDATION_FAILED", "Write the letter", 422, { body_html: ["Write the letter"] });
  return kept;
}

async function create(actor, body) {
  const id = await tx(async (client) => {
    let key = keyFrom(body.name);
    for (let n = 2; await repo.keyExists(client, key); n += 1) key = keyFrom(`${body.name} ${n}`);
    const letterId = await repo.insert(client, {
      key,
      name: body.name,
      purpose: body.purpose,
      status: body.status || "draft",
      created_by: actor.user_id,
    });
    declare(key);
    const version = await store.saveVersion(
      client,
      { kind: "document", key, title: body.title, body: wordingFrom(body), format: "markdown" },
      { created_by: actor.user_id },
    );
    await emit(client, {
      key: EVENTS.LETTER_TEMPLATE_CREATED,
      entity: { type: "letter_template", id: letterId },
      actor,
      after: { key, name: body.name, purpose: body.purpose, status: body.status || "draft", version: version.version },
      payload: { letter_template_id: letterId, key },
    });
    // Save and Activate: ready to be chosen at once.
    if (body.status === "active")
      await emit(client, {
        key: EVENTS.LETTER_TEMPLATE_ACTIVATED,
        entity: { type: "letter_template", id: letterId },
        actor,
        before: { status: "draft" },
        after: { status: "active" },
        payload: { letter_template_id: letterId, key },
      });
    return letterId;
  });
  return get(id);
}

async function saveBody(actor, id, body) {
  await tx(async (client) => {
    const row = await repo.get(client, id, shippedWithWording());
    if (!row) throw notFound();
    if (row.status === "retired")
      throw new AppError("TEMPLATE_RETIRED", "A retired letter is not edited", 409);
    declare(row.key);
    const version = await store.saveVersion(
      client,
      { kind: "document", key: row.key, title: body.title, body: wordingFrom(body), format: "markdown" },
      { created_by: actor.user_id },
    );
    await repo.touch(client, id);
    await emit(client, {
      key: EVENTS.LETTER_TEMPLATE_SAVED,
      entity: { type: "letter_template", id },
      actor,
      before: { version: row.version },
      after: { version: version.version },
      payload: { letter_template_id: id, key: row.key, version: version.version },
    });
  });
  return get(id);
}

async function activate(actor, id) {
  await tx(async (client) => {
    const row = await repo.get(client, id, shippedWithWording());
    if (!row) throw notFound();
    if (row.status === "active") return;
    if (row.status === "awaiting_sample")
      throw new AppError("TEMPLATE_AWAITING_SAMPLE", "Write the letter before it is used", 409);
    await repo.setStatus(client, id, "active");
    await emit(client, {
      key: EVENTS.LETTER_TEMPLATE_ACTIVATED,
      entity: { type: "letter_template", id },
      actor,
      before: { status: row.status },
      after: { status: "active" },
      payload: { letter_template_id: id, key: row.key },
    });
  });
  return get(id);
}

/**
 * Back to a draft (POST /letter-templates/:id/deactivate), only while nothing sends it: a step or
 * rule on it must move to another letter first, and the defaults never stop.
 */
async function deactivate(actor, id) {
  await tx(async (client) => {
    const row = await repo.get(client, id, shippedWithWording());
    if (!row) throw notFound();
    if (row.stored_status !== "active") return;
    const sender = senderOf(row);
    if (sender)
      throw new AppError("TEMPLATE_IN_USE", `In use by ${sender}`, 409, { letter_template: [`Used by ${sender}`] });
    await repo.setStatus(client, id, "draft");
    await emit(client, {
      key: EVENTS.LETTER_TEMPLATE_DEACTIVATED,
      entity: { type: "letter_template", id },
      actor,
      before: { status: "active" },
      after: { status: "draft" },
      payload: { letter_template_id: id, key: row.key },
    });
  });
  return get(id);
}

/** PATCH /letter-templates/:id: the name, and what it is used for while nothing sends it. */
async function update(actor, id, body) {
  await tx(async (client) => {
    const row = await repo.get(client, id, shippedWithWording());
    if (!row) throw notFound();
    const purpose = body.purpose && body.purpose !== row.purpose ? body.purpose : undefined;
    if (purpose) {
      const sender = senderOf(row);
      if (sender)
        throw new AppError("TEMPLATE_IN_USE", `In use by ${sender}`, 409, { purpose: [`Used by ${sender}`] });
    }
    await repo.update(client, id, { name: body.name, purpose });
    await emit(client, {
      key: EVENTS.LETTER_TEMPLATE_UPDATED,
      entity: { type: "letter_template", id },
      actor,
      before: { name: row.name, purpose: row.purpose },
      after: { name: body.name || row.name, purpose: purpose || row.purpose },
      payload: { letter_template_id: id, key: row.key },
    });
  });
  return get(id);
}

/* ------------------------------------------------------------------ *
 * For the queries and sanctions services
 * ------------------------------------------------------------------ */

/** Whether a key is an active letter with wording, of the purpose given. */
async function isReady(db, key, purpose) {
  if (!key) return false;
  const row = await repo.getByKey(db, key, shippedWithWording());
  return Boolean(row && row.status === "active" && row.purpose === purpose);
}

/**
 * The key a letter is generated from, declared, or a 422 naming `field`. `fallback` is
 * used when `key` is empty (a manual query without a choice sends query-letter).
 */
async function usable(db, key, purpose, { field = "letter_template", fallback = null } = {}) {
  const chosen = key || fallback;
  if (!(await isReady(db, chosen, purpose)))
    throw new AppError("LETTER_NOT_READY", "That letter is not ready to send", 422, {
      [field]: ["Letter not ready"],
    });
  declare(chosen);
  return chosen;
}

module.exports = {
  keyFrom,
  paragraphsOf,
  list,
  summary,
  get,
  preview,
  previewPdf,
  create,
  saveBody,
  activate,
  deactivate,
  update,
  isReady,
  usable,
  VARIABLE_NAMES,
};
