// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { copyProblems, dialog, openAs, openRow, press, settled } from "./testKit";

/**
 * Recruitment · Interviews and My Card on the in-browser mock (docs/guides/recruitment.md §6.6, §10):
 * the blind card. Another panelist's submitted card shows Submitted with no score while the round is
 * open; My Card saves each star as it is tapped and takes one back on a second tap; Submit Card refuses
 * a card with traits left to rate; a closed round shows each trait's average, the total and the report.
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

/** The star `n` of the trait whose label reads `trait`. */
const star = (root: HTMLElement, trait: RegExp, n: number) => within(within(root).getByRole("radiogroup", { name: trait })).getByRole("radio", { name: `${n} of 10` });

describe("Recruitment · Interviews", () => {
  it("while the round is open, another panelist's card shows Submitted and no score", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=interviews&mine=true");
    const sheet = await openRow("Tobi Adeyemi");
    const panel = within(sheet).getByRole("table", { name: /Panel/ });
    const ifeoma = within(panel).getByText(/Ifeoma/).closest("tr")!;
    expect(within(ifeoma).getByText("Submitted")).toBeTruthy();
    expect(ifeoma.textContent).not.toMatch(/\d\.\d/);
    expect(within(sheet).queryByRole("table", { name: /Traits/ })).toBeNull();
    expect(copyProblems()).toEqual([]);
  }, 60000);

  it("My Card: a star is saved as it is tapped, a second tap takes it back, and Submit Card wants every trait", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=interviews&mine=true");
    await openRow("Tobi Adeyemi");
    await press(dialog(), "My Card");
    let card = dialog();
    expect(within(card).getByText(/2 of 10 rated/)).toBeTruthy();
    expect(copyProblems()).toEqual([]);
    expect(await axe(card)).toHaveNoViolations();

    // Rate the third trait 9: saved at once, and the panelist's score moves with it.
    fireEvent.click(star(card, /Oral Communication Skills/, 9));
    await settled();
    card = dialog();
    expect(within(card).getByText(/3 of 10 rated/)).toBeTruthy();
    expect((star(card, /Oral Communication Skills/, 9) as HTMLElement).getAttribute("aria-checked")).toBe("true");

    // A second tap on the same star takes it back to not rated.
    fireEvent.click(star(card, /Oral Communication Skills/, 9));
    await settled();
    expect(within(dialog()).getByText(/2 of 10 rated/)).toBeTruthy();

    // Submit with traits left to rate says how many, before asking anyone to confirm.
    await press(dialog(), "Submit Card");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(within(dialog()).getByText(/Rate 8 more traits/)).toBeTruthy();
    // Rating one more takes that line back, until Submit is pressed again.
    fireEvent.click(star(dialog(), /Accuracy in Language/, 7));
    await settled();
    expect(within(dialog()).queryByText(/Rate 8 more traits/)).toBeNull();
  }, 90000);

  it("a closed round shows each trait's average, the total and the report", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=interviews");
    fireEvent.click(screen.getByRole("radio", { name: "Past" }));
    await settled();
    const sheet = await openRow("Kunle Afolabi");
    expect(within(sheet).getByRole("table", { name: /Traits/ })).toBeTruthy();
    expect(within(sheet).getByText(/of 100/)).toBeTruthy();
    expect(within(sheet).getByText(/proven sales leader/)).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Download Form" })).toBeTruthy();
    expect(copyProblems()).toEqual([]);
  }, 60000);

  it("on a phone, My Card puts its stars in reach", async () => {
    setViewport(390);
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=interviews&mine=true");
    await openRow("Halima Yusuf");
    await press(dialog(), "My Card");
    expect(within(dialog()).getAllByRole("radio", { name: "10 of 10" }).length).toBe(10);
    expect(copyProblems()).toEqual([]);
  }, 60000);
});
