// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toaster } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { APPLICATIONS } from "@/api/mock/data/recruitment";
import { choose, copyProblems, dialog, moreActions, openAs, openRow, press, type } from "./testKit";

/**
 * Recruitment · Candidates on the in-browser mock (docs/guides/recruitment.md §6.3 to §6.5, §10): the
 * board's five stages; a candidate's sheet with the screening read, the weighted total over the parts
 * scored, and Move To; Not Progressing asks for a reason and Reopen puts the candidate back; a score
 * still Provisional says so.
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

const app = (first: string) => APPLICATIONS.find((a) => a.first_name === first)!;

describe("Recruitment · Candidates", () => {
  it("shows the board's five stages, and a candidate's sheet with the weighted total", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=candidates");
    for (const stage of ["Applied", "Screening", "Assessment", "Interview", "Shortlist"]) expect(screen.getAllByText(stage).length).toBeGreaterThan(0);
    expect(copyProblems()).toEqual([]);
    expect(await axe(document.body)).toHaveNoViolations();

    const sheet = await openRow("Emeka Obi");
    expect(within(sheet).getByText("Weighted Total")).toBeTruthy();
    expect(within(sheet).getByText(/of 5 parts|of 4 parts/)).toBeTruthy();
    expect(within(sheet).getByText("Sales Scenario Case Study")).toBeTruthy();
    expect(copyProblems()).toEqual([]);
  }, 60000);

  it("a score from the form only reads Provisional", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=candidates");
    const sheet = await openRow("Chinedu Okafor");
    expect(within(sheet).getAllByText("Provisional").length).toBeGreaterThan(0);
  }, 60000);

  it("Move To, then Not Progressing with its reason, then Reopen", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=candidates");
    let sheet = await openRow("Funke Bakare");
    // One button in view, the next stage ahead; the rest behind More Actions, Not Progressing last.
    expect(within(sheet).getByRole("button", { name: "Move to Assessment" })).toBeTruthy();
    expect(within(sheet).queryByRole("button", { name: "Add to Pool" })).toBeNull();
    expect((await moreActions(sheet)).at(-1)).toBe("Not Progressing");
    await press(sheet, "Move to Assessment");
    expect(app("Funke").stage).toBe("assessment");

    await choose(dialog(), "Not Progressing");
    let form = dialog();
    await press(form, "Not Progressing");
    expect(app("Funke").status).toBe("active");
    type(dialog(), "Reason", "Four years in sales, none leading a team of five");
    await press(dialog(), "Not Progressing");
    expect(app("Funke").status).toBe("not_progressed");

    sheet = dialog();
    await press(sheet, "Reopen");
    expect(app("Funke").status).toBe("active");
    form = dialog();
    expect([...within(form).queryAllByRole("button", { name: /^Move to/ }).map((b) => b.textContent ?? ""), ...(await moreActions(form))].some((n) => n.startsWith("Move to"))).toBe(true);
  }, 60000);

  it("on a phone, the board shows one stage at a time and a card opens in a sheet", async () => {
    setViewport(390);
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=candidates");
    expect(copyProblems()).toEqual([]);
    const sheet = await openRow("Chinedu Okafor");
    expect(await moreActions(sheet)).toContain("Not Progressing");
  }, 60000);

  it("Score With AI says the CV is being read, and the sheet asks again until the read lands", async () => {
    render(<Toaster />);
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=candidates");
    const sheet = await openRow("Zainab Ibrahim");
    expect(within(sheet).getByText("Form only")).toBeTruthy();
    await choose(sheet, "Score With AI");
    expect(await screen.findByText("Reading the CV")).toBeTruthy();
    expect(screen.queryByText("CV read")).toBeNull();
    // The request only queues the read: the sheet says so until a later read of it brings the score.
    expect(within(dialog()).getByText("Being read")).toBeTruthy();
    await waitFor(() => expect(within(dialog()).queryByText("Being read")).toBeNull(), { timeout: 10000 });
    expect(app("Zainab").screening).not.toBeNull();
    expect(within(dialog()).getByText(/Read the CV against the role's must haves/)).toBeTruthy();
    expect(await moreActions(dialog())).not.toContain("Score With AI");
  }, 60000);

  it("Schedule Interview warns, never refuses, when the candidate already has an open offer", async () => {
    const kunle = app("Kunle");
    try {
      kunle.stage = "offer";
      await openAs("cynthia@mycityapp.io", `/recruitment?tab=candidates&id=${kunle.application_id}`);
      await choose(await screen.findByRole("dialog"), "Schedule Interview");
      const form = dialog();
      expect(within(form).getByText("This candidate has an open offer.")).toBeTruthy();
      expect(within(form).getByRole("button", { name: "Schedule Interview" })).toBeTruthy();
    } finally {
      kunle.stage = "shortlist";
    }
    cleanup();
    // A candidate before Offer is not warned.
    await openAs("cynthia@mycityapp.io", `/recruitment?tab=candidates&id=${kunle.application_id}`);
    await choose(await screen.findByRole("dialog"), "Schedule Interview");
    expect(within(dialog()).queryByText("This candidate has an open offer.")).toBeNull();
  }, 60000);

  it("Move To on the board offers only the moves the server allows: ahead, or one back", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=candidates");
    const card = (await screen.findAllByText("Kunle Afolabi"))[0]!.closest("li")!;
    await userEvent.click(within(card).getByRole("button", { name: /^Move / }));
    const offered = (await screen.findAllByRole("menuitem")).map((m) => m.textContent);
    expect(offered).toEqual(["Move to Interview"]);
  }, 60000);
});
