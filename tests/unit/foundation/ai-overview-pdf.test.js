"use strict";
/**
 * Charts in the Overview, PR 3 (docs/guides/praxis-ai.md §6.19 items 7 and 8): a chart in a document
 * (src/shared/documents/chart.js) drawn as SVG from its numbers alone, every label escaped, its
 * colours the light theme's tokens; the renderer's chart block; a summary's chart read in naira when
 * its values are amounts; and the spec of an Overview kept before its spec was, rebuilt.
 */
const fs = require("node:fs");
const chart = require("../../../src/shared/documents/chart");
const { render, renderMarkdown } = require("../../../src/shared/documents/render");
const { pane } = require("../../../src/services/ai/engine");
const { specOfKept, tileOf } = require("../../../src/modules/assistant/assistant.export");

const LABELS = ["Programmes", "Operations"];
const STACKED = { kind: "stacked_bar", title: "Budget by department", labels: LABELS, series: [{ label: "Spent", values: [2000000, 1500000] }, { label: "Remaining", values: [1500000, 500000] }], unit: "ngn" };

describe("a chart in a document (chart.js)", () => {
  const css = fs.readFileSync(chart.TOKENS, "utf8");
  const c = chart.coloursFrom(css);

  test("takes its six series colours, its ink and its rules from tokens.css's light :root", () => {
    const light = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf(":root")));
    expect(c.series).toHaveLength(6);
    for (const [i, hex] of c.series.entries()) expect(light).toContain(`--chart-${i + 1}: ${hex};`);
    expect(light).toContain(`--foreground: ${c.ink};`);
    expect(chart.chartSvg(STACKED)).toContain(`fill="${c.series[1]}"`);
    expect(() => chart.coloursFrom(":root { --chart-1: red; }")).toThrow(/--chart-1/);
  });

  test("draws a bar, a stacked bar with its legend, a line and a donut", () => {
    const bar = chart.chartSvg({ kind: "bar", title: "Allocated", labels: LABELS, series: [{ label: "Allocated", values: [3500000, 2000000] }] }, { colours: c });
    expect(bar).toMatch(/^<figure class="doc-chart"><svg /);
    expect((bar.match(/<rect /g) || []).length).toBe(2);
    const stacked = chart.chartSvg(STACKED, { colours: c });
    // Two parts on each of two bars, and the legend's two keys.
    expect((stacked.match(/<rect /g) || []).length).toBe(6);
    expect(stacked).toContain(">Spent</text>");
    expect(stacked).toContain("₦");
    const line = chart.chartSvg({ kind: "line", title: "Paid", labels: ["2026-09", "2026-10", "2026-11"], series: [{ label: "Paid", values: [1, 3, 2] }, { label: "Asked", values: [2, 2, 2] }] }, { colours: c });
    expect((line.match(/<polyline /g) || []).length).toBe(2);
    const donut = chart.chartSvg({ kind: "donut", title: "By status", labels: ["Open", "Closed"], series: [{ label: "Requests", values: [3, 1] }] }, { colours: c });
    expect((donut.match(/<path /g) || []).length).toBe(2);
    expect(donut).toContain("Open · 3");
  });

  test("escapes every label and title, and draws nothing that is not a chart", () => {
    const svg = chart.chartSvg({ kind: "bar", title: "<script>alert(1)</script>", labels: ["<script>x</script>"], series: [{ label: "<b>", values: [1] }] }, { colours: c });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(chart.chartSvg({ kind: "pie", labels: ["a"], series: [{ values: [1] }] })).toBe("");
    expect(chart.chartSvg({ kind: "bar", labels: [], series: [] })).toBe("");
  });

  test("never draws a bar below zero", () => {
    const svg = chart.chartSvg({ kind: "bar", title: "t", labels: ["a", "b"], series: [{ label: "v", values: [-5, 5] }] }, { colours: c });
    expect((svg.match(/<rect /g) || []).length).toBe(1);
  });

  test("gives its figures as a table: a column a series, a Total for a stacked bar, naira for ngn", () => {
    expect(chart.chartTable(STACKED, "Department")).toEqual({
      head: ["Department", "Spent", "Remaining", "Total"],
      rows: [
        ["Programmes", "₦2,000,000.00", "₦1,500,000.00", "₦3,500,000.00"],
        ["Operations", "₦1,500,000.00", "₦500,000.00", "₦2,000,000.00"],
      ],
    });
    expect(chart.chartTable({ kind: "bar", title: "t", labels: ["a"], series: [{ label: "People", values: [1200] }, { label: "x", values: [1] }] }, "Site")).toEqual({ head: ["Site", "People"], rows: [["a", "1,200"]] });
  });
});

describe("the renderer's chart block", () => {
  test("prints a chart the code built as SVG, in HTML and in Markdown, and a grid as before", () => {
    const html = render("<div>{{ c }}</div>{{ t }}", { c: { chart: STACKED }, t: { head: ["A"], rows: [["1"]] } });
    expect(html).toContain("<svg");
    expect(html).toContain("<table><tr><th>A</th></tr><tr><td>1</td></tr></table>");
    expect(renderMarkdown("Before\n\n{{ c }}\n\nAfter", { c: { chart: STACKED } })).toContain("<svg");
  });

  test("a value that only looks like a chart prints nothing of its own", () => {
    expect(render("{{ c }}", { c: { chart: "<script>" } })).toBe("");
  });
});

describe("a summary's chart in naira (§6.19 item 7)", () => {
  const result = (rows, figures = [{ key: "allocated", label: "Allocated", value: "1.00", unit: "ngn" }]) => ({ figures, groups: [{ by: "department", label: "By department", rows }], series: [], total: rows.length });

  test("is ngn when every value it draws is an amount and the summary holds a figure in naira", () => {
    const rows = [{ key: "a", label: "A", value: "3500000.00", count: null, parts: [{ key: "spent", label: "Spent", value: "2000000.00" }, { key: "remaining", label: "Remaining", value: "1500000.00" }] }];
    const ov = pane.overviewOf({ summary: "budgets.summary", figures: [], chart: { kind: "stacked_bar", title: "Budget", group: "department" } }, [{ kind: "summary", ok: true, key: "budgets.summary", result: result(rows) }]);
    expect(ov.chart.unit).toBe("ngn");
  });

  test("stays a number for counts, and for a score's average in a summary with no naira", () => {
    const counts = [{ key: "a", label: "A", value: 4, count: 4 }];
    expect(pane.chartOfGroup({ kind: "bar", title: "t" }, result(counts).groups[0], result(counts)).unit).toBeNull();
    const scores = [{ key: "a", label: "A", value: "72.50", count: 3 }];
    const r = result(scores, [{ key: "sittings", label: "Sittings", value: 3, unit: "count" }]);
    expect(pane.chartOfGroup({ kind: "bar", title: "t" }, r.groups[0], r).unit).toBeNull();
  });
});

describe("an Overview kept before its spec was (§6.19 item 8.2)", () => {
  const result = {
    figures: [],
    groups: [
      { by: "department", label: "Budget by department", rows: [{ key: "a", label: "A", value: "3.00", count: null, parts: [{ key: "spent", label: "Spent", value: "1.00" }, { key: "remaining", label: "Remaining", value: "2.00" }] }] },
      { by: "category", label: "Budget by category", rows: [{ key: "t", label: "Travel", value: "3.00", count: null }] },
    ],
    series: [{ key: "spent", label: "Paid by month", points: [{ at: "2026-11", value: "1.00" }] }],
    total: 1,
  };
  const kept = (chartOver) => ({ summary: "budgets.summary", read: null, title: null, figures: [{ key: "allocated", label: "Allocated", value: "3.00", unit: "ngn" }], chart: { kind: "bar", title: "T", labels: ["A"], series: [], unit: null, ...chartOver } });

  test("finds a stacked bar's grouping by its parts, a bar's by its label, a line's series by theirs", () => {
    expect(specOfKept(kept({ kind: "stacked_bar", series: [{ label: "Spent", values: [1] }, { label: "Remaining", values: [2] }] }), result).chart).toMatchObject({ group: "department", series: null });
    expect(specOfKept(kept({ series: [{ label: "Budget by category", values: [3] }] }), result).chart).toMatchObject({ group: "category" });
    expect(specOfKept(kept({ kind: "line", series: [{ label: "Paid by month", values: [1] }] }), result).chart).toMatchObject({ group: null, series: ["spent"] });
    expect(specOfKept(kept({ series: [{ label: "Nothing", values: [1] }] }), result).chart).toBeNull();
    expect(specOfKept(kept({}), result).figures).toEqual(["allocated"]);
  });

  test("a table Overview keeps its row count and sums, and draws its rows", () => {
    const spec = specOfKept({ summary: null, read: 1, title: null, figures: [{ key: "rows", label: "Worksites", value: 3, unit: "count" }, { key: "sum_radius_m", label: "Radius M", value: 300, unit: null }], chart: null }, null);
    expect(spec).toEqual({ summary: null, read: 1, figures: [{ of: "rows" }, { of: "sum", field: "radius_m" }], chart: null });
  });

  test("a tile reads money through the template and the rest in words", () => {
    expect(tileOf({ label: "Allocated", value: "8050000.50", unit: "ngn" })).toEqual({ label: "Allocated", value: "8050000.50", money: true });
    expect(tileOf({ label: "Used", value: 84, unit: "percent" })).toEqual({ label: "Used", value: "84%", money: false });
    expect(tileOf({ label: "People", value: 1200, unit: "count" })).toEqual({ label: "People", value: "1,200", money: false });
  });
});
