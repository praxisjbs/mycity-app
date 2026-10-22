"use strict";
/**
 * The Performance importers' reading of MyCity's workbooks (docs/guides/performance.md §6.19), on
 * the copies staging loads, seeds/staging/performance/: what the extract hooks make of each sheet,
 * and the words the importers turn into fields.
 */
const fs = require("node:fs");
const path = require("node:path");
const { readSheets } = require("../../src/shared/spreadsheet/parse");
const workbook = require("../../src/modules/goals/goals.workbook");
const okr = require("../../src/modules/goals/goals.import");
const kpis = require("../../src/modules/kpis/kpis.import");
const cards = require("../../src/modules/targets/targets.import");

const FIXTURES = path.join(__dirname, "..", "..", "seeds", "staging", "performance");
const sheetsOf = async (file) => (await readSheets({ buffer: fs.readFileSync(path.join(FIXTURES, file)), filename: file })).sheets;
const Q4 = { starts_on: "2026-10-01" };

describe("performance workbook import", () => {
  test("the OKR workbook: every key result with its objective, the company's first, former IDs kept", async () => {
    const { rows } = workbook.extractKeyResults(await sheetsOf("q4-2026-okrs.xlsx"));
    expect(rows).toHaveLength(51);
    expect(rows[0]).toMatchObject({ function: "Company", objective_code: "CO-O1", code: "CO-KR1.1", accountable: "CEO with interim finance owner" });
    expect(rows.findIndex((r) => r.function !== "Company")).toBe(17);
    const tbo = rows.find((r) => r.code === "TBO-KR3.3");
    expect(tbo).toMatchObject({ function: "Technology & Back-office Ops", objective_code: "TBO-O3", former_codes: "OP-KR2.2" });
    expect(rows.find((r) => r.code === "CO-KR1.2").scored_from).toBe("TBO-KR2.3");
    expect(rows.find((r) => r.code === "TBO-KR1.1").status).toBe("On track");
  });

  test("the KPIs: each function's table, never the company's", async () => {
    const { rows } = workbook.extractKpis(await sheetsOf("q4-2026-okrs.xlsx"));
    expect(rows).toHaveLength(45);
    expect(rows.find((r) => r.code === "TBO-K08")).toMatchObject({ former_codes: "OP-K01", unit: "%", direction: "Higher is better" });
  });

  test("the scorecards: each person's numbered lines with their reviewer and scope", async () => {
    const { rows } = cards.extract(await sheetsOf("q4-2026-scorecards.xlsx"));
    const tobi = rows.filter((r) => r.employee === "Tobiloba Dada");
    expect(tobi).toHaveLength(9);
    expect(tobi[0]).toMatchObject({ line_key: "Tobiloba Dada #1", reviewer: "Oladotun Shola Adido", section: "results", linked: "OP-KR1.1", weight: 15 });
    expect(tobi[4]).toMatchObject({ section: "kpis", linked: "OP-K01", weight: 8 });
    expect(tobi.reduce((n, r) => n + r.weight, 0)).toBe(100);
  });

  test("a workbook that is not the one an importer reads is refused", async () => {
    const scorecards = await sheetsOf("q4-2026-scorecards.xlsx");
    const okrs = await sheetsOf("q4-2026-okrs.xlsx");
    expect(() => workbook.extractKeyResults(scorecards)).toThrow(/not the OKR workbook/);
    expect(() => cards.extract(okrs)).toThrow(/not the scorecards workbook/);
  });

  test("words into fields: type, status, dates, initiatives, targets", () => {
    expect(okr.typeOf("Diagnostic gate — retires on sign-off")).toBe("diagnostic_gate");
    expect(okr.typeOf("Compliance, floor → BM-K09 from Q1")).toBe("compliance_floor");
    expect(okr.typeOf("Enabling / compliance, retiring")).toBe("enabling");
    expect(okr.typeOf("Outcome — co-owned")).toBe("outcome");
    expect(okr.typeOf("Something else")).toBeNull();
    expect(okr.statusOf("On track")).toBe("on_track");
    expect(okr.statusOf("Pending Review")).toBeNull();
    expect(okr.dateIn("CEO, 31 Oct", Q4)).toBe("2026-10-31");
    expect(okr.dateIn("6 Jan", Q4)).toBe("2027-01-06");
    expect(okr.dateIn("December", Q4)).toBeNull();
    expect(okr.initiativesOf("• Pull downloads — 10 Oct\n• Weekly digest — from 15 Nov\n• Retarget buyers — December", Q4)).toEqual([
      { title: "Pull downloads", due_on: "2026-10-10" },
      { title: "Weekly digest", due_on: "2026-11-15" },
    ]);
    expect(kpis.targetNumber("≥99.5%")).toBe("99.5");
    expect(kpis.targetNumber("≥3.0×")).toBe("3");
    expect(kpis.targetNumber("[TBC] — October baseline + 20%")).toBeNull();
    expect(kpis.targetNumber("≤ approved ceiling")).toBeNull();
    expect(kpis.frequencyOf("Weekly check; monthly minimum")).toBe("weekly");
    expect(kpis.directionOf("Lower is better")).toBe("lower");
    expect(kpis.resultOf("N/A")).toBe("na");
    expect(cards.percentOf("≥98% — One-off events removed")).toBe("98");
    expect(okr.distance("iyersehen", "iyeserhen")).toBe(2);
  });
});
