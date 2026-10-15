"use strict";
/**
 * ⌘K's record search: one term, every module that answers for it, and only what this
 * person may open (MILESTONES §15: "⌘K finds every page, tab and record the user may
 * open, and nothing they may not"). Pages and tabs are the staff app's own registry;
 * this is the records half.
 *
 *   const r = await searchService.search(pool, req.user, { q: "ada", page: 1 });
 *   // → { q: "ada", hint: null, groups: [{ type, module, label, page, items: [...] }] }
 *
 * Who sees what. For every provider's module the service asks the question
 * requirePermission asks (`view`, middleware/rbac.scopeFor) BEFORE any provider runs.
 * A provider whose module the person cannot view is never queried, so its rows cannot
 * leak through a count, a timing or an error. Within a module the person's scope
 * applies (team, own) through the provider's scope column.
 *
 * Bounded. Each group is a page of 25 (`page` asks for the next one, with `types` to
 * stay in one group). The whole search runs under a 2-second statement timeout, and
 * each provider in its own savepoint: one that fails (a renamed column, no pg_trgm)
 * costs its own group, never the others.
 *
 * Type words. "staff ada" or "ada staff": a word a provider declares (`words`) at
 * either end narrows the search to that type and searches the rest. A term that is
 * only the word is a search for the page, which the app's own registry answers.
 */
const { logger } = require("../../config/logger");
const { atomically } = require("../db/tx");
const registry = require("./registry");

const MIN_TERM = 2;
const MAX_TERM = 80;

const scopeFor = (...args) =>
  require("../../middleware/rbac").scopeFor(...args);

/** "staff ada" → { type: "employee", term: "ada" }, or null. */
function typeHint(term, providers) {
  const words = term.split(/\s+/);
  if (words.length < 2) return null;
  const byWord = new Map();
  for (const p of providers)
    for (const w of p.words) if (!byWord.has(w)) byWord.set(w, p.type);
  for (let n = Math.min(3, words.length - 1); n >= 1; n -= 1) {
    for (const [head, rest] of [
      [words.slice(0, n), words.slice(n)],
      [words.slice(-n), words.slice(0, -n)],
    ]) {
      const type = byWord.get(head.join(" ").toLowerCase());
      const remainder = rest.join(" ").trim();
      if (type && remainder.length >= MIN_TERM)
        return { type, term: remainder };
    }
  }
  return null;
}

async function trigramReady(c) {
  const { rows } = await c.query(
    `SELECT EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
                     WHERE e.extname = 'pg_trgm' AND n.nspname = ANY (current_schemas(true))) AS ok`,
  );
  return Boolean(rows[0] && rows[0].ok);
}

/**
 * @param {import("pg").Pool} db
 * @param {object} user   req.user
 * @param {{q: string, types?: string[]|null, page?: number}} query
 */
async function search(db, user, { q, types = null, page = 1 } = {}) {
  let term = String(q || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TERM);
  const all = registry.providers();
  let wanted = types && types.length ? new Set(types) : null;
  const hint = wanted ? null : typeHint(term, all);
  if (hint) {
    wanted = new Set([hint.type]);
    term = hint.term;
  }
  const out = { q: term, hint: hint ? hint.type : null, groups: [] };
  if (term.length < MIN_TERM) return out;

  const scopes = new Map();
  for (const module of new Set(all.map((p) => p.module))) {
    const s = await scopeFor(user, module, "view");
    if (s) scopes.set(module, s);
  }
  const run = all.filter(
    (p) => scopes.has(p.module) && (!wanted || wanted.has(p.type)),
  );
  if (run.length === 0) return out;

  const client = await db.connect();
  try {
    await atomically(client, async () => {
      await client.query(
        "SELECT set_config('statement_timeout', '2000', true), set_config('pg_trgm.word_similarity_threshold', '0.4', true)",
      );
      const fuzzy = await trigramReady(client);
      for (const p of run) {
        await client.query("SAVEPOINT search_provider");
        try {
          const r = await p.search(client, {
            term,
            page,
            fuzzy,
            scope: scopes.get(p.module),
          });
          await client.query("RELEASE SAVEPOINT search_provider");
          if (r.items.length)
            out.groups.push({
              type: p.type,
              module: p.module,
              label: p.label,
              page: r.page,
              items: r.items,
            });
        } catch (err) {
          await client.query("ROLLBACK TO SAVEPOINT search_provider");
          logger.warn(
            { err, type: p.type },
            "search provider failed; its group is left out",
          );
        }
      }
    });
  } finally {
    client.release();
  }
  return out;
}

module.exports = { search, typeHint, trigramReady, MIN_TERM };
