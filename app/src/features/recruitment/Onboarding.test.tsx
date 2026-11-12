// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { sid } from "@/api/mock/core";
import { copyProblems, dialog, openAs, press, settled } from "./testKit";

/**
 * Recruitment · Onboarding on the in-browser mock (docs/guides/offers.md §3 steps 5a to 8, §10): the
 * cases with their figures; a row opens its case in the wide dialog (on a phone, a sheet once
 * tapped): the checklist with Verify and Reject, the guarantors with Record Check, the contract with
 * Sign for Company for the Offer Signatory; a case at onboarding with its steps and Mark Step Done,
 * then Complete Onboarding with the company email; a link opening a case by `?case=`.
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
  vi.setSystemTime(new Date("2026-11-12T08:30:00Z"));
});
afterAll(() => vi.useRealTimers());
afterEach(() => {
  cleanup();
  setViewport(1440);
});

async function pick(name: string) {
  const table = await screen.findByRole("table", { name: /New Hires/ }, { timeout: 8000 });
  fireEvent.click(within(table).getAllByText(name)[0]!);
  await settled();
}
/** The case's dialog: the one holding the article titled by the hire. */
const record = (name: string) => screen.getAllByRole("article").find((a) => within(a).queryAllByText(name).length > 0)!.closest<HTMLElement>("[role=dialog]")!;

describe("Recruitment · Onboarding", () => {
  it("lists the cases with their figures; a case at documentation shows what it waits on, and a document is verified", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=onboarding");
    for (const k of ["Documentation", "Pre-Onboarding", "Onboarding", "Hired This Month"]) expect(screen.getAllByText(k).length).toBeGreaterThan(0);
    await pick("Chiamaka Eze");
    const r = record("Chiamaka Eze");
    expect(within(r).getByText(/Waiting on documents, guarantors and contract/)).toBeTruthy();
    expect(within(r).getByText("Olumide Bankole")).toBeTruthy();
    expect(within(r).getAllByText("CON-0001").length).toBeGreaterThan(0);
    const row = within(r).getByText("Passport Photograph").closest("tr")!;
    await press(row as HTMLElement, "Verify");
    expect(within(row as HTMLElement).getByText("Verified")).toBeTruthy();
    expect(copyProblems()).toEqual([]);
    expect(await axe(r)).toHaveNoViolations();
  }, 60000);

  it("the Offer Signatory signs a hire's contract for the company", async () => {
    await openAs("cynthia@mycityapp.io", `/recruitment?tab=onboarding&case=${sid("case:kunle")}`);
    await settled();
    const r = record("Kunle Afolabi");
    await press(r, "Sign for Company");
    const d = dialog();
    fireEvent.click(within(d).getByRole("radio", { name: "Type" }));
    fireEvent.change(within(d).getByLabelText("Typed Signature"), { target: { value: "Cynthia Okafor" } });
    fireEvent.click(within(d).getByRole("checkbox", { name: "Agree to Sign Electronically" }));
    await press(d, "Sign Contract");
    expect(screen.getAllByText("With Hire").length).toBeGreaterThan(0);
  }, 60000);

  it("a case at onboarding marks its steps done, then completes with the company email", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=onboarding&status=onboarding");
    await pick("Samuel Akpan");
    let r = record("Samuel Akpan");
    expect(within(r).getAllByText("Onboarding Plan").length).toBeGreaterThan(0);
    expect(within(r).queryByRole("button", { name: "Complete Onboarding" })).toBeNull();
    for (let i = 0; i < 3; i += 1) {
      r = record("Samuel Akpan");
      await press(r, "Mark Step Done");
    }
    r = record("Samuel Akpan");
    await press(r, "Complete Onboarding");
    const d = dialog();
    fireEvent.change(within(d).getByLabelText("Company Email"), { target: { value: "samuel.akpan@mycityapp.io" } });
    await press(d, "Complete Onboarding");
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
  }, 60000);

  it("on a phone, nothing opens until a case is tapped", async () => {
    setViewport(390);
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=onboarding");
    await settled();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  }, 60000);
});
