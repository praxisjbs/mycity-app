"use strict";
/**
 * The proposal design kit and the figure check (docs/guides/partnerships.md §6.10, §6.11): every layout
 * drawn from its content, 16:9 pages, one HTML for the PDF, the studio and the public page, charts drawn
 * from figures, the kit's assets current with the hub's (scripts/gen/proposal-kit.js), and every figure
 * sourced or marked.
 */
const fs = require("node:fs");
const path = require("node:path");
const c = require("../../packages/contract");
const kit = require("../../src/modules/proposals/proposals.kit");
const charts = require("../../src/modules/proposals/proposals.charts");
const content = require("../../src/modules/proposals/proposals.content");
const gen = require("../../scripts/gen/proposal-kit");

const ROOT = path.resolve(__dirname, "..", "..");
const sample = JSON.parse(fs.readFileSync(path.join(ROOT, "templates", "proposals", "sample.json"), "utf8"));
const draw = (sections, mode = "pdf") => kit.renderProposal({ sections }, { reference: "PRO-0042", seed: "PRO-0042" }, { mode });

describe("the design kit", () => {
  test("the gallery's sample holds every layout of the kit once", () => {
    const layouts = sample.content.sections.map((s) => s.layout).sort();
    expect(layouts).toEqual([...c.proposals.LayoutName.options].sort());
    expect(c.proposals.ProposalContent.safeParse(sample.content).success).toBe(true);
  });

  test("every page is 16:9, numbered on its route from the second, and the PDF, studio and web are the same pages", () => {
    const out = draw(sample.content.sections);
    expect(out.html).toContain("@page { size: 338.67mm 190.5mm; margin: 0; }");
    expect(out.html).toMatch(/\.page \{\s+position: relative;\s+width: 1280px;\s+height: 720px;/);
    const pages = out.html.match(/<section class="page /g);
    expect(pages).toHaveLength(13);
    expect(out.html).toContain('<span class="route-count">2 / 13</span>');
    expect(out.html).not.toContain('<span class="route-count">1 / 13</span>');
    const strip = (html) => html.replace(/<html lang="en-GB" class="kit-\w+">/, "");
    expect(strip(draw(sample.content.sections, "web").html)).toBe(strip(out.html));
    expect(strip(draw(sample.content.sections, "studio").html)).toBe(strip(out.html));
  });

  test("values are escaped: a section's words never become markup", () => {
    const sections = [{ key: "terms", layout: "terms", heading: "<script>alert(1)</script>", items: [{ label: "Fees", detail: '"><img src=x onerror=alert(1)>' }] }];
    const out = draw(sections).html;
    expect(out).not.toContain("<script>alert(1)");
    expect(out).not.toContain("<img src=x");
    expect(out).toContain("&lt;script&gt;");
  });

  test("a hidden section is not drawn, and its pages count none", () => {
    const sections = sample.content.sections.map((s) => (s.key === "proof" ? { ...s, hidden: true } : s));
    const out = draw(sections);
    expect(out.html.match(/<section class="page /g)).toHaveLength(12);
    expect(out.sections.find((s) => s.key === "proof")).toMatchObject({ hidden: true, pages: 0 });
  });

  test("a long section continues on the next page with its heading repeated", () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ title: `Promise ${i + 1}`, detail: null, icon: "star" }));
    const out = draw([{ key: "deliverables", layout: "deliverables", heading: "What We Will Do", items }]);
    expect(out.sections[0].pages).toBe(2);
    expect(out.html.match(/<h2 class="h1">What We Will Do<\/h2>/g)).toHaveLength(2);
    expect(out.html).toContain('<span class="item-no">7</span>');
  });

  test("stand-in photographs are listed, an uploaded one is not", () => {
    const A1 = "5d0b6c2e-8f4a-4c1b-9e3d-2a7f6b8c9d01";
    const out = kit.renderProposal(sample.content, { ...sample.context, images: { [A1]: { src: "data:image/png;base64,AAAA", alt: "The lake" } } });
    expect(out.checks.stand_ins.map((s) => s.key)).toEqual(["cover", "closing"]);
    const withCover = sample.content.sections.map((s) => (s.layout === "cover" ? { ...s, image_asset_id: A1 } : s));
    const again = kit.renderProposal({ sections: withCover }, { ...sample.context, images: { [A1]: { src: "data:image/png;base64,AAAA", alt: "The lake" } } });
    expect(again.checks.stand_ins.map((s) => s.key)).toEqual(["closing"]);
    expect(again.html).toContain('alt="The lake"');
  });

  test("every drawing is one the kit can inline, styled only by its classes", () => {
    for (const name of c.proposals.ILLUSTRATIONS) {
      const svg = fs.readFileSync(path.join(ROOT, "templates", "proposals", "illustrations", `${name}.svg`), "utf8");
      expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 240 180">/);
      expect(svg).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(|style=|<script|href=|fill="|stroke="/i);
      for (const m of svg.matchAll(/class="([^"]+)"/g)) for (const k of m[1].split(" ")) expect(["ln", "ln2", "fm", "fg", "fc", "fp"]).toContain(k);
    }
  });

  test("the kit's assets are those the hub holds (npm run gen:proposal-kit)", () => {
    for (const f of gen.outputs()) expect([path.relative(ROOT, f.to), fs.readFileSync(f.to).equals(f.bytes)]).toEqual([path.relative(ROOT, f.to), true]);
    expect(gen.tokensCss()).toContain("--k-gold: #FFDF55;");
    const css = fs.readFileSync(path.join(ROOT, "templates", "proposals", "kit.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });

  test("the gallery's page is the sample as the kit draws it, its content beside it", () => {
    for (const f of [gen.sampleOutput(), gen.sampleContentOutput()]) expect(fs.readFileSync(f.to).equals(f.bytes)).toBe(true);
  });
});

describe("the charts", () => {
  const series = (...v) => [{ name: null, points: v.map((value, i) => ({ label: `P${i + 1}`, value })) }];

  test("columns rise to a round top, a value over each", () => {
    const s = charts.shapes({ kind: "bar", title: "Downloads", unit: null, series: series(3200, 6800) }, { w: 600, h: 320 });
    expect(s.rects).toHaveLength(2);
    expect(s.rects[1].rh).toBeGreaterThan(s.rects[0].rh);
    expect(s.texts.filter((t) => t.cls === "c-value").map((t) => t.text)).toEqual(["3,200", "6,800"]);
    expect(charts.niceMax(6800)).toBe(10000);
  });

  test("a donut's slices add to the whole; progress rings are percentages", () => {
    const d = charts.shapes({ kind: "donut", title: "By City", unit: "%", series: series(60, 40) }, { w: 340, h: 300 });
    expect(d.legend.map((l) => l.name)).toEqual(["P1 60%", "P2 40%"]);
    expect(d.texts[0].text).toBe("60%");
    const r = charts.shapes({ kind: "progress", title: "Sold", unit: "%", series: series(92) }, { w: 340, h: 300 });
    expect(r.texts.map((t) => t.text)).toEqual(["92%", "P1"]);
  });

  test("a line, an area, stacked columns with a legend, and the figures in the chart's name for a reader", () => {
    const two = [
      { name: "2025", points: [{ label: "Jan", value: 1 }, { label: "Feb", value: 2 }] },
      { name: "2026", points: [{ label: "Jan", value: 3 }, { label: "Feb", value: 4 }] },
    ];
    const st = charts.shapes({ kind: "stacked", title: "Tickets", unit: null, series: two }, { w: 600, h: 320 });
    expect(st.legend.map((l) => l.name)).toEqual(["2025", "2026"]);
    expect(st.aria).toBe("Tickets: Jan 1, 3; Feb 2, 4");
    const area = charts.shapes({ kind: "area", title: "Reach", unit: "downloads", series: series(1200000, 2400000) }, { w: 600, h: 320 });
    expect(area.paths.map((p) => p.cls)).toEqual(["c-area c-s1", "c-line c-s1"]);
    expect(area.texts.find((t) => t.cls === "c-value").text).toBe("1.2M downloads");
  });
});

describe("the figure check", () => {
  const opp = (paragraph, sources = []) => ({ sections: [{ key: "opportunity", layout: "opportunity", heading: "The Moment", paragraphs: [paragraph], pull_quote: null, sources, unconfirmed: [], hidden: false }] });
  const known = content.knownOf({ deal: { estimated_value: "4500000.00", event_starts_on: "2026-12-18", options: [{ deal_price: "15000.00" }] }, proofPoints: [{ proof_point_id: "pp1", value: "10,000+", label: "People reached" }] });

  test("a figure with its source passes; one the record or a proof point states is sourced there", () => {
    expect(content.checkFigures(opp("4,500 guests a night.", [{ figure: "4,500 guests", source: "answer", ref: "q2" }]), known).unsourced).toEqual([]);
    const r = content.checkFigures(opp("Tickets from 15,000 to an audience of 10,000+."), known);
    expect(r.unsourced).toEqual([]);
    expect(r.content.sections[0].sources.map((s) => [s.figure, s.source])).toEqual([["15,000", "record"], ["10,000", "proof_point"]]);
  });

  test("an unsourced figure is named, and then marked for the person to confirm", () => {
    const r = content.checkFigures(opp("Last year 2,100 came; this year 3,000."), known);
    expect(r.unsourced).toEqual([{ key: "opportunity", figure: "2,100" }, { key: "opportunity", figure: "3,000" }]);
    expect(content.markUnconfirmed(r.content, r.unsourced).sections[0].unconfirmed).toEqual(["2,100", "3,000"]);
  });

  test("dates are sourced by the record or by a source naming them in words", () => {
    const tl = (starts) => ({ sections: [{ key: "timeline", layout: "timeline", heading: "When", phases: [{ name: "The Weekend", starts_on: starts, ends_on: null, detail: "Three nights" }], sources: [{ figure: "20 November 2026", source: "answer", ref: "q4" }], unconfirmed: [], hidden: false }] });
    expect(content.checkFigures(tl("2026-12-18"), known).unsourced).toEqual([]);
    expect(content.checkFigures(tl("2026-11-20"), known).unsourced).toEqual([]);
    expect(content.checkFigures(tl("2026-11-21"), known).unsourced).toEqual([{ key: "timeline", figure: "2026-11-21" }]);
  });

  test("Change Layout offers what fits and moves the content there", () => {
    const why = sample.content.sections.find((s) => s.layout === "why_mycity");
    const parsed = c.proposals.Section.parse(why);
    expect(content.fitsOf(parsed)).toEqual(["why_mycity", "audience", "proof"]);
    expect(content.convert(parsed, "proof").results.map((r) => r.value)).toEqual(["120,000+", "340", "6"]);
    expect(() => content.convert(parsed, "packages")).toThrow();
    const aud = c.proposals.Section.parse(sample.content.sections.find((s) => s.layout === "audience"));
    expect(content.fitsOf(aud)).toContain("insight");
    expect(content.convert(aud, "insight")).toMatchObject({ layout: "insight", chart: aud.chart });
  });
});
