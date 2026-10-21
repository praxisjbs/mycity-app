"use strict";
/**
 * AI Control's SQL (docs/guides/ai-control.md §4): the chains saved on AI Control, the
 * providers' caps, Find Prices' proposals, and the ledger read for spend. A model's prices are
 * written by the integrations module, which owns the model list (integrations.service
 * setModelPrices).
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { STEP_NGN } = require("../../services/ai/governance");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

/* ------------------------------------------------------------------ *
 * Chains (ai_chain)
 * ------------------------------------------------------------------ */

/** A chain's saved links, first first; [] when it has none. */
async function chainRows(db, scope, key) {
  const { rows } = await db.query(
    `SELECT position, provider, model::text AS model FROM ai_chain WHERE scope = $1 AND key = $2 ORDER BY position`,
    [scope, key],
  );
  return rows;
}

/** Replace a chain's links with these, first to last. */
async function replaceChain(db, scope, key, links, userId) {
  await db.query("DELETE FROM ai_chain WHERE scope = $1 AND key = $2", [scope, key]);
  await db.query(
    `INSERT INTO ai_chain (scope, key, position, provider, model, updated_by)
     SELECT $1, $2, x.position, x.provider, x.model, $6
       FROM unnest($3::int[], $4::text[], $5::text[]) AS x (position, provider, model)`,
    [scope, key, links.map((_, i) => i + 1), links.map((l) => l.provider), links.map((l) => l.model), userId],
  );
}

/** Forget an action's own chain: it is back on its job's. Answers how many links went. */
async function deleteChain(db, scope, key) {
  const { rowCount } = await db.query("DELETE FROM ai_chain WHERE scope = $1 AND key = $2", [scope, key]);
  return rowCount;
}

/* ------------------------------------------------------------------ *
 * Models and proposals
 * ------------------------------------------------------------------ */

const MODEL = `m.ai_model_id, m.provider, m.model::text AS model, m.display_name, m.capabilities, m.available,
  m.input_usd_per_million::text AS input_usd_per_million, m.output_usd_per_million::text AS output_usd_per_million,
  m.audio_usd_per_million::text AS audio_usd_per_million, m.usd_per_audio_hour::text AS usd_per_audio_hour,
  m.usd_per_thousand_searches::text AS usd_per_thousand_searches,
  EXISTS (SELECT 1 FROM ai_price_proposal pp WHERE pp.ai_model_id = m.ai_model_id AND pp.status = 'proposed') AS proposed,
  (m.price_not_listed_at IS NOT NULL AND m.price_not_listed_at > now() - interval '7 days') AS not_listed`;

/** How long a Not Listed mark keeps a model out of Find Prices (§6.4). */
const NOT_LISTED_DAYS = 7;

/** The models in a chain first ($5, "provider:model"), then usable ones, then by provider and name. */
const MODEL_SORTS = {
  display_name: "(NOT ((m.provider || ':' || lower(m.model::text)) = ANY($5::text[]))), (m.available IS FALSE), m.provider, m.display_name",
};

/**
 * Every provider's models, 25 a page. Filters: provider, capability, show (usable, the default;
 * not_on_key; all), q (id or name).
 * @param {{query: Function}} db
 * @param {object} query
 * @param {string[]} [chained]  "provider:model" ids in a chain, lower case: listed first
 */
function modelPage(db, query, chained = []) {
  const show = query.show || "usable";
  return pageQuery(
    db,
    `SELECT ${MODEL}, ${TOTAL_COL}
       FROM ai_model m
      WHERE ($1::text IS NULL OR m.provider = $1)
        AND ($2::text IS NULL OR $2 = ANY(m.capabilities))
        AND ($3::text IS NULL OR search_fold(m.model || ' ' || m.display_name) LIKE '%' || search_fold($3) || '%')
        AND ($4 = 'all' OR ($4 = 'usable' AND m.available IS NOT FALSE) OR ($4 = 'not_on_key' AND m.available IS FALSE))
      ORDER BY ${orderBy(query, MODEL_SORTS, "m.ai_model_id")}`,
    [query.provider || null, query.capability || null, query.q || null, show, chained],
    query,
  );
}

function modelById(db, id) {
  return one(db, `SELECT ${MODEL} FROM ai_model m WHERE m.ai_model_id = $1`, [id]);
}

/** The models Find Prices asks about (§6.4): on the key or not checked, no price, nothing waiting, not Not Listed. */
const TO_PRICE = `m.available IS NOT FALSE
  AND m.input_usd_per_million IS NULL AND m.output_usd_per_million IS NULL AND m.usd_per_audio_hour IS NULL
  AND NOT EXISTS (SELECT 1 FROM ai_price_proposal pp WHERE pp.ai_model_id = m.ai_model_id AND pp.status = 'proposed')
  AND (m.price_not_listed_at IS NULL OR m.price_not_listed_at <= now() - interval '${NOT_LISTED_DAYS} days')`;

/** A provider's models a run asks about, by id. */
async function modelsToPrice(db, provider) {
  const { rows } = await db.query(
    `SELECT m.ai_model_id, m.model::text AS model, m.display_name, m.capabilities
       FROM ai_model m WHERE m.provider = $1 AND ${TO_PRICE}
      ORDER BY m.model`,
    [provider],
  );
  return rows;
}

/** How many models of these providers a run would ask about, and how many are Not Listed. */
async function priceCounts(db, providers) {
  return one(
    db,
    `SELECT count(*) FILTER (WHERE ${TO_PRICE})::int AS to_price,
            count(*) FILTER (WHERE m.price_not_listed_at > now() - interval '${NOT_LISTED_DAYS} days')::int AS not_listed
       FROM ai_model m WHERE m.provider = ANY($1::text[])`,
    [providers],
  );
}

/** The models a run asked about that the page did not price. */
async function markNotListed(db, ids) {
  if (ids.length) await db.query("UPDATE ai_model SET price_not_listed_at = now() WHERE ai_model_id = ANY($1::uuid[])", [ids]);
}

const PROPOSAL = `p.ai_price_proposal_id, p.ai_model_id, m.provider, m.model::text AS model, m.display_name,
  p.input_usd_per_million::text AS input_usd_per_million, p.output_usd_per_million::text AS output_usd_per_million,
  p.audio_usd_per_million::text AS audio_usd_per_million, p.usd_per_audio_hour::text AS usd_per_audio_hour,
  p.usd_per_thousand_searches::text AS usd_per_thousand_searches, p.source_url, p.created_at`;

/** The open proposals, by provider and model, 25 a page. */
function proposalPage(db, query) {
  return pageQuery(
    db,
    `SELECT ${PROPOSAL}, ${TOTAL_COL}
       FROM ai_price_proposal p JOIN ai_model m ON m.ai_model_id = p.ai_model_id
      WHERE p.status = 'proposed'
      ORDER BY m.provider, m.display_name, p.ai_price_proposal_id`,
    [],
    query,
  );
}

/** One open proposal, locked for its decision; null when it is not open. */
function openProposal(db, id) {
  return one(
    db,
    `SELECT ${PROPOSAL}
       FROM ai_price_proposal p JOIN ai_model m ON m.ai_model_id = p.ai_model_id
      WHERE p.ai_price_proposal_id = $1 AND p.status = 'proposed'
      FOR UPDATE OF p`,
    [id],
  );
}

/**
 * Keep Find Prices' proposals: each takes the place of an open one for the same model, which is
 * dismissed by nobody.
 * @param {{query: Function}} db
 * @param {string|null} runId
 * @param {Array<object>} rows  { ai_model_id, the five prices, source_url }
 */
async function addProposals(db, runId, rows) {
  if (!rows.length) return 0;
  await db.query(
    `UPDATE ai_price_proposal SET status = 'dismissed', decided_at = now()
      WHERE status = 'proposed' AND ai_model_id = ANY($1::uuid[])`,
    [rows.map((r) => r.ai_model_id)],
  );
  const col = (k) => rows.map((r) => r[k]);
  const { rowCount } = await db.query(
    `INSERT INTO ai_price_proposal
       (ai_model_id, input_usd_per_million, output_usd_per_million, audio_usd_per_million, usd_per_audio_hour,
        usd_per_thousand_searches, source_url, run_id)
     SELECT x.ai_model_id, x.input, x.output, x.audio, x.hour, x.searches, x.source_url, $8
       FROM unnest($1::uuid[], $2::numeric[], $3::numeric[], $4::numeric[], $5::numeric[], $6::numeric[], $7::text[])
         AS x (ai_model_id, input, output, audio, hour, searches, source_url)`,
    [
      col("ai_model_id"),
      col("input_usd_per_million"),
      col("output_usd_per_million"),
      col("audio_usd_per_million"),
      col("usd_per_audio_hour"),
      col("usd_per_thousand_searches"),
      col("source_url"),
      runId,
    ],
  );
  return rowCount;
}

/** Accept or dismiss an open proposal. */
async function decideProposal(db, id, status, userId) {
  await db.query(
    `UPDATE ai_price_proposal SET status = $2, decided_by = $3, decided_at = now()
      WHERE ai_price_proposal_id = $1 AND status = 'proposed'`,
    [id, status, userId],
  );
}

/** How many proposals wait for IT. */
async function openProposals(db) {
  return (await one(db, "SELECT count(*)::int AS n FROM ai_price_proposal WHERE status = 'proposed'", [])).n;
}

/* ------------------------------------------------------------------ *
 * Find Prices runs (ai_price_run, 10210)
 * ------------------------------------------------------------------ */

const RUN = `r.ai_price_run_id, r.status, r.batches_total, r.batches_done, r.proposals, r.not_listed, r.error_code,
  r.started_at, r.finished_at`;

/** A run, as it starts. */
function startPriceRun(db, userId) {
  return one(db, `INSERT INTO ai_price_run (requested_by) VALUES ($1) RETURNING ${RUN.replace(/r\./g, "")}`, [userId]);
}

/** The newest run, or null. */
function newestPriceRun(db) {
  return one(db, `SELECT ${RUN} FROM ai_price_run r ORDER BY r.started_at DESC LIMIT 1`, []);
}

/**
 * A run's progress: the batches it will ask (which starts the count again, as a retried run
 * does), and what each one adds.
 */
async function progressPriceRun(db, id, { total, done = 0, proposals = 0, notListed = 0 }) {
  await db.query(
    `UPDATE ai_price_run SET batches_total = COALESCE($2, batches_total),
            batches_done = CASE WHEN $2::int IS NULL THEN batches_done + $3 ELSE $3 END,
            proposals = proposals + $4, not_listed = not_listed + $5
      WHERE ai_price_run_id = $1`,
    [id, total === undefined ? null : total, done, proposals, notListed],
  );
}

/** A run ended, done or failed with the first error's code. */
async function finishPriceRun(db, id, status, errorCode = null) {
  await db.query(
    "UPDATE ai_price_run SET status = $2, error_code = $3, finished_at = now() WHERE ai_price_run_id = $1 AND status = 'running'",
    [id, status, errorCode],
  );
}

/** Every open proposal, locked for Accept All. */
async function openProposalsForUpdate(db) {
  const { rows } = await db.query(
    `SELECT ${PROPOSAL}
       FROM ai_price_proposal p JOIN ai_model m ON m.ai_model_id = p.ai_model_id
      WHERE p.status = 'proposed'
      ORDER BY m.provider, m.model
      FOR UPDATE OF p`,
    [],
  );
  return rows;
}

/* ------------------------------------------------------------------ *
 * Spend
 * ------------------------------------------------------------------ */

/** Each action's runs since `from`: { "policy-tidy": 3 }. */
async function callsSince(db, from) {
  const { rows } = await db.query(
    `SELECT purpose, count(*)::int AS calls FROM ai_run WHERE started_at >= $1 AND status <> 'refused' GROUP BY purpose`,
    [from],
  );
  return Object.fromEntries(rows.map((r) => [r.purpose, r.calls]));
}

/** Naira by Lagos day in [from, to), unrounded: [{ day: "2026-10-01", spent: "12.3456" }]. */
async function spendByDay(db, from, to) {
  const { rows } = await db.query(
    `SELECT to_char((s.created_at AT TIME ZONE 'Africa/Lagos')::date, 'YYYY-MM-DD') AS day,
            COALESCE(SUM(${STEP_NGN}), 0)::text AS spent
       FROM ai_run_step s
      WHERE s.created_at >= $1 AND s.created_at < $2
      GROUP BY 1 ORDER BY 1`,
    [from, to],
  );
  return rows;
}

/** This month by action (the run's purpose), the costliest first, 25 a page. */
function spendByAction(db, from, to, query) {
  return pageQuery(
    db,
    `SELECT r.purpose AS key, count(DISTINCT r.run_id)::int AS calls, COALESCE(SUM(${STEP_NGN}), 0)::text AS spent, ${TOTAL_COL}
       FROM ai_run_step s JOIN ai_run r ON r.run_id = s.run_id
      WHERE s.created_at >= $1 AND s.created_at < $2
      GROUP BY r.purpose
      ORDER BY SUM(${STEP_NGN}) DESC, r.purpose`,
    [from, to],
    query,
  );
}

/** A provider's cap row, or null. */
function capOf(db, provider) {
  return one(db, "SELECT provider, monthly_cap_ngn::text AS monthly_cap_ngn FROM ai_provider_cap WHERE provider = $1", [provider]);
}

async function setCap(db, provider, cap, userId) {
  await db.query(
    `INSERT INTO ai_provider_cap (provider, monthly_cap_ngn, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (provider) DO UPDATE SET monthly_cap_ngn = EXCLUDED.monthly_cap_ngn, updated_by = EXCLUDED.updated_by`,
    [provider, cap, userId],
  );
}

/** The cap on all AI, from the ai_setting row in use; null when none is set. */
async function overallCap(db) {
  const row = await one(db, "SELECT ai_setting_id, monthly_cap_ngn::text AS monthly_cap_ngn FROM ai_setting ORDER BY updated_at DESC LIMIT 1", []);
  return row;
}

/** Set the cap on all AI on the row in use, or on a new row (the other settings at their defaults). */
async function setOverallCap(db, cap, userId) {
  const row = await overallCap(db);
  if (row) await db.query("UPDATE ai_setting SET monthly_cap_ngn = $2, updated_by = $3 WHERE ai_setting_id = $1", [row.ai_setting_id, cap, userId]);
  else await db.query("INSERT INTO ai_setting (monthly_cap_ngn, updated_by) VALUES ($1, $2)", [cap, userId]);
}

/** The Knowledge Hub has indexed something: the embedding model is locked (§6.6). */
async function embeddingsIndexed(db) {
  try {
    return (await one(db, "SELECT EXISTS (SELECT 1 FROM knowledge_embedding) AS indexed", [])).indexed;
  } catch (err) {
    if (err && err.code === "42P01") return false;
    throw err;
  }
}

module.exports = {
  chainRows,
  replaceChain,
  deleteChain,
  modelPage,
  modelById,
  modelsToPrice,
  priceCounts,
  markNotListed,
  startPriceRun,
  newestPriceRun,
  progressPriceRun,
  finishPriceRun,
  openProposalsForUpdate,
  proposalPage,
  openProposal,
  addProposals,
  decideProposal,
  openProposals,
  callsSince,
  spendByDay,
  spendByAction,
  capOf,
  setCap,
  overallCap,
  setOverallCap,
  embeddingsIndexed,
};
