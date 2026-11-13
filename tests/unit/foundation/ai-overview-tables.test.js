"use strict";
/**
 * Charts in the Overview, PR 2 (docs/guides/praxis-ai.md §6.19 item 6, Appendix B) without a
 * database: an Overview drawn from a read's rows when they are its whole list, never from the first
 * page of a longer one; fields the rows do not hold dropped; money read as naira; a code field
 * counted and read in its words; the figures the server's own sums and counts; the title check over
 * the rows and those figures; and `answer.build` choosing the summary's Overview first.
 */
const c = require("@mycity/contract");
const engine = require("../../../src/services/ai/engine");
const answer = require("../../../src/services/ai/assistant/answer");

const MONEY_FIELD = (field) => /(allocated|committed|spent|remaining|amount)/.test(field);
const money = require("../../../src/shared/money/money");
const deps = { cell: answer.cell, moneyField: MONEY_FIELD, sumMoney: (amounts) => money.toWire(money.sum(amounts)) };

/** A list read as the orchestrator records one: its page, its total and its rows. */
const listRead = (rows, { n = 1, key = "budgets.list", total = rows.length, number = 1, has_next = false, list = true } = {}) => ({
  n,
  key,
  kind: "read",
  ok: true,
  list,
  rows,
  refs: rows.map(() => null),
  total,
  page: { number, size: 25, total, has_next },
  citations: [],
  masked: [],
});

const BUDGETS = [
  { budget_id: "0e8d1d7e-0c6b-4a4a-9b1c-0a0a0a0a0a01", name: "Programmes 2026", department: "Programmes", status: "approved", allocated: "3500000.00", committed: "500000.00", spent: "1200000.00", remaining: "1800000.00" },
  { budget_id: "0e8d1d7e-0c6b-4a4a-9b1c-0a0a0a0a0a02", name: "Operations 2026", department: "Operations", status: "approved", allocated: "2000000.00", committed: "0.00", spent: "750000.50", remaining: "1249999.50" },
  { budget_id: "0e8d1d7e-0c6b-4a4a-9b1c-0a0a0a0a0a03", name: "Marketing 2026", department: "Marketing", status: "draft", allocated: "1500000.00", committed: "100000.00", spent: "0.00", remaining: "1400000.00" },
  { budget_id: "0e8d1d7e-0c6b-4a4a-9b1c-0a0a0a0a0a04", name: "Finance 2026", department: "Finance", status: "approved", allocated: "1050000.00", committed: "20000.00", spent: "30000.00", remaining: "1000000.00" },
];

const spec = (chart, figures = [], read = 1) => ({ summary: null, read, figures, chart: { group: null, series: null, label: null, values: null, count: null, ...chart } });

describe("an Overview from a whole list's rows (engine/pane.js overviewOfRows)", () => {
  test("a whole list is charted: each row a bar named by its label, money read as naira, the figures the server's", () => {
    const o = engine.pane.overviewOfRows(
      spec({ kind: "bar", title: "Allocated by department", label: "department", values: ["allocated"] }, [{ of: "rows" }, { of: "sum", field: "spent" }, { of: "count", field: "status", value: "approved" }]),
      [listRead(BUDGETS)],
      deps,
    );
    expect(o.read).toBe(1);
    expect(o.summary).toBeNull();
    expect(o.chart).toEqual({ kind: "bar", title: "Allocated by department", labels: ["Programmes", "Operations", "Marketing", "Finance"], series: [{ label: "Allocated", values: [3500000, 2000000, 1500000, 1050000] }], unit: "ngn" });
    // The sum is exact to the kobo; the count reads its code in words.
    expect(o.figures).toEqual([
      { key: "rows", label: "Budgets", value: 4, unit: "count" },
      { key: "sum_spent", label: "Spent", value: "1980000.50", unit: "ngn" },
      { key: "count_status_approved", label: "Approved", value: 3, unit: "count" },
    ]);
    expect(() => c.assistant.AiOverview.parse(o)).not.toThrow();
  });

  test("26 rows of a total of 30 are never charted, nor a later page, nor a read that is not a list", () => {
    const rows = Array.from({ length: 26 }, (_, i) => ({ name: `Site ${i + 1}`, assigned_count: i }));
    const chart = { kind: "bar", title: "People by site", label: "name", values: ["assigned_count"] };
    expect(engine.pane.overviewOfRows(spec(chart, [{ of: "rows" }]), [listRead(rows, { total: 30, has_next: true })], deps)).toBeNull();
    expect(engine.pane.overviewOfRows(spec(chart), [listRead(rows.slice(0, 5), { total: 30, number: 2 })], deps)).toBeNull();
    // A page of 25 whose total says 30 is not the whole list, even with no next page recorded.
    expect(engine.pane.overviewOfRows(spec(chart), [listRead(rows.slice(0, 25), { total: 30 })], deps)).toBeNull();
    // One record (a read that is not a list), a document's reading and a summary never chart from rows.
    expect(engine.pane.overviewOfRows(spec(chart), [listRead(rows.slice(0, 1), { list: false })], deps)).toBeNull();
    expect(engine.pane.overviewOfRows(spec(chart), [{ ...listRead(rows.slice(0, 1)), key: "file.invoice", list: false }], deps)).toBeNull();
    expect(engine.pane.overviewOfRows(spec(chart), [{ n: 1, key: "budgets.summary", kind: "summary", ok: true, result: {} }], deps)).toBeNull();
    // A read that was refused, or another read's number, draws nothing.
    expect(engine.pane.overviewOfRows(spec(chart), [{ ...listRead(rows.slice(0, 3)), ok: false }], deps)).toBeNull();
    expect(engine.pane.overviewOfRows(spec(chart, [], 2), [listRead(rows.slice(0, 3))], deps)).toBeNull();
  });

  test("a field the rows do not hold, or hold as words or as null (a masked field), drops the chart; a figure over it is dropped", () => {
    const run = (chart, figures = []) => engine.pane.overviewOfRows(spec(chart, figures), [listRead(BUDGETS)], deps);
    expect(run({ kind: "bar", title: "Budget", label: "department", values: ["headcount"] })).toBeNull();
    expect(run({ kind: "bar", title: "Budget", label: "department", values: ["name"] })).toBeNull();
    expect(run({ kind: "bar", title: "Budget", label: "owner", values: ["allocated"] })).toBeNull();
    // An id never names a bar: a label no person reads drops the chart.
    expect(run({ kind: "bar", title: "Budget", label: "budget_id", values: ["allocated"] })).toBeNull();
    const masked = BUDGETS.map((b) => ({ ...b, allocated: null }));
    expect(engine.pane.overviewOfRows(spec({ kind: "bar", title: "Budget", label: "department", values: ["allocated"] }, [{ of: "sum", field: "allocated" }]), [listRead(masked)], deps)).toBeNull();
    // A figure the rows can give stays when the chart cannot be drawn.
    const left = run({ kind: "bar", title: "Budget", label: "department", values: ["headcount"] }, [{ of: "rows" }, { of: "sum", field: "headcount" }]);
    expect(left.chart).toBeNull();
    expect(left.figures.map((f) => f.key)).toEqual(["rows"]);
  });

  test("several values make a stacked bar when asked, money in naira; a bar of several draws the first; never below zero", () => {
    const stacked = engine.pane.overviewOfRows(spec({ kind: "stacked_bar", title: "Each budget used", label: "name", values: ["spent", "committed", "remaining"] }), [listRead(BUDGETS)], deps);
    expect(stacked.chart.kind).toBe("stacked_bar");
    expect(stacked.chart.series.map((s) => s.label)).toEqual(["Spent", "Committed", "Remaining"]);
    expect(stacked.chart.series[0].values).toEqual([1200000, 750000.5, 0, 30000]);
    expect(stacked.chart.unit).toBe("ngn");
    const bar = engine.pane.overviewOfRows(spec({ kind: "bar", title: "Each budget", label: "name", values: ["spent", "committed"] }), [listRead(BUDGETS)], deps);
    expect([bar.chart.kind, bar.chart.series.length]).toEqual(["bar", 1]);
    const over = BUDGETS.map((b, i) => (i === 0 ? { ...b, remaining: "-15000.00" } : b));
    expect(engine.pane.overviewOfRows(spec({ kind: "stacked_bar", title: "Each budget used", label: "name", values: ["spent", "remaining"] }), [listRead(over)], deps)).toBeNull();
  });

  test("a plain number field has no unit; a line runs over a date label in date order, read day first", () => {
    const sites = [
      { name: "Lekki Office", assigned_count: 12, opened_on: "2026-03-02" },
      { name: "Ikeja Hub", assigned_count: 7, opened_on: "2025-11-20" },
    ];
    const bar = engine.pane.overviewOfRows(spec({ kind: "bar", title: "People at each worksite", label: "name", values: ["assigned_count"] }, [{ of: "sum", field: "assigned_count" }]), [listRead(sites, { key: "worksites.list" })], deps);
    expect(bar.chart).toMatchObject({ kind: "bar", labels: ["Lekki Office", "Ikeja Hub"], series: [{ label: "Assigned Count", values: [12, 7] }], unit: null });
    expect(bar.figures).toEqual([{ key: "sum_assigned_count", label: "Assigned Count", value: 19, unit: null }]);
    const line = engine.pane.overviewOfRows(spec({ kind: "line", title: "People by opening", label: "opened_on", values: ["assigned_count"] }), [listRead(sites, { key: "worksites.list" })], deps);
    expect(line.chart.kind).toBe("line");
    expect(line.chart.labels).toEqual(["20/11/2025", "02/03/2026"]);
    expect(line.chart.series[0].values).toEqual([7, 12]);
    // A line over a label that is not a date is a bar.
    const notDated = engine.pane.overviewOfRows(spec({ kind: "line", title: "People", label: "name", values: ["assigned_count"] }), [listRead(sites)], deps);
    expect(notDated.chart.kind).toBe("bar");
  });

  test("a code field is counted and read in its words, most first, as a donut when asked", () => {
    const o = engine.pane.overviewOfRows(spec({ kind: "donut", title: "Budgets by status", count: "status" }, [{ of: "count", field: "status", value: "Draft" }]), [listRead(BUDGETS)], deps);
    expect(o.chart).toEqual({ kind: "donut", title: "Budgets by status", labels: ["Approved", "Draft"], series: [{ label: "Status", values: [3, 1] }], unit: null });
    expect(o.figures).toEqual([{ key: "count_status_Draft", label: "Draft", value: 1, unit: "count" }]);
    const bar = engine.pane.overviewOfRows(spec({ kind: "stacked_bar", title: "Budgets by status", count: "status" }), [listRead(BUDGETS)], deps);
    expect(bar.chart.kind).toBe("bar");
  });

  test("a record's name labels its bar, reached with a dot or read whole", () => {
    const rows = [
      { name: "Annual", department: { department_id: "0e8d1d7e-0c6b-4a4a-9b1c-0a0a0a0a0a09", name: "Operations" }, days_left: 12 },
      { name: "Sick", department: { department_id: "0e8d1d7e-0c6b-4a4a-9b1c-0a0a0a0a0a08", name: "Programmes" }, days_left: 5 },
    ];
    const dotted = engine.pane.overviewOfRows(spec({ kind: "bar", title: "Days left", label: "department.name", values: ["days_left"] }), [listRead(rows, { key: "my_leave.balances" })], deps);
    expect(dotted.chart.labels).toEqual(["Operations", "Programmes"]);
    const whole = engine.pane.overviewOfRows(spec({ kind: "bar", title: "Days left", label: "department", values: ["days_left"] }, [{ of: "rows" }]), [listRead(rows, { key: "my_leave.balances" })], deps);
    expect(whole.chart.labels).toEqual(["Operations", "Programmes"]);
    expect(whole.figures[0].label).toBe("My Leave Balances");
  });

  test("the title check runs over the rows' values and the computed figures", () => {
    const kept = engine.pane.overviewOfRows(spec({ kind: "bar", title: "Programmes holds ₦3,500,000.00", label: "department", values: ["allocated"] }), [listRead(BUDGETS)], deps);
    expect(kept.chart.title).toBe("Programmes holds ₦3,500,000.00");
    const figure = engine.pane.overviewOfRows(spec({ kind: "bar", title: "4 budgets this year", label: "department", values: ["allocated"] }, [{ of: "rows" }]), [listRead(BUDGETS)], deps);
    expect(figure.chart.title).toBe("4 budgets this year");
    const made = engine.pane.overviewOfRows(spec({ kind: "bar", title: "9 departments over ₦10,000,000", label: "department", values: ["allocated"] }), [listRead(BUDGETS)], deps);
    expect(made.chart.title).toBe("Allocated");
  });
});

describe("the answer chooses its Overview (answer.build)", () => {
  const routes = [];
  const screens = [];
  const summary = {
    n: 2,
    key: "budgets.summary",
    kind: "summary",
    ok: true,
    params: {},
    result: { figures: [{ key: "allocated", label: "Allocated", value: "8050000.00", unit: "ngn" }], groups: [{ by: "department", label: "Budget by department", rows: [{ key: "a", label: "Programmes", value: "3500000.00", count: 1 }] }], series: [], total: 1 },
  };
  const draft = (overview) => ({ text: "Here are the budgets.", table: null, route: null, prefill: null, more: false, action: null, ask: null, overview });

  test("the draft's new shape parses, and a summary's Overview wins when it answered", () => {
    const parsed = c.assistant.AiAnswerDraft.parse(
      draft({ summary: "budgets.summary", read: 1, figures: ["allocated", { of: "rows" }], chart: { kind: "bar", title: "Budget", group: "department", label: "department", values: ["allocated"] } }),
    );
    const shown = answer.build({ draft: parsed, reads: [listRead(BUDGETS), summary], routes, screens, shows: ["pane"] });
    expect(shown.overview.summary).toBe("budgets.summary");
    expect(shown.overview.read).toBeNull();
    expect(shown.overview.figures.map((f) => f.key)).toEqual(["allocated"]);
    expect(() => c.assistant.AiOverview.parse(shown.overview)).not.toThrow();
  });

  test("with no summary, the rows' Overview, money in naira, kept in the answer's metadata; none without the pane", () => {
    const parsed = c.assistant.AiAnswerDraft.parse(draft({ read: 1, figures: [{ of: "sum", field: "allocated" }], chart: { kind: "bar", title: "Allocated by department", label: "department", values: ["allocated"] } }));
    const shown = answer.build({ draft: parsed, reads: [listRead(BUDGETS)], routes, screens, shows: ["pane"] });
    expect(shown.overview).toMatchObject({ summary: null, read: 1, figures: [{ key: "sum_allocated", value: "8050000.00", unit: "ngn" }], chart: { kind: "bar", unit: "ngn" } });
    expect(shown.metadata.overview).toEqual(shown.overview);
    expect(() => c.assistant.AiOverview.parse(shown.overview)).not.toThrow();
    expect(answer.build({ draft: parsed, reads: [listRead(BUDGETS)], routes, screens, shows: [] }).overview).toBeNull();
  });

  test("an Overview kept before PR 2 (a summary's, with no read or unit) still parses", () => {
    const old = { summary: "attendance.summary", title: null, figures: [], chart: { kind: "bar", title: "Late", labels: ["A"], series: [{ label: "Late", values: [2] }] } };
    expect(c.assistant.AiOverview.parse(old)).toMatchObject({ read: null, chart: { unit: null } });
  });
});
