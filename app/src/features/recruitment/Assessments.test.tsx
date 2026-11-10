// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { ASSESSMENTS, SITTINGS } from "@/api/mock/data/recruitment";
import { dispatch, sid } from "@/api/mock/core";
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

/** On a wide desktop a record opens beside its list, never in a dialog (F31): the card its heading heads, holding `inside`. */
async function openBeside(text: string, heading: string, inside: RegExp | string) {
  fireEvent.click((await screen.findAllByText(text, undefined, { timeout: 8000 }))[0]!);
  await settled();
  expect(screen.queryByRole("dialog")).toBeNull();
  return paneOf(heading, inside);
}

/** The pane beside the list: the card whose heading is `heading`. */
async function paneOf(heading: string, inside: RegExp | string) {
  let pane: HTMLElement = await screen.findByRole("heading", { name: heading, level: 2 });
  while (pane.parentElement && !within(pane).queryAllByText(inside).length) pane = pane.parentElement;
  return pane;
}

describe("Recruitment · Assessments", () => {
  it("the library shows the brief with its questions and points", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=assessments");
    for (const label of ["Active", "Sent", "Awaiting Marking", "Average Score"]) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(copyProblems()).toEqual([]);
    expect(await axe(document.body)).toHaveNoViolations();
    const sheet = await openBeside("Graphics and Motion Design Brief", "Assessment", /Upload the festival poster/);
    expect(copyProblems()).toEqual([]);
    expect(within(sheet).getByText(/Upload the festival poster/)).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Send to Candidates" })).toBeTruthy();
    expect(await axe(document.body)).toHaveNoViolations();
  }, 60000);

  it("between 761 and 1180 px, where two columns do not fit, an assessment opens in the dialog", async () => {
    setViewport(1024);
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=assessments");
    const sheet = await openRow("Graphics and Motion Design Brief");
    expect(within(sheet).getByText(/Upload the festival poster/)).toBeTruthy();
  }, 60000);

  it("Mark Answers refuses a mark above the points, then scores the sitting", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=assessments&marking=true");
    const sheet = await openBeside("Ngozi Eze", "Ngozi Eze", "Mark Answers");
    expect(within(sheet).getByRole("button", { name: /festival-poster\.pdf/ })).toBeTruthy();
    expect(within(sheet).getByText("https://drive.example.test/festival-motion")).toBeTruthy();
    expect(copyProblems()).toEqual([]);

    const marks = within(sheet).getAllByLabelText("Mark");
    fireEvent.change(marks[0]!, { target: { value: "45" } });
    fireEvent.change(marks[1]!, { target: { value: "32" } });
    fireEvent.change(marks[2]!, { target: { value: "16" } });
    await press(sheet, "Mark Answers");
    expect(within(sheet).getByText("At most 40")).toBeTruthy();
    const sitting = SITTINGS.find((s) => s.application_assessment_id === sid("sit:design:ngozi"))!;
    expect(sitting.status).toBe("submitted");

    fireEvent.change(within(sheet).getAllByLabelText("Mark")[0]!, { target: { value: "36" } });
    await press(sheet, "Mark Answers");
    await settled();
    expect(sitting.status).toBe("scored");
    expect(sitting.score).toBe(84);
  }, 60000);

  it("a sitting's own link (?sitting=) opens it, and one not yet started can be cancelled", async () => {
    await openAs("cynthia@mycityapp.io", `/recruitment?tab=assessments&sitting=${sid("sit:design:segun")}`);
    await settled();
    expect(screen.queryByRole("dialog")).toBeNull();
    const sheet = await paneOf("Sitting", "Cancel Sitting");
    expect(within(sheet).getByText(/Graphics and Motion Design Brief/)).toBeTruthy();
    expect(within(sheet).queryByLabelText("Mark")).toBeNull();
    await press(sheet, "Cancel Sitting");
    expect(SITTINGS.find((s) => s.application_assessment_id === sid("sit:design:segun"))!.status).toBe("cancelled");
  }, 60000);

  it("Import takes an exported file through the upload engine and makes it here, switched off", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=assessments");
    await press(document.body, "Import");
    const form = dialog();
    const input = form.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['{"format":"mycity-assessment-1"}'], "motion-design-brief.json", { type: "application/json" });
    const importButton = () => within(form).getByRole("button", { name: "Import Assessment" }) as HTMLButtonElement;
    // Nothing to import until the file has arrived.
    expect(importButton().disabled).toBe(true);
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(importButton().disabled).toBe(false), { timeout: 8000 });
    expect(ASSESSMENTS.some((a) => a.name === "Motion Design Brief")).toBe(false);
    // One press, one request: a second press while it imports is refused (F26).
    vi.mocked(dispatch).mockClear();
    fireEvent.click(importButton());
    fireEvent.click(importButton());
    await waitFor(() => expect(ASSESSMENTS.some((a) => a.name === "Motion Design Brief")).toBe(true), { timeout: 8000 });
    await settled();
    expect(vi.mocked(dispatch).mock.calls.filter(([r]) => r.path.endsWith("/assessments/import/file"))).toHaveLength(1);
    expect(ASSESSMENTS.find((a) => a.name === "Motion Design Brief")!.active).toBe(false);
  }, 60000);
});
