"use strict";
/**
 * Praxis AI Engine PR3 without a database (docs/guides/praxis-ai.md §6.3 step 8, §6.13, §6.16): the
 * read guard's statement timeout and deadline, the summary cache's keys and misses, the shared shaper
 * of a summary's figures, groups, series and period, the pane's timed_out outcome and its title check
 * against the whole summary, and the export's About This File words.
 */
const authorise = require("../../../src/shared/ai/authorise");
const summaryCache = require("../../../src/shared/ai/summary-cache");
const shaper = require("../../../src/shared/ai/summary");
const engine = require("../../../src/services/ai/engine");
const { paramsText } = require("../../../src/modules/assistant/assistant.export");

/** A pg client that records what it ran and answers each statement from a script. */
function clientOf({ fail = null } = {}) {
  const ran = [];
  let inTx = false;
  return {
    ran,
    query: async (sql) => {
      const s = String(sql).trim();
      ran.push(s);
      if (s === "BEGIN") inTx = true;
      if (s === "COMMIT" || s === "ROLLBACK") inTx = false;
      // Postgres: a savepoint outside a transaction block is an error (25P01), which the probe relies on.
      if (/^SAVEPOINT/.test(s) && !inTx) throw Object.assign(new Error("SAVEPOINT can only be used in transaction blocks"), { code: "25P01" });
      if (fail && fail.test(s)) throw Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
      return { rows: [] };
    },
  };
}

describe("the read guard (authorise.guarded)", () => {
  test("a read runs inside its own transaction with the statement timeout set locally, then put back", async () => {
    const client = clientOf();
    const out = await authorise.guarded(client, async (c) => {
      await c.query("SELECT 1");
      return "ok";
    });
    expect(out).toBe("ok");
    expect(client.ran).toEqual([
      "SAVEPOINT mycity_tx_probe",
      "BEGIN",
      "SAVEPOINT ai_read",
      `SET LOCAL statement_timeout = ${authorise.READ_TIMEOUT_MS}`,
      "SELECT 1",
      "RELEASE SAVEPOINT ai_read",
      "SET LOCAL statement_timeout = DEFAULT",
      "COMMIT",
    ]);
  });

  test("a pool lends a client and takes it back; a statement the database cancelled is AI_READ_TIMEOUT", async () => {
    const client = clientOf({ fail: /SELECT slow/ });
    let released = 0;
    const pool = { connect: async () => ({ ...client, release: () => (released += 1) }) };
    await expect(authorise.guarded(pool, (c) => c.query("SELECT slow"))).rejects.toMatchObject({ code: "AI_READ_TIMEOUT", status: 504 });
    expect(released).toBe(1);
    expect(client.ran).toContain("ROLLBACK TO SAVEPOINT ai_read");
    expect(client.ran.at(-1)).toBe("ROLLBACK");
  });

  test("a read on another connection is held to the deadline here", async () => {
    jest.useFakeTimers();
    try {
      const client = clientOf();
      const settled = authorise.guarded(client, () => new Promise(() => {})).catch((err) => err);
      // The deadline is set once the transaction is open: wait for its timer, then let it fire.
      for (let i = 0; i < 50 && jest.getTimerCount() === 0; i += 1) await Promise.resolve();
      await jest.advanceTimersByTimeAsync(authorise.READ_DEADLINE_MS + 1);
      expect(await settled).toMatchObject({ code: "AI_READ_TIMEOUT" });
      expect(client.ran).toContain("ROLLBACK TO SAVEPOINT ai_read");
    } finally {
      jest.useRealTimers();
    }
  });

  test("any other failure passes through as itself", async () => {
    const client = clientOf();
    await expect(authorise.guarded(client, async () => { throw new TypeError("broken"); })).rejects.toThrow(TypeError);
  });
});

describe("the summary cache (shared/ai/summary-cache.js)", () => {
  const actor = { user_id: "u1" };
  const scope = { scope: "team", scope_ids: ["b", "a"] };

  test("the key names the person and digests the summary, its parameters in any order, and the scope", () => {
    const k = summaryCache.keyOf(actor, "attendance.summary", { by: "person", month: "2026-11" }, scope);
    expect(k).toMatch(/^mycity:[a-z]+:ai:summary:u1:[0-9a-f]{32}$/);
    expect(summaryCache.keyOf(actor, "attendance.summary", { month: "2026-11", by: "person" }, { scope: "team", scope_ids: ["a", "b"] })).toBe(k);
    expect(summaryCache.keyOf({ user_id: "u2" }, "attendance.summary", { by: "person", month: "2026-11" }, scope)).not.toBe(k);
    expect(summaryCache.keyOf(actor, "attendance.summary", { by: "person", month: "2026-11" }, { scope: "all", scope_ids: null })).not.toBe(k);
    expect(summaryCache.keyOf(actor, "attendance.summary", { by: "department", month: "2026-11" }, scope)).not.toBe(k);
  });

  test("a miss runs the summary and keeps it for a minute; a hit never runs it; no Redis means every call runs", async () => {
    const store = new Map();
    const redis = { get: async (k) => store.get(k) || null, set: async (k, v) => void store.set(k, v) };
    let runs = 0;
    const load = async () => ({ figures: [{ key: "late", label: "Late", value: ++runs, unit: "count" }], groups: [], series: [], total: 1 });
    const first = await summaryCache.cached(actor, "attendance.summary", { by: "person" }, scope, load, { redis });
    const second = await summaryCache.cached(actor, "attendance.summary", { by: "person" }, scope, load, { redis });
    expect([first.cached, second.cached, runs]).toEqual([false, true, 1]);
    expect(second.result).toEqual(first.result);
    await summaryCache.cached({ user_id: "u2" }, "attendance.summary", { by: "person" }, scope, load, { redis });
    expect(runs).toBe(2);
    await summaryCache.cached(actor, "attendance.summary", { by: "person" }, scope, load, { redis: null });
    expect(runs).toBe(3);
  });
});

describe("the shaper (shared/ai/summary.js)", () => {
  test("figures, groups of at most 20, top lists of 10 and series of the last 60 points", () => {
    expect(shaper.figure("late", "Late days", "7")).toEqual({ key: "late", label: "Late days", value: 7, unit: "count" });
    expect(shaper.figure("score", "Score", "0.72", "score")).toEqual({ key: "score", label: "Score", value: "0.72", unit: "score" });
    const rows = Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, label: `L${i}`, value: String(30 - i), count: null }));
    expect(shaper.group("late_days", "Late days by person", rows).rows).toHaveLength(20);
    expect(shaper.top("late_minutes", "Most minutes late", rows).rows).toHaveLength(10);
    expect(shaper.group("x", "X", rows).rows[0]).toEqual({ key: "k0", label: "L0", value: 30, count: null });
    const points = Array.from({ length: 70 }, (_, i) => ({ at: `2026-01-${String(i + 1).padStart(2, "0")}`, value: i }));
    const s = shaper.series("late_days", "Late days by day", points);
    expect(s.points).toHaveLength(60);
    expect(s.points[0]).toEqual({ at: "2026-01-11", value: 10 });
  });

  test("the period: this month up to today, a month, from and to, an open end, and at most a year", () => {
    const now = new Date("2026-11-14T10:00:00Z");
    expect(shaper.periodOf({}, now)).toEqual({ from: "2026-11-01", to: "2026-11-14" });
    expect(shaper.periodOf({ month: "2026-10" }, now)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(shaper.periodOf({ from: "2026-10-05", to: "2026-10-09" }, now)).toEqual({ from: "2026-10-05", to: "2026-10-09" });
    expect(shaper.periodOf({ from: "2026-10-05" }, now)).toEqual({ from: "2026-10-05", to: "2026-11-14" });
    expect(shaper.periodOf({ to: "2026-10-31" }, now)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(shaper.periodOf({ from: "2020-01-01", to: "2026-11-14" }, now)).toEqual({ from: "2025-11-13", to: "2026-11-14" });
  });
});

describe("the pane after PR3 (engine/pane.js)", () => {
  const summary = {
    n: 1,
    key: "attendance.summary",
    kind: "summary",
    ok: true,
    result: {
      figures: [{ key: "late", label: "Late days", value: 12, unit: "count" }, { key: "people", label: "People", value: 48, unit: "count" }],
      groups: [{ by: "late_days", label: "Late days by department", rows: [{ key: "ops", label: "Operations", value: 7, count: 20 }, { key: "it", label: "IT", value: 5, count: 15 }] }],
      series: [],
      total: 35,
    },
  };

  test("a title that names a figure the summary holds, shown or not, is kept; one naming a number it does not hold is dropped for the chart's label; a date is not a figure", () => {
    const draw = (title) => engine.pane.overviewOf({ summary: "attendance.summary", figures: ["late"], chart: { kind: "bar", title, group: "late_days", series: null } }, [summary]).chart.title;
    expect(draw("12 late days across 48 people")).toBe("12 late days across 48 people");
    expect(draw("Operations had 7 of 20 days late")).toBe("Operations had 7 of 20 days late");
    expect(draw("35 days recorded")).toBe("35 days recorded");
    expect(draw("Late days by department, November 2026")).toBe("Late days by department, November 2026");
    expect(draw("Late days up to 14/11/2026")).toBe("Late days up to 14/11/2026");
    expect(draw("99 late days this month")).toBe("Late days by department");
  });

  test("Sources carries a read the database cut as timed_out", () => {
    const reads = [{ n: 1, key: "attendance.register", kind: "read", ok: false, outcome: "timed_out", params: { date: "2026-11-01" }, rows: [], module: "people" }];
    expect(engine.pane.sourcesOf(reads)[0]).toMatchObject({ n: 1, outcome: "timed_out", rows: 0, total: null });
  });
});

describe("the export's words (assistant.export.js)", () => {
  test("a read's parameters as About This File says them: the page left out, a day written day first", () => {
    expect(paramsText({ page: 2, status: "submitted", from: "2026-10-01", tags: ["a", "b"], q: "" })).toBe("status = submitted, from = 01/10/2026, tags = a, b");
    expect(paramsText({})).toBe("none");
  });
});
