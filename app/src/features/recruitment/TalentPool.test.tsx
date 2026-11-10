// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { axe, axeMatchers, chooseOption, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { POOL } from "@/api/mock/data/recruitment";
import { sid } from "@/api/mock/core";
import { copyProblems, dialog, openAs, openRow, press, settled } from "./testKit";

/**
 * Recruitment · Talent Pool on the in-browser mock (docs/guides/recruitment.md §6.9, §10): the four
 * figures and the people kept with their kept-until date; a person beside the list on a wide desktop
 * (F31), in a sheet on a phone; Invite to Apply asks for an open role and marks the person invited.
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

/** On a wide desktop a person opens beside the list, never in a dialog (F31): the card their name heads. */
async function openBeside(name: string) {
  fireEvent.click((await screen.findAllByText(name, undefined, { timeout: 8000 }))[0]!);
  await settled();
  expect(screen.queryByRole("dialog")).toBeNull();
  const heading = await screen.findByRole("heading", { name, level: 2 });
  let pane: HTMLElement = heading;
  while (pane.parentElement && !within(pane).queryByText("Kept Until")) pane = pane.parentElement;
  return pane;
}

describe("Recruitment · Talent Pool", () => {
  it("lists the people kept, and Invite to Apply marks one invited", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=talent-pool");
    for (const label of ["In the Pool", "Invited Back", "Hired From the Pool", "Average Score"]) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(copyProblems()).toEqual([]);
    expect(await axe(document.body)).toHaveNoViolations();

    let sheet = await openBeside("Femi Lawal");
    // Cancel goes back to the person, still beside the list.
    await press(sheet, "Invite to Apply");
    await press(dialog(), "Cancel");
    expect(screen.queryByRole("dialog")).toBeNull();
    sheet = await openBeside("Femi Lawal");
    expect(within(sheet).getByRole("button", { name: "Invite to Apply" })).toBeTruthy();
    await press(sheet, "Invite to Apply");
    const form = dialog();
    await press(form, "Send Invitation");
    expect(POOL.find((p) => p.name === "Femi Lawal")!.invited_at).toBeNull();
    await chooseOption(within(dialog()).getByLabelText("Vacancy"), /Graphics and Motion Designer/);
    await press(dialog(), "Send Invitation");
    expect(POOL.find((p) => p.name === "Femi Lawal")!.invited_vacancy?.title).toBe("Graphics and Motion Designer");
    // A sent invitation closes it all.
    expect(screen.queryByRole("dialog")).toBeNull();
  }, 60000);

  it("a link to one person (?id=) opens them, read by their id", async () => {
    await openAs("cynthia@mycityapp.io", `/recruitment?tab=talent-pool&id=${sid("pool:dayo")}`);
    await settled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByText("dayo.martins@example.test")).toBeTruthy();
  }, 60000);

  it("on a phone, nothing opens until a person is tapped, then in a sheet", async () => {
    setViewport(390);
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=talent-pool");
    expect(screen.queryByText("femi.lawal@example.test")).toBeNull();
    const sheet = await openRow("Femi Lawal");
    expect(within(sheet).getByRole("button", { name: "Invite to Apply" })).toBeTruthy();
  }, 60000);
});
