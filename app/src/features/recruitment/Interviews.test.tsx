// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { dispatch, fail } from "@/api/mock/core";
import { copyProblems, dialog, openAs, openRow, press, settled } from "./testKit";

/**
 * Recruitment · Interviews and My Card on the in-browser mock (docs/guides/recruitment.md §6.6, §10):
 * Upcoming and Recent beside the interview picked (on a phone, in a sheet once tapped), and the blind
 * card. Another panelist's submitted card shows Submitted and Hidden while the round is open; My Card
 * saves each star as it is tapped and takes one back on a second tap; Submit Card refuses a card with
 * traits left to rate; a closed round shows each trait's average, the total, the report, the Weighted
 * Scorecard and its Round Activity.
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

/** Picks the interview of `name` in the list; on desktop it shows beside the list. */
async function pick(name: string) {
  fireEvent.click((await screen.findAllByText(name, undefined, { timeout: 8000 }))[0]!);
  await settled();
}
/** The Blind Panel of the interview in view. */
const blindPanel = (root: HTMLElement = document.body) => within(root).getByRole("table", { name: /Blind Panel/ });

/** The star `n` of the trait whose label reads `trait`. */
const star = (root: HTMLElement, trait: RegExp, n: number) => within(within(root).getByRole("radiogroup", { name: trait })).getByRole("radio", { name: `${n} of 10` });

describe("Recruitment · Interviews", () => {
  it("lists the interviews still to end first, soonest first, then those past, latest first", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=interviews");
    const rows = within(screen.getByRole("table", { name: /Upcoming and Recent/ })).getAllByRole("row").slice(1);
    const names = rows.map((r) => r.textContent ?? "");
    const at = (name: string) => names.findIndex((t) => t.includes(name));
    // Halima tomorrow, Tobi yesterday (cards still due), Kunle five days ago.
    expect(at("Halima Yusuf")).toBeLessThan(at("Tobi Adeyemi"));
    expect(at("Tobi Adeyemi")).toBeLessThan(at("Kunle Afolabi"));
    // Nothing opens unasked; a row opens its interview in the wide dialog (F31 as amended 08/11/2026).
    expect(screen.queryByRole("dialog")).toBeNull();
    await pick("Halima Yusuf");
    expect(blindPanel(await screen.findByRole("dialog", { name: "Interview" }))).toBeTruthy();
    expect(copyProblems()).toEqual([]);
  }, 60000);

  it("while the round is open, another panelist's card shows Submitted and Hidden, never a score", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=interviews&mine=true");
    await pick("Tobi Adeyemi");
    const ifeoma = within(blindPanel()).getByText(/Ifeoma/).closest("tr")!;
    expect(within(ifeoma).getByText("Submitted")).toBeTruthy();
    expect(within(ifeoma).getByText("Hidden")).toBeTruthy();
    expect(ifeoma.textContent).not.toMatch(/\d\.\d/);
    expect(screen.queryByRole("table", { name: /Traits/ })).toBeNull();
    expect(screen.getByText("Weighted Scorecard")).toBeTruthy();
    expect(screen.getByText(/Ifeoma Chukwu submitted their card/)).toBeTruthy();
    expect(copyProblems()).toEqual([]);
    expect(await axe(document.body)).toHaveNoViolations();
  }, 60000);

  it("My Card: a star is saved as it is tapped, a second tap takes it back, and Submit Card wants every trait", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=interviews&mine=true");
    await pick("Tobi Adeyemi");
    await press(document.body, "My Card");
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

  it("My Card: a failed star goes back to what the server kept, and never over a later tap that saved", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=interviews&mine=true");
    await pick("Tobi Adeyemi");
    await press(document.body, "My Card");
    const checked = (n: number) => star(dialog(), /Oral Communication Skills/, n).getAttribute("aria-checked") === "true";
    const real = vi.mocked(dispatch).getMockImplementation()!;
    // Each save of the card in turn: "fail", or the milliseconds it takes before it goes through. A slow
    // second save lets the screen draw the first one's failure before the second lands, as on a network.
    const outcomes: Array<"fail" | number> = [];
    vi.mocked(dispatch).mockImplementation(async (req) => {
      if (req.method !== "PUT" || !req.path.endsWith("/feedback")) return real(req);
      const next = outcomes.shift() ?? 0;
      if (next === "fail") return fail(503, "UNAVAILABLE", "Not saved. Try again.");
      await new Promise((r) => setTimeout(r, next));
      return real(req);
    });
    try {
      // Two taps in flight; the first fails, the second saves: the star stays on the second.
      outcomes.push("fail", 600);
      fireEvent.click(star(dialog(), /Oral Communication Skills/, 5));
      fireEvent.click(star(dialog(), /Oral Communication Skills/, 7));
      await settled();
      expect(checked(7)).toBe(true);
      expect(within(dialog()).queryByText("Not saved. Try again.")).toBeNull();

      // The first saves, the second fails: back to the first, the last the server confirmed.
      outcomes.push(0, "fail");
      fireEvent.click(star(dialog(), /Oral Communication Skills/, 4));
      fireEvent.click(star(dialog(), /Oral Communication Skills/, 6));
      await settled();
      expect(checked(4)).toBe(true);
      expect(checked(6)).toBe(false);
      expect(within(dialog()).getByText("Not saved. Try again.")).toBeTruthy();
    } finally {
      vi.mocked(dispatch).mockImplementation(real);
    }
    // Put back as the other tests found it.
    fireEvent.click(star(dialog(), /Oral Communication Skills/, 4));
    await settled();
  }, 90000);

  it("Schedule Interview offers only the people who may sit on a panel", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=interviews");
    vi.mocked(dispatch).mockClear();
    await press(document.body, "Schedule Interview");
    const asked = vi.mocked(dispatch).mock.calls.map(([r]) => `${r.method} ${r.path}`);
    expect(asked).toContain("GET /api/v1/recruitment/interviews/panelists");
    expect(asked).not.toContain("GET /api/v1/employees");
  }, 60000);

  it("a closed round shows each score, each trait's average, the total, the report and its activity", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=interviews");
    await pick("Kunle Afolabi");
    expect(within(blindPanel()).queryByText("Hidden")).toBeNull();
    expect(within(blindPanel()).getAllByText(/^\d\.\d$/).length).toBeGreaterThan(0);
    expect(screen.getByRole("table", { name: /Traits/ })).toBeTruthy();
    expect(screen.getByText(/of 100/)).toBeTruthy();
    expect(screen.getByText(/proven sales leader/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download Form" })).toBeTruthy();
    expect(screen.getByText(/Report written by/)).toBeTruthy();
    expect(copyProblems()).toEqual([]);
  }, 60000);

  it("on a phone, nothing opens until a row is tapped, and My Card puts its stars in reach", async () => {
    setViewport(390);
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=interviews&mine=true");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("table", { name: /Blind Panel/ })).toBeNull();
    const sheet = await openRow("Halima Yusuf");
    expect(within(sheet).getByText("Blind Panel")).toBeTruthy();
    await press(sheet, "My Card");
    expect(within(dialog()).getAllByRole("radio", { name: "10 of 10" }).length).toBe(10);
    expect(copyProblems()).toEqual([]);
  }, 60000);
});
