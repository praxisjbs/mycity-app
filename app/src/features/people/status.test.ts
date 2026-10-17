import { describe, expect, test } from "vitest";
import { employmentStatus, loginStatus, employmentType, workPattern } from "./status";

/** The pills People read on the register, from the facts the API sends. */
describe("employment status", () => {
  const base = { status: "active" as const, confirmation_due_on: null, confirmed_on: null };

  test("active with nothing pending", () => {
    expect(employmentStatus({ ...base, confirmed_on: "2026-02-01" })).toEqual({ tone: "ok", text: "Active" });
  });

  test("on probation until the day it is confirmed", () => {
    expect(employmentStatus({ ...base, confirmation_due_on: "2026-12-01" })).toEqual({ tone: "warn", text: "On Probation" });
    expect(employmentStatus({ ...base, confirmation_due_on: "2026-12-01", confirmed_on: "2026-11-01" })).toEqual({ tone: "ok", text: "Active" });
  });

  test("archived, suspended and left say so", () => {
    expect(employmentStatus({ ...base, status: "archived" }).text).toBe("Archived");
    expect(employmentStatus({ ...base, status: "suspended" }).text).toBe("Suspended");
    expect(employmentStatus({ ...base, status: "left" }).text).toBe("Left");
  });

  test("archived wins over a probation date it still carries", () => {
    expect(employmentStatus({ ...base, status: "archived", confirmation_due_on: "2026-12-01" }).text).toBe("Archived");
  });
});

describe("login status", () => {
  test("each state has its own pill", () => {
    expect(loginStatus("none")).toEqual({ tone: "neutral", text: "No Login" });
    expect(loginStatus("invited")).toEqual({ tone: "info", text: "Invited" });
    expect(loginStatus("active")).toEqual({ tone: "ok", text: "Active" });
    expect(loginStatus("suspended")).toEqual({ tone: "err", text: "Suspended" });
  });
});

describe("the words for the wire's values", () => {
  test("work pattern and employment type are Title Case", () => {
    expect(workPattern("on_site")).toBe("On Site");
    expect(workPattern("remote")).toBe("Remote");
    expect(employmentType("full_time")).toBe("Full Time");
    expect(employmentType("consultant")).toBe("Consultant");
  });
});
