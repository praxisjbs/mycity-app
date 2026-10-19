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
const repo = require("./templates.repo");
const { EVENTS, SHIPPED, declare } = require("./templates.events");

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

async function get(id) {
  const row = await repo.get(pool, id, shippedWithWording());
  if (!row) throw notFound();
  declare(row.key);
  const t = await wordingOf(pool, row.key);
  return {
    ...publicRow(row),
    title: t ? t.title || null : null,
    body: t ? t.body : null,
    format: t ? t.format : null,
    variables: [...VARIABLE_NAMES],
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
    effective_on: purpose === "sanction" ? today : null,
    ends_on: null,
    days: null,
    fine_amount: null,
    signer: { name: "Operations & People", role: "Operations & People" },
  };
}

async function preview(id) {
  const row = await repo.get(pool, id, shippedWithWording());
  if (!row) throw notFound();
  declare(row.key);
  const t = await wordingOf(pool, row.key);
  if (!t)
    throw new AppError("TEMPLATE_AWAITING_SAMPLE", "This letter has no wording yet", 409);
  const data = variables.parseData("document", row.key, sampleData(row.purpose));
  const html = documents.renderDocumentHtml(t, data, {
    org: await documents.orgProfile(pool),
    number: "LTR-0000",
    today: lagos.today(),
    doc: { title: row.name },
  });
  return { title: row.name, html };
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

async function create(actor, body) {
  const id = await tx(async (client) => {
    let key = keyFrom(body.name);
    for (let n = 2; await repo.keyExists(client, key); n += 1) key = keyFrom(`${body.name} ${n}`);
    const letterId = await repo.insert(client, {
      key,
      name: body.name,
      purpose: body.purpose,
      created_by: actor.user_id,
    });
    declare(key);
    const version = await store.saveVersion(
      client,
      { kind: "document", key, title: body.title, body: body.body, format: "markdown" },
      { created_by: actor.user_id },
    );
    await emit(client, {
      key: EVENTS.LETTER_TEMPLATE_CREATED,
      entity: { type: "letter_template", id: letterId },
      actor,
      after: { key, name: body.name, purpose: body.purpose, version: version.version },
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
      { kind: "document", key: row.key, title: body.title, body: body.body, format: "markdown" },
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
  list,
  summary,
  get,
  preview,
  create,
  saveBody,
  activate,
  isReady,
  usable,
  VARIABLE_NAMES,
};
