// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { SITTINGS } from "@/api/mock/data/recruitment";
import { sid } from "@/api/mock/core";
import { copyProblems, dialog, openAs, openRow, press, settled } from "./testKit";

/**
 * Recruitment · Assessments on the in-browser mock (docs/guides/recruitment.md §6.7, §10): the
 * library with MyCity's Graphics and Motion Design brief and its questions; the sittings waiting to be
 * marked (`?marking=true`); Mark Answers refuses a mark above a question's points and scores the
 * sitting once every answer marked by hand has its mark.
 */

vi.mock("@/api/mock/core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@/api/mock/core")>();
  return { ...core, dispatch: vi.fn(core.dispatch) };
});

expect.extend(axeMatchers);
installMatchMedia();
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T08:30:00Z"));
});
afterAll(() => vi.useRealTimers());
afterEach(() => {
  cleanup();
  setViewport(1440);
});

describe("Recruitment · Assessments", () => {
  it("the library shows the brief with its questions and points", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=assessments");
    for (const label of ["Active", "Sent", "Awaiting Marking", "Average Score"]) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(copyProblems()).toEqual([]);
    expect(await axe(document.body)).toHaveNoViolations();
    const sheet = await openRow("Graphics and Motion Design Brief");
    expect(within(sheet).getByText(/Upload the festival poster/)).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Send to Candidates" })).toBeTruthy();
  }, 60000);

  it("Mark Answers refuses a mark above the points, then scores the sitting", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=assessments&marking=true");
    const sheet = await openRow("Ngozi Eze");
    expect(within(sheet).getByRole("button", { name: /festival-poster\.pdf/ })).toBeTruthy();
    expect(within(sheet).getByText("https://drive.example.test/festival-motion")).toBeTruthy();
    expect(copyProblems()).toEqual([]);

    const marks = within(sheet).getAllByLabelText("Mark");
    fireEvent.change(marks[0]!, { target: { value: "45" } });
    fireEvent.change(marks[1]!, { target: { value: "32" } });
    fireEvent.change(marks[2]!, { target: { value: "16" } });
    await press(sheet, "Mark Answers");
    expect(within(dialog()).getByText("At most 40")).toBeTruthy();
    const sitting = SITTINGS.find((s) => s.application_assessment_id === sid("sit:design:ngozi"))!;
    expect(sitting.status).toBe("submitted");

    fireEvent.change(within(dialog()).getAllByLabelText("Mark")[0]!, { target: { value: "36" } });
    await press(dialog(), "Mark Answers");
    await settled();
    expect(sitting.status).toBe("scored");
    expect(sitting.score).toBe(84);
  }, 60000);

  it("a sitting's own link (?sitting=) opens it, and one not yet started can be cancelled", async () => {
    await openAs("cynthia@mycityapp.io", `/recruitment?tab=assessments&sitting=${sid("sit:design:segun")}`);
    const sheet = dialog();
    expect(within(sheet).getByText(/Graphics and Motion Design Brief/)).toBeTruthy();
    expect(within(sheet).queryByLabelText("Mark")).toBeNull();
    await press(sheet, "Cancel Sitting");
    expect(SITTINGS.find((s) => s.application_assessment_id === sid("sit:design:segun"))!.status).toBe("cancelled");
  }, 60000);
});
