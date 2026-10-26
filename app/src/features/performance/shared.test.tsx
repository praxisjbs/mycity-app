// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Me } from "@/api/types/identity";
import { checkInText } from "@/features/ess/Performance";
import { stepOfField } from "./Quarter";
import { nextStep } from "./Reviews";
import { fieldMessage, functionOptions, monthChoices, monthScores, onlyChoice, planOpen, setsGoalsFor, startMonth } from "./shared";

/**
 * The small rules the Performance screens share (docs/guides/performance.md §10): a field's mark in
 * four words, the From Month as a month of the quarter, a line's month scores for its sheet, the
 * step a refused quarter field sits on, what a waiting review asks of its reader, the check-in's
 * state as the person reads it, and which functions a Function select offers its reader
 * (§6.3). The clock is 03/11/2026.
 */

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-03T08:30:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

const QUARTER = ["2026-10-01", "2026-11-01", "2026-12-01"];

describe("a field's mark", () => {
  it("reads Zod's own sentences as their limit, never as the caller's short form", () => {
    // An empty Goal came back as Zod's six words and read "Shorten the goal", the opposite of the problem.
    expect(fieldMessage("String must contain at least 1 character(s)", "Shorten the goal")).toBe("Required");
    expect(fieldMessage("String must contain at most 200 character(s)", "Shorten the goal")).toBe("At most 200 characters");
    expect(fieldMessage("Pick the key results", "Link a key result")).toBe("Pick the key results");
    expect(fieldMessage("Something long the server said about this line", "Check the weight")).toBe("Check the weight");
    expect(fieldMessage(undefined, "Check the weight")).toBeUndefined();
  });
});

describe("From Month", () => {
  it("offers the quarter's months by name and starts on this one", () => {
    expect(monthChoices(QUARTER)).toEqual([
      ["2026-10-01", "October 2026"],
      ["2026-11-01", "November 2026"],
      ["2026-12-01", "December 2026"],
    ]);
    expect(startMonth(QUARTER)).toBe("2026-11-01");
    // A quarter this month is not in starts on its first month.
    expect(startMonth(["2027-01-01", "2027-02-01", "2027-03-01"])).toBe("2027-01-01");
    expect(startMonth([])).toBe("");
  });
});

describe("a line's sheet", () => {
  it("lists each month of the quarter with its score, a dash where none", () => {
    const line = { months: [{ month: "2026-10-01", score: "0.8" }, { month: "2026-11-01", score: null }] };
    expect(monthScores(line, QUARTER)).toEqual([
      ["October 2026", "0.80"],
      ["November 2026", "–"],
      ["December 2026", "–"],
    ]);
  });
});

describe("Set Up Quarter", () => {
  it("knows the step each field sits on, so a refusal takes the person back to it", () => {
    expect(stepOfField("starts_on")).toBe(0);
    expect(stepOfField("status")).toBe(0);
    expect(stepOfField("key_results/band_good")).toBe(1);
    expect(stepOfField("sections/results")).toBe(4);
    expect(stepOfField("nothing")).toBe(-1);
  });
});

describe("Waiting On You", () => {
  const reviewer = { employee_id: "r1", display_name: "Ada", job_title: null, department: null, photo_url: null };
  it("names the button the review shows its reader", () => {
    expect(nextStep({ status: "with_reviewer", reviewer }, "r1")).toBe("Score");
    expect(nextStep({ status: "returned", reviewer }, "someone")).toBe("Give Input");
    expect(nextStep({ status: "second_level", reviewer }, "x")).toBe("Approve");
    expect(nextStep({ status: "with_hr", reviewer }, "x")).toBe("Close Review");
  });
});

describe("My Performance's This Month", () => {
  it("reads a review sent back to its reviewer as With Reviewer, never Returned", () => {
    expect(checkInText(null)).toBe("None Open");
    expect(checkInText({ status: "check_in", due_on: "2026-11-05" })).toBe("Due 05/11/2026");
    expect(checkInText({ status: "returned", due_on: null })).toBe("With Reviewer");
    expect(checkInText({ status: "with_hr", due_on: null })).toBe("With HR");
  });
});

describe("the functions a Function select offers", () => {
  const reader = (over: Partial<Me> = {}) => ({ employee_id: "e-pm", is_ceo: false, capabilities: [], ...over }) as Me;
  const rows = [
    { department_id: "d-gm", name: "General Management", active: true, acting_head: { employee_id: "e-ceo" } },
    { department_id: "d-pg", name: "Partnership & Growth", active: true, acting_head: { employee_id: "e-pm" } },
    { department_id: "d-bm", name: "Branding & Marketing", active: true, acting_head: { employee_id: "e-bm" } },
    { department_id: "d-old", name: "Retired Function", active: false, acting_head: { employee_id: "e-pm" } },
    { department_id: "d-none", name: "No Head Yet", active: true, acting_head: null },
  ];

  it("offers a holder of goals.function the functions they head or act for, never another's", () => {
    // The Program Manager is Management: General Management is the CEO's, so it is not offered; Partnership & Growth, with its head seat vacant, is.
    const manager = reader({ capabilities: ["goals.company", "goals.function"] });
    expect(functionOptions(manager, rows)).toEqual([["d-pg", "Partnership & Growth"]]);
    expect(setsGoalsFor(manager, rows[0]!)).toBe(false);
    expect(setsGoalsFor(manager, rows[1]!)).toBe(true);
  });

  it("offers nothing without goals.function, even to the head", () => {
    expect(functionOptions(reader({ capabilities: ["goals.company"] }), rows)).toEqual([]);
    expect(functionOptions(reader(), rows)).toEqual([]);
  });

  it("offers every active function to whoever runs the cycle, and to the CEO", () => {
    const names = ["General Management", "Partnership & Growth", "Branding & Marketing", "No Head Yet"];
    const operations = reader({ employee_id: "e-ops", capabilities: ["goals.function", "performance.manage"] });
    expect(functionOptions(operations, rows).map(([, name]) => name)).toEqual(names);
    expect(functionOptions(reader({ employee_id: "e-ceo", is_ceo: true }), rows).map(([, name]) => name)).toEqual(names);
  });

  it("never matches a reader with no employee to an empty head", () => {
    expect(setsGoalsFor(reader({ employee_id: "", capabilities: ["goals.function"] }), { acting_head: null })).toBe(false);
  });
});

describe("a plan that still takes objectives", () => {
  const plans = [
    { department_id: "d-bm", status: "binding" },
    { department_id: "d-pc", status: "submitted" },
    { department_id: "d-gm", status: "returned" },
    { department_id: "d-pg", status: "draft" },
    { department_id: null, status: "binding" },
  ];
  it("is open when it is not made yet, a draft or returned; sent and binding are closed", () => {
    expect(planOpen(plans, "d-bm")).toBe(false);
    expect(planOpen(plans, "d-pc")).toBe(false);
    expect(planOpen(plans, "d-gm")).toBe(true);
    expect(planOpen(plans, "d-pg")).toBe(true);
    expect(planOpen(plans, "d-tbo")).toBe(true);
    expect(planOpen(plans, null)).toBe(false);
    expect(planOpen([], null)).toBe(true);
  });
});

describe("what a form's select starts on", () => {
  const two: Array<[string, string]> = [["a", "A"], ["b", "B"]];
  it("keeps the pick the page made when it is offered, else the only choice, else none", () => {
    expect(onlyChoice(two, "b")).toBe("b");
    expect(onlyChoice(two, "c")).toBe("");
    expect(onlyChoice(two)).toBe("");
    expect(onlyChoice([["a", "A"]], "c")).toBe("a");
    expect(onlyChoice([["", "Company"], ["a", "A"]])).toBe("");
    expect(onlyChoice([])).toBe("");
  });
});
