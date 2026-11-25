"use strict";
/**
 * ⌘K warmed at boot (docs/guides/foundation.md §6.7; QA BG-049): before the API listens, the User
 * Guide's chapters are read and word-indexed, a pooled connection is opened and pg_trgm looked up,
 * so the first search finds that work done. Warming is bounded and logged, and never stops a boot:
 * a connection that hangs is waited for at most the bound, a step that fails costs only itself.
 */
const guideSearch = require("@mycity/contract/guide-search");
const { logger } = require("../../../src/config/logger");
const { warm, WARM_WITHIN_MS } = require("../../../src/shared/search/warm");
const userGuide = require("../../../src/modules/user_guide/user_guide.service");
const guideProvider = require("../../../src/modules/user_guide/user_guide.search");

/** A pooled connection answering the pg_trgm lookup, keeping what it was asked. */
function dbOf({ trigram = true } = {}) {
  const asked = [];
  const client = {
    released: 0,
    query: async (sql) => {
      asked.push(sql);
      return { rows: /pg_extension/.test(sql) ? [{ ok: trigram }] : [{}] };
    },
    release() {
      this.released += 1;
    },
  };
  return { asked, client, db: { connect: async () => client } };
}

afterEach(() => jest.restoreAllMocks());

test("the boot waits ten seconds at most", () => {
  expect(WARM_WITHIN_MS).toBe(10_000);
});

test("the User Guide's chapters are indexed, a connection opened and released, pg_trgm looked up and loaded; logged as warmed", async () => {
  const info = jest.spyOn(logger, "info");
  const { asked, client, db } = dbOf();
  const out = await warm({ db });
  expect(out.outcome).toBe("ready");
  expect(out.steps).toEqual({ guide_section: "ready", trigram: "ready" });
  expect(asked[0]).toMatch(/pg_extension/);
  expect(asked[1]).toMatch(/word_similarity/);
  expect(client.released).toBe(1);
  expect(info).toHaveBeenCalledWith(expect.objectContaining({ steps: out.steps }), "search warmed");
  // The first search finds the index built: nothing is indexed again.
  const indexOf = jest.spyOn(guideSearch, "indexOf");
  const index = userGuide.indexOf(userGuide.load());
  expect(indexOf).not.toHaveBeenCalled();
  expect(index).toBeTruthy();
});

test("without pg_trgm no similarity is asked, and the boot is told it is missing", async () => {
  const { asked, db } = dbOf({ trigram: false });
  const out = await warm({ db, providers: [] });
  expect(out).toMatchObject({ outcome: "ready", steps: { trigram: "missing" } });
  expect(asked).toHaveLength(1);
});

test("a connection that never comes is waited for at most the bound; the boot carries on, logged", async () => {
  const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
  const db = { connect: () => new Promise(() => {}) };
  const started = Date.now();
  const out = await warm({ db, providers: [guideProvider], timeoutMs: 50 });
  expect(Date.now() - started).toBeLessThan(2_000);
  expect(out.outcome).toBe("timed_out");
  expect(out.steps).toEqual({ guide_section: "ready" });
  expect(warn).toHaveBeenCalledWith(expect.objectContaining({ within_ms: 50 }), "search: warming took too long; the API listens regardless");
});

test("a provider that fails costs only itself; a database that refuses is logged as failed, never thrown", async () => {
  const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
  const broken = { type: "broken", warm: () => Promise.reject(new Error("no chapters")) };
  const plain = { type: "plain", search: async () => ({}) };
  const ok = dbOf();
  const first = await warm({ db: ok.db, providers: [broken, plain] });
  expect(first).toMatchObject({ outcome: "ready", steps: { broken: "failed", trigram: "ready" } });
  expect(first.steps).not.toHaveProperty("plain");
  const refused = { connect: async () => Promise.reject(new Error("connection refused")) };
  const second = await warm({ db: refused, providers: [] });
  expect(second.outcome).toBe("failed");
  expect(warn).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), "search: warming failed; the first search prepares instead");
});
