"use strict";
/**
 * The Partnership Tracker and Partnership Returns importers' reading of a workbook
 * (docs/guides/partnerships.md §6.13, §6.14), without a database: the synthetic tracker
 * (tests/fixtures/partnership-tracker.synthetic.xlsx: the real headers, dropdowns and value shapes,
 * invented organisations and contacts) read column by column, and each cell rule on its own.
 */
const fs = require("node:fs");
const path = require("node:path");
const { readSheets } = require("../../src/shared/spreadsheet/parse");
const tracker = require("../../src/modules/partners/partners.import");
const returns = require("../../src/modules/partner_pipeline/partner_pipeline.returns.import");

const FIXTURE = path.join(__dirname, "..", "fixtures", "partnership-tracker.synthetic.xlsx");

describe("the Partnership Tracker's cells", () => {
  test("contact details split by shape: a phone, an email, two phones, an email and a phone", () => {
    expect(tracker.splitContact("0803 123 4567")).toEqual({ email: null, phones: ["+2348031234567"] });
    expect(tracker.splitContact("Chidi@HarbourGrill.example")).toEqual({ email: "chidi@harbourgrill.example", phones: [] });
    expect(tracker.splitContact("0812 345 6789 / 0909 876 5432")).toEqual({ email: null, phones: ["+2348123456789", "+2349098765432"] });
    expect(tracker.splitContact("hauwa@startupweek.example, 0701 222 3344")).toEqual({ email: "hauwa@startupweek.example", phones: ["+2347012223344"] });
    expect(tracker.splitContact("+233 24 123 4567").phones).toEqual(["+233241234567"]);
    expect(tracker.splitContact("")).toEqual({ email: null, phones: [] });
  });

  test("a contact's name loses its title; one word is a first name", () => {
    expect(tracker.splitName("Mrs. Tolu Adeyemi")).toEqual({ first_name: "Tolu", last_name: "Adeyemi" });
    expect(tracker.splitName("Kwame")).toEqual({ first_name: "Kwame", last_name: "" });
  });

  test("a region is cities in any case, PH for Port Harcourt, or a scope", () => {
    expect(tracker.regionOf("IBADAN, ibadan & PH")).toEqual({ scope: "cities", cities: ["IBADAN", "ibadan", "PH"] });
    expect(tracker.cityWords("IBADAN")).toBe("Ibadan");
    expect(tracker.cityWords("PH")).toBe("Port Harcourt");
    expect(tracker.regionOf("National")).toEqual({ scope: "national", cities: [] });
    expect(tracker.regionOf("Africa")).toEqual({ scope: "africa", cities: [] });
    expect(tracker.regionOf("Worldwide")).toEqual({ scope: "worldwide", cities: [] });
    expect(tracker.regionOf("Lagos, National")).toEqual({ scope: "cities", cities: ["Lagos"] });
    expect(tracker.regionOf("")).toBeNull();
  });

  test("the six date shapes, read day-first; a month alone is its 1st; a missing year is the sheet's", () => {
    expect(tracker.parseTrackerDate("25th June 26", 2026)).toMatchObject({ date: "2026-06-25", month_only: false });
    expect(tracker.parseTrackerDate("3rd of July", 2026)).toMatchObject({ date: "2026-07-03", year_missing: true });
    expect(tracker.parseTrackerDate("24th of July, 2026", 2025)).toMatchObject({ date: "2026-07-24", year_missing: false });
    expect(tracker.parseTrackerDate("Sept 2026", 2025)).toMatchObject({ date: "2026-09-01", month_only: true });
    expect(tracker.parseTrackerDate("July 24, 2026", 2025).date).toBe("2026-07-24");
    expect(tracker.parseTrackerDate("15/09/2026", 2025).date).toBe("2026-09-15");
    expect(tracker.parseTrackerDate("2026-08-10T00:00:00.000Z", 2025).date).toBe("2026-08-10");
    expect(tracker.parseTrackerDate("This week", 2026).date).toBeNull();
    expect(tracker.parseTrackerDate("31st of June", 2026).date).toBeNull();
    expect(tracker.sheetYear(["25th June 26", "3rd of July", "24th of July, 2026", "1st May 2025"])).toBe(2026);
  });

  test("potential impact: values, or a rating with its note", () => {
    expect(tracker.impactOf("Brand Visibility")).toEqual({ values: ["Brand Visibility"], rating: null, note: null });
    expect(tracker.impactOf("High: strong student reach")).toEqual({ values: [], rating: "high", note: "strong student reach" });
    expect(tracker.impactOf("Medium - some reach")).toMatchObject({ rating: "medium", note: "some reach" });
  });
});

describe("the synthetic tracker, read whole", () => {
  let out;
  const row = (name) => out.rows.find((r) => r.name === name);
  beforeAll(async () => {
    const book = await readSheets({ buffer: fs.readFileSync(FIXTURE), filename: "tracker.xlsx" });
    out = tracker.extract(book.sheets);
  });

  test("Master Tracker's header on row 2; a row with no partner name skipped; other columns named", () => {
    expect(out.rows.map((r) => r.name)).toEqual([
      "Eko Arts Fair",
      "Harbour Grill House",
      "Savannah Tech Hub",
      "Blue Lagoon Resort",
      "Owerri Food Festival",
      "Pan-African Media Group",
      "Abuja Startup Week",
      "Eko Arts Fair",
    ]);
    expect(out.notes).toEqual(["1 rows with no partner name were skipped", "Other columns: Instagram Handle"]);
  });

  test("each column to its field", () => {
    expect(row("Harbour Grill House")).toMatchObject({ email: "chidi@harbourgrill.example", phones: null, region: "PH", stage: "Partnership Signed", owner: "Mr. John", identified_on: "2026-07-03", status: "Active Partnership" });
    expect(row("Savannah Tech Hub")).toMatchObject({
      phones: "+2348123456789, +2349098765432",
      category: "Ticketing (exclusive)",
      commission_pct: 8,
      stage: "Proposal drafted, outreach to begin",
      impact: "High: strong student reach in Ibadan",
      next_action: "Send the revised deck; This week",
      expected_close_on: null,
    });
    expect(row("Savannah Tech Hub").comments).toBe("Current Stage: Awaiting deck from the founders");
    expect(row("Owerri Food Festival")).toMatchObject({ identified_on: "2026-08-10", expected_close_on: "2026-11-30", comments: "Waiting on the sponsor's legal team" });
    expect(row("Blue Lagoon Resort")).toMatchObject({ identified_on: "2026-09-01", status: "Closed" });
    expect(row("Blue Lagoon Resort").comments).toContain("Date Identified was a month only (Sept 2026)");
    expect(row("Pan-African Media Group")).toMatchObject({ phones: "+233241234567", identified_on: "2026-09-15", current_stage: "Invoicing" });
    expect(row("Pan-African Media Group").comments).toBeNull();
    expect(JSON.parse(row("Eko Arts Fair").other)).toEqual({ "Instagram Handle": "@ekoartsfair" });
  });

  test("a workbook that is not the tracker is refused", () => {
    expect(() => tracker.extract([{ name: "Sheet1", rows: [["Name", "Colour"], ["Mango", "ginger"]] }])).toThrow(/not the partnership tracker/);
  });
});

describe("the Partnership Returns report", () => {
  test("months in the shapes a report writes them", () => {
    expect(returns.monthOf("2026-11")).toBe("2026-11");
    expect(returns.monthOf("Nov 2026")).toBe("2026-11");
    expect(returns.monthOf("November, 2026")).toBe("2026-11");
    expect(returns.monthOf("11/2026")).toBe("2026-11");
    expect(returns.monthOf("2026-11-14T00:00:00.000Z")).toBe("2026-11");
    expect(returns.monthOf("someday")).toBeNull();
  });

  test("each row gets its line: the deal and the month, read back the same", () => {
    const { rows } = returns.extract([
      {
        name: "October",
        rows: [
          ["Returns report"],
          ["Deal Number", "Partner", "Deal", "Month", "Units Sold", "Gross Sales", "MyCity Commission", "Paid to Partner", "Downloads"],
          ["DEAL-2026-0004", null, null, "Oct 2026", 120, 1200000, 96000, 1104000, 340],
          [null, "Harbour Grill House", "Hospitality Partnership", "2026-10", 5, null, null, null, 12],
        ],
      },
    ]);
    expect(rows.map((r) => r.line_key)).toEqual(["DEAL-2026-0004 · 2026-10", "Harbour Grill House / Hospitality Partnership · 2026-10"]);
    expect(returns.lineOf(rows[0].line_key)).toEqual({ number: "DEAL-2026-0004", month: "2026-10" });
    expect(returns.lineOf(rows[1].line_key)).toEqual({ partner: "Harbour Grill House", title: "Hospitality Partnership", month: "2026-10" });
    expect(() => returns.extract([{ name: "S", rows: [["A", "B"]] }])).toThrow(/not a returns report/);
  });
});
