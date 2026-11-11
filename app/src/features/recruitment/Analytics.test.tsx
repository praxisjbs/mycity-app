// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { copyProblems, openAs, settled } from "./testKit";

/**
 * Recruitment · Analytics on the in-browser mock (docs/guides/recruitment.md §10): the funnel across
 * every role and the screening scores, here and no longer on Vacancies or Candidates; on a phone too.
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

describe("Recruitment · Analytics", () => {
  it("shows the funnel across every role and the screening scores", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=analytics");
    expect(await screen.findByText("Funnel, All Roles", undefined, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText("Screening Scores")).toBeTruthy();
    await settled();
    // Each stage of the funnel has its bar.
    for (const stage of ["Applied", "Screening", "Interview", "Shortlist"]) expect(screen.getAllByText(stage).length).toBeGreaterThan(0);
    expect(copyProblems()).toEqual([]);
    expect(await axe(document.body)).toHaveNoViolations();
  }, 60000);

  it("the charts are gone from Candidates", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=candidates");
    await settled();
    expect(screen.queryByText("Screening Scores")).toBeNull();
  }, 60000);

  it("on a phone, the two cards stack", async () => {
    setViewport(390);
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=analytics");
    expect(await screen.findByText("Screening Scores", undefined, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText("Funnel, All Roles")).toBeTruthy();
    expect(copyProblems()).toEqual([]);
  }, 60000);
});
