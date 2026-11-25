"use strict";
/**
 * ⌘K made ready before the API takes traffic (docs/guides/foundation.md §6.7; QA BG-049). The
 * first search in a fresh process used to pay for what every later one finds done: the User
 * Guide's chapters read and word-indexed, a connection opened, and pg_trgm looked up. The boot
 * does that work once, before it listens:
 *
 *   const out = await require("./shared/search/warm").warm({ db: pool });
 *   // → { outcome: "ready" | "timed_out" | "failed", ms, steps: { guide_section: "ready", trigram: "ready" } }
 *
 *   providers   each search provider's own `warm()`, when it declares one (the User Guide's group
 *               reads and indexes the chapters); one that fails costs only itself
 *   database    one pooled connection opened, and pg_trgm looked up as every search does; when it
 *               is there, one similarity asked, so the extension's library is loaded
 *
 * Warming is never a reason to stay down: it waits at most `timeoutMs` (10 seconds), and a step
 * that fails or a wait that runs out is logged and the boot carries on. Search then pays the cost
 * on first use, as before.
 */
const { logger } = require("../../config/logger");
const registry = require("./registry");
const { trigramReady } = require("./search.service");

/** How long the boot waits for search to warm before it listens regardless. */
const WARM_WITHIN_MS = 10_000;

/**
 * @param {{db: {connect: () => Promise<object>}, timeoutMs?: number, providers?: Array<object>}} opts
 * @returns {Promise<{outcome: "ready"|"timed_out"|"failed", ms: number, steps: Record<string, string>}>}
 */
async function warm({ db, timeoutMs = WARM_WITHIN_MS, providers = null }) {
  const started = Date.now();
  const steps = {};

  const work = (async () => {
    for (const p of providers || registry.providers()) {
      if (typeof p.warm !== "function") continue;
      try {
        await p.warm();
        steps[p.type] = "ready";
      } catch (err) {
        steps[p.type] = "failed";
        logger.warn({ err, search_type: p.type }, "search: a provider could not warm; it prepares on first use");
      }
    }
    const client = await db.connect();
    try {
      const ready = await trigramReady(client);
      if (ready) await client.query("SELECT word_similarity('warm', 'warm')");
      steps.trigram = ready ? "ready" : "missing";
    } finally {
      client.release();
    }
  })();

  let timer;
  const bound = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timed_out"), timeoutMs);
  });
  let outcome;
  try {
    outcome = await Promise.race([work.then(() => "ready"), bound]);
  } catch (err) {
    outcome = "failed";
    logger.warn({ err, steps }, "search: warming failed; the first search prepares instead");
  } finally {
    clearTimeout(timer);
  }
  // Work still running past the wait finishes or fails on its own, quietly.
  if (outcome === "timed_out") work.catch(() => {});
  const ms = Date.now() - started;
  if (outcome === "ready") logger.info({ ms, steps }, "search warmed");
  else if (outcome === "timed_out") logger.warn({ ms, steps, within_ms: timeoutMs }, "search: warming took too long; the API listens regardless");
  return { outcome, ms, steps };
}

module.exports = { warm, WARM_WITHIN_MS };
