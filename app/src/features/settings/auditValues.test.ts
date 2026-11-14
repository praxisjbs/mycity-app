import { describe, expect, it } from "vitest";
import { valueLines } from "./auditValues";

describe("an audit value as a person reads it", () => {
  it("a role's grants and masked fields read one line a key, never as JSON", () => {
    expect(valueLines({ "employee.bank": "masked", people: "view · all" })).toEqual(["employee bank: masked", "people: view · all"]);
  });

  it("a list reads as its items, a plain value as itself, nothing as no line", () => {
    expect(valueLines(["regional_lead", "employee"])).toEqual(["regional_lead, employee"]);
    expect(valueLines("Regional Lead")).toEqual(["Regional Lead"]);
    expect(valueLines(0)).toEqual(["0"]);
    expect(valueLines(null)).toEqual([]);
  });

  it("something deeper still reads in words", () => {
    expect(valueLines({ grants: { ess: "view" } })).toEqual(["grants: ess: view"]);
  });
});
