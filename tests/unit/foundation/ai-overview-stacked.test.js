"use strict";
/**
 * Charts in the Overview, PR 1 (docs/guides/praxis-ai.md §6.19 items 1 to 4, Appendix B) without a
 * database: a summary row's parts and their sum, the pane drawing them as a stacked bar, the title
 * check counting parts, Budgets' summary shaped from its SQL's answer (Over Budget as its own part,
 * nothing below zero), a read naming its summary in the manifest, gate 23 rule 9, and the budget
 * columns read as naira.
 */
const c = require("@mycity/contract");
const shaper = require("../../../src/shared/ai/summary");
const engine = require("../../../src/services/ai/engine");
const { defineManifest } = require("../../../src/shared/ai/manifest");
const { summariesNamed } = require("../../../scripts/check/ai-awareness");
const { cell } = require("../../../src/services/ai/assistant/answer");
const budgets = require("../../../src/modules/budgets/budgets.service");

const { part, group } = shaper;

describe("a summary row's parts (shared/ai/summary.js)", () => {
  test("a row with parts and no value takes their sum; parts keep their order and their strings", () => {
    const g = group("department", "Budget by department", [
      { key: "a", label: "Finance", parts: [part("spent", "Spent", "200.00"), part("committed", "Committed", "50.50"), part("remaining", "Remaining", "749.50")] },
    ]);
    expect(g.rows[0].value).toBe(1000);
    expect(g.rows[0].parts.map((p) => p.key)).toEqual(["spent", "committed", "remaining"]);
    expect(g.rows[0].parts[1].value).toBe("50.50");
  });

  test("a value that disagrees with its parts throws, and a part below zero is refused", () => {
    expect(() => group("department", "Budget", [{ key: "a", label: "A", value: "900.00", parts: [part("spent", "Spent", "1000.00")] }])).toThrow(/not the sum of its parts/);
    expect(() => part("remaining", "Remaining", "-1.00")).toThrow(/below zero/);
  });

  test("a row without parts is as before, and parse with the contract's AiSummaryResult either way", () => {
    const plain = group("status", "By status", [{ key: "open", label: "Open", value: 3 }]);
    expect(plain.rows[0]).toEqual({ key: "open", label: "Open", value: 3, count: null });
    const stacked = group("department", "Budget", [{ key: "a", label: "A", value: "10.00", parts: [part("spent", "Spent", "4.00"), part("remaining", "Remaining", "6.00")] }]);
    expect(() => c.assistant.AiSummaryResult.parse({ figures: [], groups: [plain, stacked], series: [], total: 1 })).not.toThrow();
  });
});

describe("the pane draws parts as a stacked bar (engine/pane.js)", () => {
  const result = {
    figures: [{ key: "allocated", label: "Allocated", value: "1500.00", unit: "ngn" }],
    groups: [
      group("department", "Budget by department", [
        { key: "a", label: "Finance", parts: [part("spent", "Spent", "200.00"), part("committed", "Committed", "100.00"), part("remaining", "Remaining", "700.00")] },
        { key: "b", label: "Marketing", parts: [part("spent", "Spent", "300.00"), part("committed", "Committed", "0.00"), part("remaining", "Remaining", "200.00")] },
      ]),
    ],
    series: [],
    total: 2,
  };
  const reads = [{ n: 1, key: "budgets.summary", kind: "summary", ok: true, result }];

  test("one series per part, in the first row's order, the rows as labels", () => {
    const o = engine.pane.overviewOf({ summary: "budgets.summary", figures: ["allocated"], chart: { kind: "stacked_bar", title: "Budget by department", group: "department" } }, reads);
    expect(o.chart.kind).toBe("stacked_bar");
    expect(o.chart.labels).toEqual(["Finance", "Marketing"]);
    expect(o.chart.series).toEqual([
      { label: "Spent", values: [200, 300] },
      { label: "Committed", values: [100, 0] },
      { label: "Remaining", values: [700, 200] },
    ]);
    expect(() => c.assistant.AiOverview.parse(o)).not.toThrow();
  });

  test("a bar over the same group draws the rows' totals; a stacked bar over rows without parts is a bar", () => {
    const bar = engine.pane.overviewOf({ summary: "budgets.summary", figures: [], chart: { kind: "bar", title: "Budget", group: "department" } }, reads);
    expect(bar.chart.series).toEqual([{ label: "Budget by department", values: [1000, 500] }]);
    const plain = [{ n: 1, key: "x.summary", kind: "summary", ok: true, result: { figures: [], groups: [group("status", "By status", [{ key: "o", label: "Open", value: 2 }])], series: [], total: 2 } }];
    const o = engine.pane.overviewOf({ summary: "x.summary", figures: [], chart: { kind: "stacked_bar", title: "By status", group: "status" } }, plain);
    expect(o.chart.kind).toBe("bar");
  });

  test("a title may name a part's value; one naming a number the summary holds nowhere is dropped", () => {
    const kept = engine.pane.overviewOf({ summary: "budgets.summary", figures: [], chart: { kind: "stacked_bar", title: "Marketing has 200 left", group: "department" } }, reads);
    expect(kept.chart.title).toBe("Marketing has 200 left");
    const dropped = engine.pane.overviewOf({ summary: "budgets.summary", figures: [], chart: { kind: "stacked_bar", title: "Marketing has 999 left", group: "department" } }, reads);
    expect(dropped.chart.title).toBe("Spent");
  });
});

describe("Budgets' summary (budgets.service aiSummary)", () => {
  /** A client that answers the summary's one statement as Postgres would (numerics as strings). */
  const clientOf = (row) => ({ query: async () => ({ rows: [row] }) });
  const sql = {
    figures: { budgets: 2, allocated: "1500.00", committed: "150.00", spent: "1300.00", lines_over: 1, lines_past_80: 1 },
    by_department: [
      { key: "a", label: "Finance", allocated: "1000.00", committed: "100.00", spent: "200.00" },
      { key: "b", label: "Marketing", allocated: "500.00", committed: "50.00", spent: "1100.00" },
    ],
    by_category: [{ key: "c", label: "Travel and Transport", allocated: "1500.00", committed: "150.00", spent: "1300.00" }],
    by_project: [],
    paid: [{ at: "2026-03", value: "1300.00" }],
  };

  test("figures in naira, by department and category stacked, Over Budget a part only where a row went past", async () => {
    const r = await budgets.aiSummary(clientOf(sql), { by: "department" }, { scope: "all" }, new Date("2026-11-13T10:00:00Z"));
    expect(() => c.assistant.AiSummaryResult.parse(r)).not.toThrow();
    const f = Object.fromEntries(r.figures.map((x) => [x.key, x]));
    expect(f.allocated).toMatchObject({ value: "1500.00", unit: "ngn" });
    expect(f.remaining.value).toBe("50.00");
    expect(f.used).toMatchObject({ value: 97, unit: "percent" });
    const dept = r.groups.find((g) => g.by === "department");
    expect(dept.rows[0].parts.map((p) => [p.key, p.value])).toEqual([["spent", "200.00"], ["committed", "100.00"], ["remaining", "700.00"], ["over", "0.00"]]);
    // Marketing used 1,150.00 of 500.00: Spent fills the allocation, Committed and Remaining are nothing, 650.00 is over.
    expect(dept.rows[1].parts.map((p) => [p.key, p.value])).toEqual([["spent", "500.00"], ["committed", "0.00"], ["remaining", "0.00"], ["over", "650.00"]]);
    expect(dept.rows[1].value).toBe("1150.00");
    expect(r.groups.map((g) => g.by)).toEqual(["department", "category"]);
    expect(r.series[0]).toMatchObject({ key: "spent", label: "Paid by month, 2026" });
  });

  test("by project only for a reader whose scope is all, and the SQL is told so", async () => {
    const seen = [];
    const client = { query: async (_sql, params) => (seen.push(params), { rows: [sql] }) };
    const team = await budgets.aiSummary(client, { by: "project" }, { scope: "team", scope_ids: ["e1"] });
    expect(team.groups.map((g) => g.by)).toEqual(["department", "category"]);
    expect(seen[0][4]).toBe(false);
    const all = await budgets.aiSummary(client, { by: "project", year: 2026 }, { scope: "all" });
    expect(all.groups.map((g) => g.by)).toEqual(["department", "category", "project"]);
    expect(seen[1][4]).toBe(true);
    expect(seen[1][2]).toBe(2026);
  });
});

describe("a read names its summary (manifest and gate 23 rule 9)", () => {
  const READ = {
    key: "things.list",
    description: "List the things I can see",
    params: c.common.PageQuery,
    permission: ["workspace", "view"],
    run: async () => ({ data: [] }),
    cite: (row) => ({ type: "thing", id: row.id }),
  };

  test("summary is a summary's key or none with a reason; anything else fails the manifest", () => {
    expect(() => defineManifest({ module: "workspace", reads: [{ ...READ, summary: "things.summary" }] })).not.toThrow();
    expect(() => defineManifest({ module: "workspace", reads: [{ ...READ, summary: "none: one record" }] })).not.toThrow();
    expect(() => defineManifest({ module: "workspace", reads: [{ ...READ, summary: "none" }] })).toThrow(/summary is the key/);
    expect(() => defineManifest({ module: "workspace", reads: [{ ...READ, summary: "later" }] })).toThrow(/summary is the key/);
  });

  test("rule 9: a read with nothing, a summary nobody declares, a gap now answered, a gap the base did not hold", () => {
    const reads = [
      { key: "a.list", summary: "a.summary" },
      { key: "b.list", summary: "none: configuration" },
      { key: "c.list" },
      { key: "d.list" },
      { key: "e.list", summary: "e.summary" },
      { key: "f.list", summary: "a.summary" },
    ];
    const gaps = { "d.list": { summary: "d.summary", pr: 4 }, "f.list": { summary: "a.summary", pr: 4 }, "gone.list": { summary: "g.summary", pr: 8 } };
    const problems = summariesNamed({ reads, summaryKeys: new Set(["a.summary"]), gaps, baseGaps: { "d.list": {}, "f.list": {} } });
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^c\.list: say which summary/),
        expect.stringMatching(/^e\.list: its summary e\.summary is declared by no manifest/),
        expect.stringMatching(/^f\.list names its summary now: take it off/),
        expect.stringMatching(/names gone\.list, which no manifest declares/),
        expect.stringMatching(/gained gone\.list/),
      ]),
    );
    expect(problems).toHaveLength(5);
    expect(summariesNamed({ reads: [{ key: "d.list" }], summaryKeys: new Set(), gaps: { "d.list": { summary: "d.summary", pr: 4 } }, baseGaps: null })).toEqual([]);
  });
});

describe("budget columns read as naira (assistant/answer.js)", () => {
  test.each(["allocated", "committed", "spent", "remaining", "gross", "net", "amount_due", "paid", "commission"])("%s", (field) => {
    expect(cell(field, "3500000.00")).toEqual({ text: "₦3,500,000.00", numeric: true });
  });
  test("a two-place figure in a column not named like money stays as it is", () => {
    expect(cell("score", "3.50")).toEqual({ text: "3.50", numeric: false });
  });
});

describe("the evaluation set grades a chart and an answer's words (scripts/ai/eval-assistant.js)", () => {
  const { grade, CASES } = require("../../../scripts/ai/eval-assistant");
  const got = (overview, content) => ({ reads: [{ key: "budgets.summary", ok: true, rows: [] }], shown: { content, overview, declined: null, link: null } });

  test("chart: the Overview must draw that kind; never_words: the words must not say how it works", () => {
    const kase = { reads: ["budgets.summary"], chart: "stacked_bar", never_words: ["endpoint", "database"] };
    expect(grade(kase, got({ chart: { kind: "stacked_bar" } }, "Four departments share ₦18,850,000.00.")).pass).toBe(true);
    expect(grade(kase, got({ chart: { kind: "bar" } }, "Fine.")).problems).toEqual(["drew a bar, not a stacked_bar"]);
    expect(grade(kase, got(null, "Charts come from database summary endpoints.")).problems).toEqual(["drew no chart; expected a stacked_bar", "its words say how Praxis AI works (endpoint, database)"]);
  });

  test("the question that started the plan is a case", () => {
    expect(CASES.find((k) => k.id === "chart.budgets-department")).toMatchObject({ reads: ["budgets.summary"], chart: "stacked_bar", shows: ["pane"] });
  });
});
