// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, within } from "@testing-library/react";
import { installMatchMedia, setViewport } from "@mycity/ui/testing";
import { dialog, openAs, openRow, press } from "./testKit";

/**
 * Recruitment · Candidate Emails on the in-browser mock (docs/guides/recruitment.md §6.8): an email
 * opened from the list goes back to the list on Cancel and after Save Email, never past it.
 */

vi.mock("@/api/mock/core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@/api/mock/core")>();
  return { ...core, dispatch: vi.fn(core.dispatch) };
});

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

describe("Recruitment · Candidate Emails", () => {
  it("Cancel and Save Email go back to the list", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=vacancies");
    await press(document.body, "Candidate Emails");
    await openRow("Application Received");
    expect(within(dialog()).getByRole("button", { name: "Save Email" })).toBeTruthy();
    await press(dialog(), "Cancel");
    expect(within(dialog()).getByText("Application Received")).toBeTruthy();
    expect(within(dialog()).queryByRole("button", { name: "Save Email" })).toBeNull();

    await openRow("Application Received");
    await press(dialog(), "Save Email");
    expect(within(dialog()).getByText("Application Received")).toBeTruthy();
    expect(within(dialog()).queryByRole("button", { name: "Save Email" })).toBeNull();
  }, 60000);
});
