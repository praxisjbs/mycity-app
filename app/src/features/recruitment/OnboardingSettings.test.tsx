// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { copyProblems, dialog, openAs, press, settled } from "./testKit";

/**
 * Onboarding Settings on the in-browser mock (docs/guides/offers.md §3 steps 6 to 8, §10): the three
 * settings and what each holds; the Checklist with a requirement added; an onboarding plan's steps,
 * where removing one keeps every other step's fields and SOP with its own step (each row keyed for
 * its life, the SOP's label read by its id). The settings are Operations & People's: the button is
 * shown to whom the summary says may configure.
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

afterEach(() => {
  cleanup();
  setViewport(1440);
});

async function settingsOpen() {
  await openAs("cynthia@mycityapp.io", "/recruitment?tab=onboarding");
  await press(document.body, "Onboarding Settings");
  return dialog();
}

describe("Onboarding Settings", () => {
  it("lists the Checklist, Onboarding Plans and Standard Contract with what each holds; a requirement is added", async () => {
    const d = await settingsOpen();
    for (const name of ["Checklist", "Onboarding Plans", "Standard Contract"]) expect(within(d).getByText(name)).toBeTruthy();
    expect(within(d).getByText(/\d+ documents?/)).toBeTruthy();
    fireEvent.click(within(d).getByText("Checklist"));
    await settled();
    const list = dialog();
    expect(within(list).getAllByText("Valid ID").length).toBeGreaterThan(0);
    expect(copyProblems()).toEqual([]);
    expect(await axe(list)).toHaveNoViolations();
  }, 60000);

  it("removing a plan step keeps each other step's SOP with its own step", async () => {
    const d = await settingsOpen();
    fireEvent.click(within(d).getByText("Onboarding Plans"));
    await settled();
    fireEvent.click(within(dialog()).getByText("Your First 30 Days"));
    await settled();
    let editor = dialog();
    // Step 1 links the induction SOP; step 2 a guide the SOP menu has not loaded, shown by its saved label.
    expect(within(editor).getAllByText(/SOP-0003/).length).toBe(1);
    expect(within(editor).getAllByText(/SOP-0042/).length).toBe(1);
    fireEvent.click(within(editor).getByRole("button", { name: "Remove Step 1" }));
    await settled();
    editor = dialog();
    // The step that was second is now first, with its own title and its own SOP: the removed step's went with it.
    expect((within(editor).getByLabelText("Step 1") as HTMLInputElement).value).toBe("Weeks 2 to 3: shadow the team");
    expect(within(editor).queryAllByText(/SOP-0003/)).toHaveLength(0);
    expect(within(editor).getAllByText(/SOP-0042 · Team Shadowing Guide/).length).toBe(1);
    expect(within(editor).queryByRole("button", { name: "Remove Step 4" })).toBeNull();
  }, 60000);
});
