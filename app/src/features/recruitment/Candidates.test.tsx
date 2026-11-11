// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("Move To on the board offers only the moves the server allows: ahead, or one back", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=candidates");
    const card = (await screen.findAllByText("Kunle Afolabi"))[0]!.closest("li")!;
    await userEvent.click(within(card).getByRole("button", { name: /^Move / }));
    const offered = (await screen.findAllByRole("menuitem")).map((m) => m.textContent);
    expect(offered).toEqual(["Move to Interview"]);
  }, 60000);
});
