"use strict";
/**
 * Which model answers each AI call (docs/guides/ai-control.md §6.1). Every AI feature is an
 * action (actions.js) under a job; each job, and an action that has its own, has a chain: a first
 * choice and up to three fallbacks.
 *
 *   const links = await jobs.walk("policy-tidy");        // the models to try now, in order
 *   // → [{ provider: "gemini", model: "gemini-3.8-flash", display_name: "Gemini 3.8 Flash", position: 1 }]
 *   const chain = await jobs.resolve("policy-tidy");     // the whole chain, each model with its state
 *
 * Where a chain comes from, first found:
 *   1. the action's chain saved on AI Control (ai_chain, scope "action");
 *   2. the action's own chain in the registry (Data Answers: Flash, then Pro);
 *   3. its job's chain saved on AI Control (ai_chain, scope "job");
 *   4. its job's chain in code (CHAINS): for each provider in order, the best model of a family
 *      on its list, in the order the code prefers below. A new key works without anyone picking a
 *      model, and a model a provider withdraws is passed over once the key's list stops naming it.
 *
 * Each model's state: Not Set Up (no key), Not on Key (the key's list no longer names it),
 * Personal Data (DeepSeek on an action that carries it), Cannot Search (an action that searches,
 * on a provider that cannot), At Cap (the provider's monthly cap), Daily Limit (a Free plan's
 * limit used), Skipped (the provider said its quota is used up, until the time it gave), else
 * Ready. walk() answers the Ready ones; the caller tries them in order (llm.service,
 * transcription.js).
 */
const settings = require("../../shared/integrations/settings");
const quota = require("../../shared/integrations/quota");
const actions = require("./actions");
const skips = require("./skips");

const JOBS = Object.freeze(["default", "fast", "deep_reasoning", "image_reading", "transcription", "embeddings", "top_tier"]);

/** Each job's providers in order, and the family of model each one is asked for. */
const CHAINS = Object.freeze({
  default: [["gemini", "flash"]],
  fast: [["gemini", "flash_lite"]],
  deep_reasoning: [["gemini", "pro"]],
  image_reading: [["gemini", "flash"]],
  transcription: [["groq", "whisper"], ["gemini", "flash"]],
  embeddings: [["openai", "embedding_small"]],
  top_tier: [["gemini", "pro"], ["anthropic", "sonnet"]],
});

/** What a job's models must do (§6.2). */
const NEEDS = Object.freeze({
  default: "text",
  fast: "text",
  deep_reasoning: "text",
  image_reading: "image",
  transcription: "audio",
  embeddings: "embeddings",
  top_tier: "text",
});

/** The providers that can search the web for an action that needs it: Gemini, with Google Search. */
const SEARCHES = new Set(["gemini"]);

/** A version from an id ("gemini-3.8-flash" → [3, 8]), for newest first. */
const versionOf = (re, id) => {
  const m = re.exec(id);
  return m && m[1] ? m[1].split(/[.-]/).map(Number) : [];
};

/** A stable model before a preview or an experiment. */
const stable = (id) => !/(preview|exp|latest)/i.test(id);

/**
 * How each family is matched and ranked: `match` says whether a model belongs, `order` lists
 * exact ids to prefer first, `version` reads the version to rank the rest newest first.
 */
const FAMILIES = Object.freeze({
  flash: { match: /^gemini-(\d+(?:\.\d+)?)-flash(?:-(?:preview|exp)[\w.-]*)?$/i, needs: "text" },
  flash_lite: { match: /^gemini-(\d+(?:\.\d+)?)-flash-lite(?:-(?:preview|exp)[\w.-]*)?$/i, needs: "text" },
  pro: { match: /^gemini-(\d+(?:\.\d+)?)-pro(?:-(?:preview|exp)[\w.-]*)?$/i, needs: "text" },
  // The more accurate Whisper first: a transcript must be right (decision 6).
  whisper: { match: /whisper/i, order: ["whisper-large-v3", "whisper-large-v3-turbo"], needs: "audio" },
  embedding_small: { match: /embedding/i, order: ["text-embedding-3-small"], needs: "embeddings" },
  sonnet: { match: /^claude-sonnet-(\d+(?:-\d+)?)$/i, needs: "text" },
});

function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (b[i] || 0) - (a[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * The best model of a family among a provider's models, or null.
 * @param {string} family
 * @param {Array<{model: string, display_name: string, capabilities: string[], available: boolean|null}>} models
 */
function best(family, models) {
  const f = FAMILIES[family];
  const usable = models.filter(
    (m) => m.available !== false && f.match.test(m.model) && (m.capabilities || []).includes(f.needs),
  );
  if (!usable.length) return null;
  const rank = (m) => {
    const i = (f.order || []).indexOf(String(m.model).toLowerCase());
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  usable.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      Number(stable(b.model)) - Number(stable(a.model)) ||
      compareVersions(versionOf(f.match, a.model), versionOf(f.match, b.model)) ||
      String(a.model).localeCompare(String(b.model)),
  );
  return usable[0];
}

/** A chain in code as links: the best model of each family, from each provider's whole list. */
function fromPairs(pairs, byProvider) {
  const out = [];
  for (const [provider, family] of pairs) {
    const m = best(family, byProvider[provider] || []);
    if (m) out.push({ provider, model: m.model, display_name: m.display_name, position: out.length + 1 });
  }
  return out;
}

/**
 * A job's chain in code from model lists already in hand, set-up providers only: pure, for tests
 * and for the test before a save, which has a typed key's list and nothing stored.
 * @param {string} job
 * @param {Record<string, Array<object>>} byProvider  each set-up provider's models
 */
function chainFrom(job, byProvider) {
  if (!CHAINS[job]) throw new Error(`ai jobs: no job "${job}"`);
  return fromPairs(
    CHAINS[job].filter(([provider]) => byProvider[provider]),
    byProvider,
  );
}

const TTL_MS = 30_000;
let memo = { at: 0, version: undefined, value: null };

const notMigrated = (err) => err && (err.code === "42P01" || err.code === "42703");

/**
 * Everything a chain is worked out from: every AI provider's model list, which providers have a
 * key, and the chains saved on AI Control. Kept until Settings · Integrations or AI Control
 * changes something (the settings version), else 30 seconds.
 */
async function catalogue(db) {
  const v = await settings.version();
  if (memo.value && (v === null ? Date.now() - memo.at < TTL_MS : memo.version === v)) return memo.value;
  const providers = require("../../shared/integrations/providers");
  let models = [];
  let links = [];
  try {
    ({ rows: models } = await db.query(
      `SELECT ai_model_id, provider, model::text AS model, display_name, capabilities, available
         FROM ai_model ORDER BY provider, model`,
    ));
  } catch (err) {
    if (!notMigrated(err)) throw err;
  }
  try {
    ({ rows: links } = await db.query(
      `SELECT c.scope, c.key, c.position, c.provider, c.model::text AS model, c.updated_at,
              trim(e.first_name || ' ' || e.last_name) AS updated_by_name
         FROM ai_chain c
         LEFT JOIN app_user u ON u.user_id = c.updated_by
         LEFT JOIN employee e ON e.employee_id = u.employee_id
        ORDER BY c.scope, c.key, c.position`,
    ));
  } catch (err) {
    if (!notMigrated(err)) throw err;
  }
  const byProvider = {};
  const keyed = new Set();
  for (const def of providers.AI) {
    byProvider[def.code] = models.filter((r) => r.provider === def.code);
    if (await settings.secret(def.code, "api_key", { db })) keyed.add(def.code);
  }
  const stored = new Map();
  for (const l of links) {
    const id = `${l.scope}:${l.key}`;
    const c = stored.get(id) || { links: [], updated_by_name: null, updated_at: null };
    c.links.push({ position: l.position, provider: l.provider, model: l.model });
    if (!c.updated_at || l.updated_at > c.updated_at) {
      c.updated_at = l.updated_at;
      c.updated_by_name = l.updated_by_name || null;
    }
    stored.set(id, c);
  }
  const value = { byProvider, keyed, stored };
  memo = { at: Date.now(), version: v, value };
  return value;
}

/** Each AI provider whose key is set up and readable, with its model list. */
async function lists(db) {
  const cat = await catalogue(db);
  const out = {};
  for (const p of cat.keyed) out[p] = cat.byProvider[p];
  return out;
}

const modelOf = (cat, provider, model) =>
  (cat.byProvider[provider] || []).find((m) => m.model.toLowerCase() === String(model).toLowerCase()) || null;

/** A stored chain as links, each with its model's name. */
function storedLinks(cat, rows) {
  return rows.links.map((l, i) => {
    const m = modelOf(cat, l.provider, l.model);
    return { provider: l.provider, model: m ? m.model : l.model, display_name: m ? m.display_name : l.model, position: i + 1 };
  });
}

/**
 * Where a chain comes from (the header's order): the scope and key that own it, whether it is
 * saved, and its links before any state.
 * @param {"job"|"action"} scope
 * @param {string} key
 */
function sourceOf(cat, scope, key) {
  const shape = (s, k, stored, rows, links) => ({
    scope: s,
    key: k,
    stored,
    links,
    updated_by_name: rows ? rows.updated_by_name : null,
    updated_at: rows ? rows.updated_at : null,
  });
  if (scope === "action") {
    const a = actions.of(key);
    const own = cat.stored.get(`action:${key}`);
    if (own) return shape("action", key, true, own, storedLinks(cat, own));
    if (a.chain) return shape("action", key, false, null, fromPairs(a.chain, cat.byProvider));
    return sourceOf(cat, "job", a.job);
  }
  if (!CHAINS[key]) throw new Error(`ai jobs: no job "${key}"`);
  const saved = cat.stored.get(`job:${key}`);
  if (saved) return shape("job", key, true, saved, storedLinks(cat, saved));
  return shape("job", key, false, null, fromPairs(CHAINS[key], cat.byProvider));
}

/**
 * Each model's state now (§6.1 step 2), for an action or, with none, a job's own card.
 * @param {object} cat
 * @param {Array<object>} links
 * @param {object|null} action
 * @param {{query: Function}} db
 */
async function withStates(cat, links, action, db) {
  const capped = await require("./governance").atCap(db);
  const out = [];
  for (const l of links) {
    const m = modelOf(cat, l.provider, l.model);
    let state = "ready";
    let until = null;
    if (!cat.keyed.has(l.provider)) state = "not_set_up";
    else if (!m || m.available === false) state = "not_on_key";
    else if (action && action.personal_data && l.provider === "deepseek") state = "personal_data";
    else if (action && action.searches && !SEARCHES.has(l.provider)) state = "cannot_search";
    else if (capped.has(l.provider)) state = "at_cap";
    else if (await quota.spent(l.provider, { db })) state = "daily_limit";
    else {
      const at = await skips.until(l.provider);
      if (at) {
        state = "skipped";
        until = at.toISOString();
      }
    }
    out.push({ ...l, state, until });
  }
  return out;
}

const pool = () => require("../../config/db").pool;

/**
 * An action's chain, each model with its state. An action the registry does not hold (a test's
 * own prompt) answers on the Default job's chain; scripts/check/ai-actions.js keeps src/ from
 * calling one.
 * @param {string} actionKey
 * @param {{db?: {query: Function}}} [opts]
 */
async function resolve(actionKey, { db = pool() } = {}) {
  const cat = await catalogue(db);
  const action = actions.has(actionKey) ? actions.of(actionKey) : null;
  const src = action && !action.direct ? sourceOf(cat, "action", actionKey) : sourceOf(cat, "job", "default");
  return { ...src, links: await withStates(cat, src.links, action, db) };
}

/**
 * A job's own chain, each model with its state, for its card on AI Control · Actions.
 * @param {string} job
 * @param {{db?: {query: Function}}} [opts]
 */
async function resolveJob(job, { db = pool() } = {}) {
  const cat = await catalogue(db);
  const src = sourceOf(cat, "job", job);
  return { ...src, links: await withStates(cat, src.links, null, db) };
}

/**
 * The models to try now for an action, in order: its chain's Ready ones.
 * @param {string} actionKey
 * @param {{db?: {query: Function}}} [opts]
 * @returns {Promise<Array<{provider: string, model: string, display_name: string, position: number}>>}
 */
async function walk(actionKey, opts) {
  return (await resolve(actionKey, opts)).links
    .filter((l) => l.state === "ready")
    .map(({ provider, model, display_name, position }) => ({ provider, model, display_name, position }));
}

/**
 * A job's chain as its set-up providers can answer it, without states: first choice, then each
 * fallback (governance's Default model reads it).
 * @param {string} job
 * @param {{db?: {query: Function}}} [opts]
 */
async function chain(job, { db = pool() } = {}) {
  const cat = await catalogue(db);
  return sourceOf(cat, "job", job)
    .links.filter((l) => cat.keyed.has(l.provider) && (modelOf(cat, l.provider, l.model) || {}).available !== false)
    .map((l, i) => ({ ...l, position: i + 1 }));
}

/**
 * Every job one provider's models do, for its card on Settings · Integrations, from the chains in
 * use (saved or in code).
 * @param {string} provider
 * @param {{db?: {query: Function}}} [opts]
 */
async function inUse(provider, { db = pool() } = {}) {
  const cat = await catalogue(db);
  const out = [];
  for (const job of JOBS)
    for (const l of sourceOf(cat, "job", job).links)
      if (l.provider === provider) out.push({ job, position: l.position, model: l.model, display_name: l.display_name });
  return out;
}

/**
 * Every job one provider's models would do from lists in hand, chains in code only: pure, for
 * the test before a save.
 * @param {string} provider
 * @param {Record<string, Array<object>>} byProvider
 */
function inUseBy(provider, byProvider) {
  const out = [];
  for (const job of JOBS)
    for (const c of chainFrom(job, byProvider))
      if (c.provider === provider) out.push({ job, position: c.position, model: c.model, display_name: c.display_name });
  return out;
}

/**
 * Every chain a model is in now (saved or in code), for AI Control · Models.
 * @param {{query: Function}} db
 * @returns {Promise<Map<string, Array<{scope: string, key: string, position: number}>>>} keyed "provider:model"
 */
async function chainsByModel(db = pool()) {
  const cat = await catalogue(db);
  const out = new Map();
  const add = (scope, key, links) => {
    for (const l of links) {
      const id = `${l.provider}:${String(l.model).toLowerCase()}`;
      out.set(id, [...(out.get(id) || []), { scope, key, position: l.position }]);
    }
  };
  for (const job of JOBS) add("job", job, sourceOf(cat, "job", job).links);
  for (const a of actions.listed()) {
    const src = sourceOf(cat, "action", a.key);
    if (src.scope === "action") add("action", a.key, src.links);
  }
  return out;
}

/** Tests, and after a save or a test changes a list or a chain in this process. */
function forget() {
  memo = { at: 0, version: undefined, value: null };
}

module.exports = {
  JOBS,
  CHAINS,
  NEEDS,
  SEARCHES,
  FAMILIES,
  best,
  fromPairs,
  chainFrom,
  catalogue,
  lists,
  sourceOf,
  resolve,
  resolveJob,
  walk,
  chain,
  inUse,
  inUseBy,
  chainsByModel,
  forget,
};
