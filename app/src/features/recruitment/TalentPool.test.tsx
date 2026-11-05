// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { axe, axeMatchers, chooseOption, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { POOL } from "@/api/mock/data/recruitment";
import { sid } from "@/api/mock/core";
import { copyProblems, dialog, openAs, openRow, press } from "./testKit";

/**
 * Recruitment · Talent Pool on the in-browser mock (docs/guides/recruitment.md §6.9, §10): the four
 * figures and the people kept with their kept-until date; Invite to Apply asks for an open role and
 * marks the person invited.
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

describe("Recruitment · Talent Pool", () => {
  it("lists the people kept, and Invite to Apply marks one invited", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=talent-pool");
    for (const label of ["In the Pool", "Invited Back", "Hired From the Pool", "Average Score"]) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(copyProblems()).toEqual([]);
    expect(await axe(document.body)).toHaveNoViolations();

    const sheet = await openRow("Femi Lawal");
    await press(sheet, "Invite to Apply");
    const form = dialog();
    await press(form, "Send Invitation");
    expect(POOL.find((p) => p.name === "Femi Lawal")!.invited_at).toBeNull();
    await chooseOption(within(dialog()).getByLabelText("Vacancy"), /Graphics and Motion Designer/);
    await press(dialog(), "Send Invitation");
    expect(POOL.find((p) => p.name === "Femi Lawal")!.invited_vacancy?.title).toBe("Graphics and Motion Designer");
  }, 60000);

  it("a link to one person (?id=) opens them, read by their id", async () => {
    await openAs("cynthia@mycityapp.io", `/recruitment?tab=talent-pool&id=${sid("pool:dayo")}`);
    expect(within(dialog()).getByText("dayo.martins@example.test")).toBeTruthy();
  }, 60000);
});
