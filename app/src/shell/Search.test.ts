// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { SearchHit } from "@mycity/contract/contract.gen.ts";
import { searchResult, type SearchDay } from "@/api/mock/data/search";
import { PEOPLE } from "@/api/mock/data/people";
import { opensFrom, screenOfLink } from "@/lib/plan";
import { shownHit } from "./Search";

/**
 * ⌘K (docs/guides/foundation.md §6.7): nothing that would open Coming Soon in this build, and a
 * person's attendance days read as the person, the status and the date, three at most after them.
 */

const hit = (over: Partial<SearchHit>): SearchHit => ({ id: "x", kind: "record", type: "expense", title: "EXR-0004", sub: null, ref: null, status: null, link: null, run: null, ...over });

/** A build where Expenses is Coming Soon (Milestone 8) and everything else opens. */
const opens = opensFrom((moduleKey) => moduleKey !== "expenses");

describe("what opens, read from links", () => {
  it("reads the screen a link lands on", () => {
    expect(screenOfLink("/expenses?tab=approvals&id=42")).toEqual({ moduleKey: "expenses", tab: "approvals" });
    expect(screenOfLink("/praxis-ai?tab=ask")).toEqual({ moduleKey: "praxis_ai", tab: "ask" });
    expect(screenOfLink("/people")).toEqual({ moduleKey: "people", tab: null });
    expect(screenOfLink("https://example.com/x")).toBeNull();
  });

  it("holds back a link, a screen's module and a whole module by the one screen rule", () => {
    expect(opens.link("/expenses?tab=approvals&id=42")).toBe(false);
    expect(opens.link("/expenses")).toBe(false);
    expect(opens.module("expenses")).toBe(false);
    expect(opens.link("/people?tab=attendance&id=1")).toBe(true);
    expect(opens.module("people")).toBe(true);
    // A link outside the app's screens is never held back.
    expect(opens.link("/nowhere?tab=x")).toBe(true);
  });

  it("opens a module when any one of its tabs opens", () => {
    const onlyMyLeave = opensFrom((moduleKey, tab) => moduleKey === "ess" && tab === "my-leave");
    expect(onlyMyLeave.module("ess")).toBe(true);
    expect(onlyMyLeave.module("people")).toBe(false);
  });
});

describe("⌘K's results", () => {
  const shown = (h: SearchHit, canInstall = true) => shownHit(h, { canInstall, opens });

  it("leaves out a record, a screen or an action that would open Coming Soon", () => {
    expect(shown(hit({ link: "/expenses?tab=approvals&id=42" }))).toBe(false);
    expect(shown(hit({ kind: "screen", type: "screen", title: "Approvals", link: "/expenses?tab=approvals" }))).toBe(false);
    expect(shown(hit({ kind: "action", type: "action", title: "New Request", link: "/expenses?tab=my-requests&action=new" }))).toBe(false);
    expect(shown(hit({ type: "employee", link: "/people?tab=employees&id=1" }))).toBe(true);
  });

  it("leaves out a Home card counting a module that is Coming Soon, though Home opens", () => {
    expect(shown(hit({ type: "home_kpi", title: "Expenses Awaiting Approval", link: "/home?tab=overview&id=expenses_pending", module: "expenses" }))).toBe(false);
    expect(shown(hit({ type: "home_kpi", title: "Headcount", link: "/home?tab=overview&id=headcount", module: "people" }))).toBe(true);
  });

  it("keeps an action the app runs itself, and Install App only where the browser can install", () => {
    expect(shown(hit({ kind: "action", type: "action", title: "Sign Out", run: "sign_out" }))).toBe(true);
    expect(shown(hit({ kind: "action", type: "action", title: "Install App", run: "install" }), false)).toBe(false);
  });
});

describe("a person's attendance days in ⌘K (the mock, as the API)", () => {
  const ada = PEOPLE[0]!;
  const days: SearchDay[] = ["2026-10-19", "2026-10-26", "2026-10-21", "2026-10-22", "2026-10-20"].map((date, i) => ({
    person: ada,
    attendance_day_id: `day-${i}`,
    attendance_date: date,
    status: i === 1 ? "late" : i === 3 ? null : "present",
  }));
  const all = { people: ["view"] };

  it("lists the person first, then three of their days, newest first, each with its status and date", () => {
    const groups = searchResult(PEOPLE, all, ada.first_name, null, 1, days).groups;
    const types = groups.filter((g) => g.kind === "record").map((g) => g.type);
    expect(types).toEqual(["employee", "attendance_record"]);
    const shownDays = groups.find((g) => g.type === "attendance_record")!.items;
    expect(shownDays.map((d) => d.sub)).toEqual(["Late · 26/10/2026", "Not Counted · 22/10/2026", "Present · 21/10/2026"]);
    expect(shownDays.every((d) => d.title === `${ada.first_name} ${ada.last_name}`)).toBe(true);
    expect(shownDays[0]!.link).toBe("/people?tab=attendance&id=day-1");
  });

  it("finds no days without People, and none for a line too short to search", () => {
    expect(searchResult(PEOPLE, { ess: ["view"] }, ada.first_name, null, 1, days).groups.some((g) => g.type === "attendance_record")).toBe(false);
    expect(searchResult(PEOPLE, all, ada.first_name.slice(0, 1), null, 1, days).groups.some((g) => g.type === "attendance_record")).toBe(false);
  });
});
