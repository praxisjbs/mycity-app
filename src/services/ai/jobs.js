"use strict";
/**
 * Which model does each AI job, until AI Control is built (docs/guides/integrations.md §1.2;
 * docs/guides/ai-control.md §6.2). Each job has a chain of providers in order; each provider's
 * model is the best one on its list that the key can use, in the order the code prefers below.
 * A new key therefore works without anyone picking a model, and a model Google withdraws is
 * passed over once the key's list stops naming it.
 *
 *   const [first] = await jobs.chain("default");
 *   // → { provider: "gemini", model: "gemini-3.8-flash", display_name: "Gemini 3.8 Flash", position: 1 }
 *
 * A provider is in a chain only when its key is set up and readable. `available` false (the key's
 * list no longer names the model) leaves a model out; null (the list not read yet) keeps it in.
 * AI Control (PR2) replaces CHAINS with the chains IT sets.
 */
const settings = require("../../shared/integrations/settings");

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

/**
 * A job's chain from model lists already in hand: pure, for tests and for the test before a
 * save, which has a typed key's list and nothing stored.
 * @param {string} job
 * @param {Record<string, Array<object>>} byProvider  each set-up provider's models
 */
function chainFrom(job, byProvider) {
  if (!CHAINS[job]) throw new Error(`ai jobs: no job "${job}"`);
  const out = [];
  for (const [provider, family] of CHAINS[job]) {
    const models = byProvider[provider];
    if (!models) continue;
    const m = best(family, models);
    if (m) out.push({ provider, model: m.model, display_name: m.display_name, position: out.length + 1 });
  }
  return out;
}

const TTL_MS = 30_000;
let memo = { at: 0, version: undefined, value: null };

/** Each AI provider whose key is set up and readable, with its model list. */
async function lists(db) {
  const v = await settings.version();
  if (memo.value && (v === null ? Date.now() - memo.at < TTL_MS : memo.version === v)) return memo.value;
  const providers = require("../../shared/integrations/providers");
  let rows = [];
  try {
    ({ rows } = await db.query(
      `SELECT provider, model::text AS model, display_name, capabilities, available
         FROM ai_model ORDER BY provider, model`,
    ));
  } catch (err) {
    if (!(err && (err.code === "42P01" || err.code === "42703"))) throw err;
  }
  const value = {};
  for (const def of providers.AI) {
    const key = await settings.secret(def.code, "api_key", { db });
    if (key) value[def.code] = rows.filter((r) => r.provider === def.code);
  }
  memo = { at: Date.now(), version: v, value };
  return value;
}

/**
 * A job's chain from the stored model lists: first choice, then each fallback.
 * @param {string} job
 * @param {{db?: {query: Function}}} [opts]
 * @returns {Promise<Array<{provider: string, model: string, display_name: string, position: number}>>}
 */
async function chain(job, { db = require("../../config/db").pool } = {}) {
  return chainFrom(job, await lists(db));
}

/**
 * Every job one provider's models do, for its card on Settings · Integrations.
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

/** Tests, and after a save or a test changes a list in this process. */
function forget() {
  memo = { at: 0, version: undefined, value: null };
}

module.exports = { JOBS, CHAINS, FAMILIES, best, chainFrom, chain, lists, inUseBy, forget };
