"use strict";
/**
 * AI Control (docs/guides/ai-control.md): which model answers each AI feature, the models'
 * prices, and what AI costs each month.
 *
 *   jobs(query)                    the seven jobs, each with its chain and each model's state
 *   actions(query)                 the registered actions, 25 a page, with their chains and calls today
 *   saveChain(scope, key, b, by)   Edit Chain: a whole chain, checked (§6.2, §6.6), saved, audited
 *   makeFirst(scope, key, b, by)   Make First: one model to the front of its chain
 *   resetChain(key, by)            Use Job Chain: an action back on its job's chain
 *   models(query), modelsSummary() every provider's models with their prices; Find Prices' state
 *   setPrices(id, b, by)           Edit Price: a model's dollar prices by hand
 *   findPrices(by)                 Find Prices: the search runs in the worker (runFindPrices)
 *   proposals(query)               the prices it proposed, waiting for IT
 *   acceptProposal(id, b, by), dismissProposal(id, by)
 *   spend(), spendActions(query)   this Lagos month against the caps
 *   setCap(provider, b, by), setOverallCap(b, by)
 *
 * Every write runs in one transaction with emit(), and bumps the settings' version after the
 * commit, so every process walks the new chain or cap within a second. Nothing here tells
 * anyone anything (decision 21).
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { logger } = require("../../config/logger");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const { envelope, pageOf, PAGE_SIZE } = require("../../shared/http/paged");
const money = require("../../shared/money/money");
const fx = require("../../shared/money/fx");
const lagos = require("../../shared/time/lagos");
const providers = require("../../shared/integrations/providers");
const quota = require("../../shared/integrations/quota");
const settings = require("../../shared/integrations/settings");
const ai = require("../../services/ai/llm.service");
const actions = require("../../services/ai/actions");
const aiJobs = require("../../services/ai/jobs");
const governance = require("../../services/ai/governance");
const prices = require("../../services/ai/prices");
const { parseStructured } = require("../../services/ai/structured");
const integrations = require("../integrations/integrations.service");
const repo = require("./ai_governance.repo");
const { EVENTS } = require("./ai_governance.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const iso = (v) => (v ? new Date(v).toISOString() : null);
const userOf = (actor) => (actor && typeof actor === "object" ? actor.user_id || null : actor || null);

/** After a chain, a price or a cap changes: every process reads it again. */
async function changed() {
  aiJobs.forget();
  governance.forgetCaps();
  await settings.bump();
}

/** A chain as the screen takes it. */
const chainView = (ch) => ({
  scope: ch.scope,
  key: ch.key,
  stored: ch.stored,
  links: ch.links.map((l) => ({
    position: l.position,
    provider: l.provider,
    model: l.model,
    display_name: l.display_name,
    state: l.state,
    until: l.until || null,
  })),
  updated_by_name: ch.updated_by_name || null,
  updated_at: iso(ch.updated_at),
});

/* ------------------------------------------------------------------ *
 * Jobs and actions
 * ------------------------------------------------------------------ */

/** GET /ai-control/jobs: the seven jobs, one page. */
async function jobs(query = {}) {
  const indexed = await repo.embeddingsIndexed(pool);
  const cat = await aiJobs.catalogue(pool);
  const rows = [];
  for (const job of aiJobs.JOBS) {
    const onJob = actions.listed().filter((a) => a.job === job && aiJobs.sourceOf(cat, "action", a.key).scope === "job");
    rows.push({
      job,
      chain: chainView(await aiJobs.resolveJob(job, { db: pool })),
      actions: onJob.length,
      locked: job === "embeddings" && indexed,
    });
  }
  const { number, offset } = pageOf(query);
  return envelope(rows.slice(offset, offset + PAGE_SIZE), number, rows.length);
}

const matches = (a, q) => !q || `${a.key} ${a.label}`.toLowerCase().includes(String(q).toLowerCase());

/** GET /ai-control/actions: the registered actions, 25 a page. */
async function actionList(query = {}) {
  const listed = actions.listed().filter((a) => (!query.job || a.job === query.job) && matches(a, query.q));
  const { number, offset } = pageOf(query);
  const slice = listed.slice(offset, offset + PAGE_SIZE);
  const calls = await repo.callsSince(pool, lagos.startOfDay(lagos.today()));
  const data = [];
  for (const a of slice) {
    const ch = await aiJobs.resolve(a.key, { db: pool });
    data.push({
      key: a.key,
      label: a.label,
      module: a.module,
      job: a.job,
      personal_data: a.personal_data,
      reason: a.reason || null,
      chosen_by: a.chosen_by,
      chosen_at: a.chosen_at,
      built: a.built !== false,
      own_chain: ch.scope === "action",
      set_chain: Boolean(a.chain),
      chain: chainView(ch),
      calls_today: calls[a.key] || 0,
    });
  }
  return envelope(data, number, listed.length);
}

/** The job a chain answers for, and the action when it is an action's; 404 when neither exists. */
function ownerOf(scope, key) {
  if (scope === "job") {
    if (!aiJobs.JOBS.includes(key)) throw new AppError("NO_SUCH_JOB", "No such job", 404);
    return { job: key, action: null };
  }
  if (!actions.has(key) || actions.of(key).direct) throw new AppError("NO_SUCH_ACTION", "No such action", 404);
  const action = actions.of(key);
  return { job: action.job, action };
}

/** Anthropic's models are Sonnet and Haiku only (integrations.md §1.2 decision 3). */
const ANTHROPIC_ALLOWED = /^claude-(sonnet|haiku)-/i;

/**
 * Check a whole chain before it is kept (§6.2, §6.6): each model on its provider's list, able
 * to do the job, allowed for the action, once only; Embeddings one model, and none once indexed.
 * Throws a 422 naming the field, or 409 when the embedding model is locked.
 */
async function checkChain(links, { job, action }) {
  const fields = {};
  const flag = (i, msg) => {
    fields[`links.${i}.model`] = [msg];
  };
  const cat = await aiJobs.catalogue(pool);
  const seen = new Set();
  const need = aiJobs.NEEDS[job];
  links.forEach((l, i) => {
    const m = (cat.byProvider[l.provider] || []).find((r) => r.model.toLowerCase() === l.model.toLowerCase());
    const id = `${l.provider}:${l.model.toLowerCase()}`;
    if (!m) flag(i, "Not on the list");
    else if (!(m.capabilities || []).includes(need)) flag(i, "Cannot do this job");
    else if (l.provider === "anthropic" && !ANTHROPIC_ALLOWED.test(l.model)) flag(i, "Sonnet or Haiku only");
    else if (l.provider === "deepseek" && action && action.personal_data) flag(i, "Carries personal data");
    else if (seen.has(id)) flag(i, "Picked twice");
    seen.add(id);
  });
  if (Object.keys(fields).length) {
    const first = Object.values(fields)[0][0];
    const code =
      {
        "Not on the list": "MODEL_NOT_LISTED",
        "Cannot do this job": "MODEL_CANNOT_DO_JOB",
        "Sonnet or Haiku only": "ANTHROPIC_SONNET_HAIKU",
        "Carries personal data": "DEEPSEEK_PERSONAL_DATA",
      }[first] || "CHAIN_INVALID";
    throw new AppError(code, "Check the chain", 422, fields);
  }
  if (job === "embeddings") {
    if (links.length !== 1) throw new AppError("ONE_EMBEDDING_MODEL", "Embeddings take one model", 422, { links: ["One model only"] });
    if (await repo.embeddingsIndexed(pool))
      throw new AppError("EMBEDDINGS_LOCKED", "The embedding model is locked once the Knowledge Hub is indexed", 409);
  }
  // Each model as its provider spells it.
  return links.map((l) => {
    const m = cat.byProvider[l.provider].find((r) => r.model.toLowerCase() === l.model.toLowerCase());
    return { provider: l.provider, model: m.model };
  });
}

/** Save a chain whole, audited; answers it resolved, with states. */
async function keepChain(scope, key, links, actor, payload = {}) {
  const owner = ownerOf(scope, key);
  const clean = await checkChain(links, owner);
  await tx(async (client) => {
    const before = await repo.chainRows(client, scope, key);
    await repo.replaceChain(client, scope, key, clean, userOf(actor));
    await emit(client, {
      key: EVENTS.AI_CONTROL_CHAIN_CHANGED,
      entity: { type: "ai_chain", id: `${scope}:${key}` },
      actor,
      before: before.length ? { links: before } : undefined,
      after: { links: clean },
      payload: { scope, key, ...payload },
    });
  });
  await changed();
  return chainView(scope === "job" ? await aiJobs.resolveJob(key, { db: pool }) : await aiJobs.resolve(key, { db: pool }));
}

/** PUT /ai-control/chains/:scope/:key: Edit Chain. */
function saveChain(scope, key, body, actor) {
  return keepChain(scope, key, body.links, actor);
}

/** POST /ai-control/chains/:scope/:key/first: Make First, saved as the chain it makes. */
async function makeFirst(scope, key, body, actor) {
  ownerOf(scope, key);
  const cat = await aiJobs.catalogue(pool);
  const src = aiJobs.sourceOf(cat, scope, key);
  // An action on its job's chain makes its own from it: the job's stays as it is.
  const links = src.links.map((l) => ({ provider: l.provider, model: l.model }));
  const at = body.position - 1;
  if (!links[at]) throw new AppError("NO_SUCH_POSITION", "No model at that place", 422, { position: ["No model there"] });
  const reordered = [links[at], ...links.filter((_, i) => i !== at)];
  return keepChain(scope, key, reordered, actor, { made_first: reordered[0] });
}

/** DELETE /ai-control/chains/action/:key: Use Job Chain. */
async function resetChain(key, actor) {
  ownerOf("action", key);
  await tx(async (client) => {
    const before = await repo.chainRows(client, "action", key);
    if (!before.length) return;
    await repo.deleteChain(client, "action", key);
    await emit(client, {
      key: EVENTS.AI_CONTROL_CHAIN_RESET,
      entity: { type: "ai_chain", id: `action:${key}` },
      actor,
      before: { links: before },
      payload: { scope: "action", key },
    });
  });
  await changed();
}

/* ------------------------------------------------------------------ *
 * Models and prices
 * ------------------------------------------------------------------ */

const PRICE_KEYS = ["input_usd_per_million", "output_usd_per_million", "audio_usd_per_million", "usd_per_audio_hour", "usd_per_thousand_searches"];

/** A model as the Models tab takes it, with naira at `rate`. */
function modelView(r, rate, plan, inChains) {
  return {
    ai_model_id: r.ai_model_id,
    provider: r.provider,
    model: r.model,
    display_name: r.display_name,
    capabilities: r.capabilities,
    available: r.available,
    plan,
    input_usd_per_million: r.input_usd_per_million,
    output_usd_per_million: r.output_usd_per_million,
    audio_usd_per_million: r.audio_usd_per_million,
    usd_per_audio_hour: r.usd_per_audio_hour,
    usd_per_thousand_searches: r.usd_per_thousand_searches,
    input_ngn_per_million: prices.naira(r.input_usd_per_million, rate),
    output_ngn_per_million: prices.naira(r.output_usd_per_million, rate),
    ngn_per_audio_hour: prices.naira(r.usd_per_audio_hour, rate),
    in_chains: (inChains.get(`${r.provider}:${r.model.toLowerCase()}`) || []).map((ref) => ({
      ...ref,
      label: ref.scope === "action" && actions.has(ref.key) ? actions.of(ref.key).label : null,
    })),
    proposed: Boolean(r.proposed),
    not_listed: Boolean(r.not_listed),
  };
}

/** Each AI provider's plan now. */
async function plans() {
  const out = {};
  for (const def of providers.AI) out[def.code] = await quota.plan(def.code, { db: pool });
  return out;
}

async function rateNow() {
  const n = await fx.newest({ db: pool });
  return n && n.usd_ngn ? { usd_ngn: n.usd_ngn, day: n.day } : null;
}

/** GET /ai-control/models: the models in a chain first (decision 32). */
async function models(query = {}) {
  const [inChains, rate, plan] = await Promise.all([aiJobs.chainsByModel(pool), rateNow(), plans()]);
  const page = await repo.modelPage(pool, query, [...inChains.keys()]);
  return { ...page, data: page.data.map((r) => modelView(r, rate && rate.usd_ngn, plan[r.provider], inChains)) };
}

async function modelOne(id) {
  const r = await repo.modelById(pool, id);
  if (!r) throw new AppError("NOT_FOUND", "Not found", 404);
  const [rate, plan, inChains] = await Promise.all([rateNow(), plans(), aiJobs.chainsByModel(pool)]);
  return modelView(r, rate && rate.usd_ngn, plan[r.provider], inChains);
}

/**
 * A run with no progress for this long is taken as lost, and Find Prices may be pressed again.
 * One batch, every link of its chain timing out, stays well inside it.
 */
const LOST_MS = repo.LOST_MINUTES * 60_000;

/** The newest run as the screen reads it: a run lost mid-way reads as failed, LOST. */
async function newestRun(db = pool) {
  const r = await repo.newestPriceRun(db);
  if (!r) return null;
  const lost = r.status === "running" && Date.now() - new Date(r.updated_at || r.started_at).getTime() > LOST_MS;
  return {
    ai_price_run_id: r.ai_price_run_id,
    status: lost ? "failed" : r.status,
    batches_total: r.batches_total,
    batches_done: r.batches_done,
    proposals: r.proposals,
    not_listed: r.not_listed,
    error_code: lost ? "LOST" : r.error_code || null,
    started_at: iso(r.started_at),
    finished_at: iso(r.finished_at),
    lost,
  };
}

/** The providers Find Prices can ask about: those with a key. */
async function keyedProviders() {
  const cat = await aiJobs.catalogue(pool);
  return providers.AI.map((def) => def.code).filter((code) => cat.keyed.has(code));
}

/** GET /ai-control/models/summary */
async function modelsSummary() {
  const [run, waiting, rate, keyed] = await Promise.all([newestRun(), repo.openProposals(pool), rateNow(), keyedProviders()]);
  const counts = await repo.priceCounts(pool, keyed);
  const { lost, ...shown } = run || {};
  return {
    finding: Boolean(run) && run.status === "running",
    run: run ? shown : null,
    last_found_at: run && run.status !== "running" ? run.finished_at || run.started_at : null,
    proposals: waiting,
    to_price: counts ? counts.to_price : 0,
    not_listed: counts ? counts.not_listed : 0,
    rate,
  };
}

/** A save's prices: each blank one is no price. */
const pricesOf = (body) => Object.fromEntries(PRICE_KEYS.map((k) => [k, body[k] === undefined || body[k] === "" ? null : body[k]]));

/** Write a model's prices through the module that owns the list, audited here. */
async function keepPrices(client, id, values, actor, payload) {
  const before = await repo.modelById(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Not found", 404);
  const after = await integrations.setModelPrices(client, id, values);
  await emit(client, {
    key: EVENTS.AI_CONTROL_PRICE_SET,
    entity: { type: "ai_model", id },
    actor,
    before: Object.fromEntries(PRICE_KEYS.map((k) => [k, before[k]])),
    after: Object.fromEntries(PRICE_KEYS.map((k) => [k, after[k]])),
    payload: { provider: before.provider, model: before.model, ...payload },
  });
}

/** PUT /ai-control/models/:id/prices: Edit Price. */
async function setPrices(id, body, actor) {
  await tx((client) => keepPrices(client, id, pricesOf(body), actor, { source: "edit" }));
  await changed();
  return modelOne(id);
}

const ALREADY_FINDING = () => new AppError("ALREADY_FINDING", "Find Prices is already running", 409);

/** POST /ai-control/prices/find: 202; the ai-find-prices job searches (runFindPrices). Also Find More. */
async function findPrices(actor) {
  const run = await newestRun();
  if (run && run.status === "running") throw ALREADY_FINDING();
  try {
    const started = await tx(async (client) => {
      if (run && run.lost) await repo.finishPriceRun(client, run.ai_price_run_id, "failed", "LOST");
      const row = await repo.startPriceRun(client, userOf(actor));
      await emit(client, {
        key: EVENTS.AI_CONTROL_PRICES_REQUESTED,
        entity: { type: "ai_price_run", id: row.ai_price_run_id },
        actor,
        payload: { ai_price_run_id: row.ai_price_run_id },
      });
      return row;
    });
    return { requested_at: iso(started.started_at) };
  } catch (err) {
    // Another press started one in the same instant (ai_price_run_one_running_uq).
    if (err.code === "23505" && err.constraint === "ai_price_run_one_running_uq") throw ALREADY_FINDING();
    throw err;
  }
}

/** POST /ai-control/prices/accept-all: every open proposal, as proposed (decision 31). */
async function acceptAll(actor) {
  const accepted = await tx(async (client) => {
    const open = await repo.openProposalsForUpdate(client);
    for (const p of open) {
      await keepPrices(client, p.ai_model_id, Object.fromEntries(PRICE_KEYS.map((k) => [k, p[k]])), actor, { source: "proposal", source_url: p.source_url });
      await repo.decideProposal(client, p.ai_price_proposal_id, "accepted", userOf(actor));
    }
    return open.length;
  });
  if (accepted) await changed();
  return { accepted };
}

/** GET /ai-control/prices */
function proposals(query = {}) {
  return repo.proposalPage(pool, query);
}

/** POST /ai-control/prices/:id/accept: the proposal's prices, as IT left them. */
async function acceptProposal(id, body, actor) {
  const modelId = await tx(async (client) => {
    const p = await repo.openProposal(client, id);
    if (!p) throw new AppError("NOT_FOUND", "That proposal is no longer open", 404);
    const values = pricesOf(body);
    const edited = PRICE_KEYS.some((k) => (values[k] === null ? null : money.money(values[k]).toString()) !== (p[k] === null ? null : money.money(p[k]).toString()));
    await keepPrices(client, p.ai_model_id, values, actor, { source: edited ? "proposal_edited" : "proposal", source_url: p.source_url });
    await repo.decideProposal(client, id, "accepted", userOf(actor));
    return p.ai_model_id;
  });
  await changed();
  return modelOne(modelId);
}

/** POST /ai-control/prices/:id/dismiss */
async function dismissProposal(id, actor) {
  await tx(async (client) => {
    const p = await repo.openProposal(client, id);
    if (!p) throw new AppError("NOT_FOUND", "That proposal is no longer open", 404);
    await repo.decideProposal(client, id, "dismissed", userOf(actor));
  });
}

/** Each provider's own website: a proposal's page must be on it (§6.4). */
const SITES = Object.freeze({
  gemini: { url: "https://ai.google.dev/gemini-api/docs/pricing", hosts: ["ai.google.dev", "cloud.google.com", "developers.googleblog.com"] },
  groq: { url: "https://groq.com/pricing", hosts: ["groq.com"] },
  openai: { url: "https://openai.com/api/pricing", hosts: ["openai.com"] },
  anthropic: { url: "https://docs.claude.com/en/docs/about-claude/pricing", hosts: ["anthropic.com", "claude.com"] },
  deepseek: { url: "https://api-docs.deepseek.com/quick_start/pricing", hosts: ["deepseek.com"] },
});

const onSite = (url, provider) => {
  try {
    const u = new URL(String(url));
    return u.protocol === "https:" && SITES[provider].hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
};

/**
 * The page a proposal cites: the one the model named when it is on the provider's site, else
 * the first page Google Search returned, else the provider's pricing page.
 */
function sourceFor(url, sources, provider) {
  if (onSite(url, provider)) return String(url);
  const found = (sources || []).find((s) => /^https:\/\//.test(s.url));
  return found ? found.url : SITES[provider].url;
}

/** Models to a request: an answer for 20 has room to spare (§6.4). */
const BATCH = 20;

/** A failure that ends the run: nothing after it can answer either. */
const ENDS_RUN = new Set(["NO_SEARCH_MODEL", "AI_DISABLED", "AI_MODULE_DISABLED", "AI_CAP_REACHED"]);

/**
 * Find Prices' search, the `ai-find-prices` job (§6.4): every model a run should ask about, 20 to
 * a request, one provider per request, through the find-prices action. Each request's proposals
 * are kept as it returns, the models it did not price are marked Not Listed, and the run's
 * progress moves, so the New Prices sheet fills as it goes. Nothing is saved to a model here.
 *
 * Delivery is at least once, so the run is claimed first: a second delivery, or a run already
 * ended, asks nothing. A run taken as lost (Find Prices pressed again) stops at its next batch.
 * @param {{runId: string, actor?: string|null, llm?: object}} opts  llm: tests
 */
async function runFindPrices({ runId, actor = null, llm = ai }) {
  if (!(await repo.claimPriceRun(pool, runId))) return newestRun();
  try {
    await askInBatches(runId, actor, llm);
  } catch (err) {
    await repo.finishPriceRun(pool, runId, "failed", "RUN_FAILED");
    throw err;
  }
  return newestRun();
}

async function askInBatches(id, actor, llm) {
  const batches = [];
  for (const code of await keyedProviders()) {
    const def = providers.get(code);
    const list = await repo.modelsToPrice(pool, code);
    for (let i = 0; i < list.length; i += BATCH) batches.push({ def, models: list.slice(i, i + BATCH) });
  }
  if (!(await repo.progressPriceRun(pool, id, { total: batches.length }))) return;
  let read = 0;
  let firstError = null;
  for (const { def, models: batch } of batches) {
    let res;
    try {
      res = await llm.search({
        purpose: "find-prices",
        module: "ai_control",
        actor,
        input: {
          provider: def.name,
          website: SITES[def.code].url,
          models: batch.map((m) => ({ model: m.model, name: m.display_name, does: m.capabilities.join(", ") })),
        },
      });
    } catch (err) {
      const code = err.code || "AI_UNAVAILABLE";
      firstError = firstError || code;
      logger.warn({ provider: def.code, code, err: err.message }, "find prices: the search did not answer");
      if (ENDS_RUN.has(code) || !(await repo.progressPriceRun(pool, id, { done: 1 }))) break;
      continue;
    }
    const parsed = parseStructured(res.text, c.ai_control.FindPricesAnswer);
    if (!parsed.ok) {
      firstError = firstError || "ANSWER_UNREADABLE";
      logger.warn({ provider: def.code, issues: parsed.issues }, "find prices: the answer could not be read");
      if (!(await repo.progressPriceRun(pool, id, { done: 1 }))) break;
      continue;
    }
    read += 1;
    const byId = new Map(batch.map((m) => [m.model.toLowerCase(), m]));
    const rows = [];
    for (const p of parsed.value.prices) {
      const m = byId.get(String(p.model).toLowerCase());
      if (!m || !PRICE_KEYS.some((k) => p[k] !== null)) continue;
      byId.delete(String(p.model).toLowerCase());
      rows.push({ ai_model_id: m.ai_model_id, ...Object.fromEntries(PRICE_KEYS.map((k) => [k, p[k]])), source_url: sourceFor(p.source_url, res.sources, def.code) });
    }
    const unpriced = [...byId.values()].map((m) => m.ai_model_id);
    const kept = await tx(async (client) => {
      if (!(await repo.lockRunningRun(client, id))) return false;
      const n = await repo.addProposals(client, res.run_id, rows);
      await repo.markNotListed(client, unpriced);
      await repo.progressPriceRun(client, id, { done: 1, proposals: n, notListed: unpriced.length });
      if (n)
        await emit(client, {
          key: EVENTS.AI_CONTROL_PRICES_PROPOSED,
          entity: { type: "ai_price_run", id },
          actor,
          payload: { provider: def.code, proposals: n, not_listed: unpriced.length },
        });
      return true;
    });
    if (!kept) break;
  }
  // Done when any answer was read, keeping the first error so the sheet can say some were not.
  await repo.finishPriceRun(pool, id, batches.length > 0 && read === 0 ? "failed" : "done", firstError);
}

/* ------------------------------------------------------------------ *
 * Spend and caps
 * ------------------------------------------------------------------ */

/** GET /ai-control/spend: this Lagos month. */
async function spend() {
  const now = new Date();
  const { from, to } = governance.monthWindow(now);
  const today = lagos.today(now);
  const month = `${today.slice(0, 7)}-01`;
  const [total, byProvider, limits, s, days, rate, plan, cat, refusals, nightly] = await Promise.all([
    governance.spentThisMonth(pool, now),
    governance.spentByProvider(pool, now),
    governance.caps(pool),
    governance.settings(pool),
    repo.spendByDay(pool, from, to),
    rateNow(),
    plans(),
    aiJobs.catalogue(pool),
    repo.praxisRefusals(pool, from, to),
    repo.latestAttackRun(pool),
  ]);
  const byDay = new Map(days.map((d) => [d.day, money.toWire(d.spent)]));
  const series = [];
  for (let d = month; d <= today; d = lagos.addDays(d, 1)) series.push({ day: d, spent_ngn: byDay.get(d) || "0.00" });
  return {
    month,
    rate,
    overall: {
      spent_ngn: total,
      cap_ngn: s.monthly_cap_ngn,
      at_cap: s.monthly_cap_ngn !== null && money.compare(total, s.monthly_cap_ngn) >= 0,
    },
    providers: providers.AI.map((def) => {
      const spent = (byProvider[def.code] && byProvider[def.code].spent_ngn) || "0.00";
      const cap = limits[def.code] === undefined ? null : limits[def.code];
      return {
        provider: def.code,
        plan: plan[def.code],
        set_up: cat.keyed.has(def.code),
        spent_ngn: spent,
        cap_ngn: cap,
        at_cap: cap !== null && money.compare(spent, cap) >= 0,
        calls: (byProvider[def.code] && byProvider[def.code].calls) || 0,
      };
    }),
    days: series,
    praxis_ai: { reads_refused: refusals.reads_refused, presses_refused: refusals.presses_refused, nightly: nightly ? attackRunView(nightly) : null },
  };
}

/** One run of the attack suite as the wire carries it (AiAttackRun). */
function attackRunView(row) {
  return {
    ai_attack_run_id: row.ai_attack_run_id,
    environment: row.environment,
    run_by: row.run_by,
    status: row.status,
    asked: row.asked,
    passed: row.passed,
    leaks: Array.isArray(row.leaks) ? row.leaks : [],
    error_code: row.error_code || null,
    started_at: iso(row.started_at),
    finished_at: iso(row.finished_at),
  };
}

/**
 * The attack suite reports a run (scripts/ai/attack-assistant.js; praxis-ai.md §6.17): the row is
 * kept for Spend, audited, and a leak is told to whoever may change AI Control, urgently.
 * @param {{environment: string, run_by: "nightly"|"hand", status: string, asked: number, passed: number, leaks: Array<{id: string, as: string, problems: string[]}>, error_code?: string|null, started_at: Date|string}} result
 * @returns {Promise<object>} AiAttackRun
 */
async function recordAttackRun(result) {
  const row = await tx(async (client) => {
    const r = await repo.insertAttackRun(client, { ...result, leaks: (result.leaks || []).slice(0, 50) });
    const entity = { type: "ai_attack_run", id: r.ai_attack_run_id };
    await emit(client, { key: EVENTS.AI_CONTROL_ATTACK_RUN_RECORDED, entity, actor: null, payload: { environment: r.environment, run_by: r.run_by, status: r.status, asked: r.asked, passed: r.passed, leaks: r.leaks.length } });
    if (r.status === "leaked") {
      const first = r.leaks[0] ? `${r.leaks[0].id} as ${r.leaks[0].as}` : null;
      await emit(client, { key: EVENTS.AI_CONTROL_ATTACK_LEAKED, entity, actor: null, payload: { environment: r.environment, run_by: r.run_by, asked: r.asked, leaks: r.leaks.length, first } });
    }
    return r;
  });
  return attackRunView(row);
}

/** GET /ai-control/spend/actions: this month by action, 25 a page. */
async function spendActions(query = {}) {
  const { from, to } = governance.monthWindow(new Date());
  const page = await repo.spendByAction(pool, from, to, query);
  return {
    ...page,
    data: page.data.map((r) => {
      const a = actions.has(r.key) ? actions.of(r.key) : null;
      return { key: r.key, label: a ? a.label : r.key, job: a ? a.job : null, calls: r.calls, spent_ngn: money.toWire(r.spent) };
    }),
  };
}

const capOf = (body) => (body.monthly_cap_ngn === undefined || body.monthly_cap_ngn === "" ? null : body.monthly_cap_ngn);

/** PUT /ai-control/caps/:provider: a paid provider's monthly cap. */
async function setCap(provider, body, actor) {
  if ((await quota.plan(provider, { db: pool })) !== "paid")
    throw new AppError("NOT_PAID", "Only a paid provider has a cap", 422, { monthly_cap_ngn: ["Free plan"] });
  const cap = capOf(body);
  await tx(async (client) => {
    const before = await repo.capOf(client, provider);
    await repo.setCap(client, provider, cap, userOf(actor));
    await emit(client, {
      key: EVENTS.AI_CONTROL_CAP_CHANGED,
      entity: { type: "ai_provider_cap", id: provider },
      actor,
      before: before ? { monthly_cap_ngn: before.monthly_cap_ngn } : undefined,
      after: { monthly_cap_ngn: cap },
      payload: { provider, monthly_cap_ngn: cap },
    });
  });
  await changed();
  return spend();
}

/** PUT /ai-control/cap: the cap on all AI. */
async function setOverallCap(body, actor) {
  const cap = capOf(body);
  await tx(async (client) => {
    const before = await repo.overallCap(client);
    await repo.setOverallCap(client, cap, userOf(actor));
    await emit(client, {
      key: EVENTS.AI_CONTROL_CAP_CHANGED,
      entity: { type: "ai_setting", id: before ? before.ai_setting_id : "new" },
      actor,
      before: before ? { monthly_cap_ngn: before.monthly_cap_ngn } : undefined,
      after: { monthly_cap_ngn: cap },
      payload: { provider: "all", monthly_cap_ngn: cap },
    });
  });
  await changed();
  return spend();
}

module.exports = {
  jobs,
  actions: actionList,
  saveChain,
  makeFirst,
  resetChain,
  models,
  modelsSummary,
  setPrices,
  findPrices,
  proposals,
  acceptAll,
  acceptProposal,
  dismissProposal,
  runFindPrices,
  spend,
  spendActions,
  recordAttackRun,
  attackRunView,
  setCap,
  setOverallCap,
  SITES,
  sourceFor,
};
