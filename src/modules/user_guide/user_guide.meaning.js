"use strict";
/**
 * The meaning half of the User Guide's search (docs/guides/user-guide.md §6.8): the vectors of
 * the chapters' passages, kept by the worker, and how near a search is to each passage a reader
 * may read.
 *
 * Both use the one Guide Search action (Embeddings job, OpenAI's small model at 1,536), so a
 * search and the passages are always embedded by the same model. A passage is known by the hash
 * of what was embedded: the same text is the same vector for every reader, and a passage whose
 * text changed has no vector until the next sync, so it is found by its words meanwhile.
 *
 * With AI off, the module's AI off, the cap reached or no OpenAI key there are no vectors and
 * nothing fails: the words answer alone.
 */
const crypto = require("node:crypto");
const { pool } = require("../../config/db");
const { logger } = require("../../config/logger");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const ai = require("../../services/ai/llm.service");
const jobs = require("../../services/ai/jobs");
const engine = require("@mycity/contract/guide-search");
const repo = require("./user_guide.repo");
const { EVENTS } = require("./user_guide.events");

/** Refusals that mean AI is not on for the guide just now, rather than broken. */
const AI_OFF = new Set(["AI_DISABLED", "AI_MODULE_DISABLED", "AI_CAP_REACHED", "AI_UNAVAILABLE"]);

const hashes = new WeakMap();

/** Each passage's hash, by its id: sha256 of what the meaning index embeds for it. */
function hashesOf(index) {
  let out = hashes.get(index);
  if (!out) {
    out = index.passages.map((p) => crypto.createHash("sha256").update(engine.meaningText(p)).digest("hex"));
    hashes.set(index, out);
  }
  return out;
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/**
 * Bring the index up to the chapters and the model: embed every passage that has no vector on
 * the Guide Search model, then drop the vectors nothing says any more. A sync with nothing new
 * spends nothing and writes nothing. Run by the user-guide-index schedule and at worker boot.
 * @param {{index?: object, db?: {query: Function}}} [opts]  tests pass their own index
 * @returns {Promise<object>} what it did, for Settings · Status
 */
async function sync({ index = require("./user_guide.service").indexOf(require("./user_guide.service").load()), db = pool } = {}) {
  const [link] = await jobs.walk("guide-search", { db });
  if (!link) return { skipped: "embeddings not set up" };
  const all = hashesOf(index);
  const texts = new Map();
  all.forEach((hash, id) => {
    if (!texts.has(hash)) texts.set(hash, engine.meaningText(index.passages[id]));
  });
  const have = await repo.indexed(db, link.model, [...texts.keys()]);
  const missing = [...texts.keys()].filter((h) => !have.has(h));
  let vectors = [];
  let model = link.model;
  if (missing.length) {
    let res;
    try {
      res = await ai.embed({ purpose: "guide-search", module: "knowledge", actor: null, input: missing.map((h) => texts.get(h)), db });
    } catch (err) {
      if (AI_OFF.has(err.code)) return { skipped: err.code };
      throw err;
    }
    if (!res.vectors) return { skipped: "embeddings not set up" };
    vectors = res.vectors;
    model = res.model;
  }
  const keep = [...texts.keys()];
  const result = await tx(async (client) => {
    const added = await repo.save(client, model, missing.map((hash, i) => ({ hash, vector: vectors[i] })));
    const removed = await repo.prune(client, model, keep);
    if (added || removed)
      await emit(client, {
        key: EVENTS.USER_GUIDE_INDEXED,
        entity: { type: "user_guide_passage", id: model },
        actor: null,
        payload: { model, added, removed, passages: keep.length },
      });
    return { model, added, removed, passages: keep.length };
  });
  if (result.added || result.removed) logger.info(result, "User Guide indexed for search by meaning");
  return result;
}

/**
 * A search's vector, on the Guide Search model, kept nowhere; null when there is none to be had
 * (AI off, not set up, the cap reached, no answer in time). ⌘K asks for it before its
 * transaction opens (shared/search/search.service.js `prepare`), so no call waits inside one.
 * @param {{q: string, user: object, timeoutMs?: number, db?: {query: Function}}} req
 * @returns {Promise<{vector: number[], model: string}|null>}
 */
async function embedSearch({ q, user, timeoutMs = 4_000, db = pool }) {
  let res;
  try {
    res = await ai.embed({ purpose: "guide-search", module: "knowledge", actor: user, input: q, egress: "reasoning", timeoutMs, retry: false, db });
  } catch (err) {
    if (AI_OFF.has(err.code)) return null;
    throw err;
  }
  return res.vectors && res.vectors[0] ? { vector: res.vectors[0], model: res.model } : null;
}

/**
 * How near a search's vector is to each passage this reader may read, by id, for the passages
 * near enough to be candidates (guide-search.js MEANING_FLOOR); null when none is, or the index
 * holds nothing on that model yet.
 * @param {{index: object, visible: Map<number, object>, vector: number[], model: string, db?: {query: Function}}} req
 * @returns {Promise<Map<number, number>|null>}
 */
async function nearest({ index, visible, vector, model, db = pool }) {
  const all = hashesOf(index);
  const ids = new Map();
  for (const [id] of visible) {
    const h = all[id];
    if (!ids.has(h)) ids.set(h, []);
    ids.get(h).push(id);
  }
  const rows = await repo.nearest(db, { vector, model, hashes: [...ids.keys()], floor: engine.MEANING_FLOOR });
  if (!rows.length) return null;
  const out = new Map();
  for (const r of rows) for (const id of ids.get(r.text_hash) || []) out.set(id, r.similarity);
  return out;
}

/** Both: a search embedded, then compared with what this reader may read. */
async function similarities({ index, visible, q, user, timeoutMs, db = pool }) {
  const searched = await embedSearch({ q, user, timeoutMs, db });
  return searched ? nearest({ index, visible, ...searched, db }) : null;
}

module.exports = { sync, embedSearch, nearest, similarities, hashesOf, AI_OFF };
