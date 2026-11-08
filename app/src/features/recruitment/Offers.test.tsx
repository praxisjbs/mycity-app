// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { sid } from "@/api/mock/core";
import { copyProblems, dialog, openAs, openRow, press, settled } from "./testKit";

/**
 * Recruitment · Offers on the in-browser mock (docs/guides/offers.md §3, §10): the list with its
 * figures beside the offer picked (on a phone, in a sheet once tapped); the record's pay against the
 * vacancy's range, approval, signers, history and letter; Approve for the approver the flow waits on;
 * Sign for the Company for the Offer Signatory, then Send Offer; New Offer from a link; the board's
 * link opening a card's offer by its application.
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
  vi.setSystemTime(new Date("2026-11-07T08:30:00Z"));
});
afterAll(() => vi.useRealTimers());
afterEach(() => {
  cleanup();
  setViewport(1440);
});

/** Picks the offer of `name`; on desktop it shows beside the list. */
async function pick(name: string) {
  const table = await screen.findByRole("table", { name: /Offers/ }, { timeout: 8000 });
  fireEvent.click(within(table).getAllByText(name)[0]!);
  await settled();
}
/** The record in view: the article titled by the candidate. */
const record = (name: string) => screen.getAllByRole("article").find((a) => within(a).queryByText(name))!.parentElement!;

describe("Recruitment · Offers", () => {
  it("lists the offers with their figures, the first beside the list, and its pay, signers, history and letter", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=offers");
    for (const k of ["With Approval", "To Send", "With Candidates", "Accepted This Month"]) expect(screen.getAllByText(k).length).toBeGreaterThan(0);
    await pick("Chiamaka Eze");
    const r = record("Chiamaka Eze");
    expect(within(r).getAllByText("OFF-0017").length).toBeGreaterThan(0);
    expect(within(r).getByText("Monthly Total")).toBeTruthy();
    expect(within(r).getAllByText("Accepted").length).toBeGreaterThan(0);
    expect(within(r).getByText("Accepted and signed")).toBeTruthy();
    expect(within(r).getByRole("button", { name: "Download PDF" })).toBeTruthy();
    expect(within(r).getByText(/We are pleased to offer you employment/)).toBeTruthy();
    expect(within(r).queryByRole("button", { name: "Send Offer" })).toBeNull();
    expect(copyProblems()).toEqual([]);
    expect(await axe(r)).toHaveNoViolations();
  }, 60000);

  it("shows an offer over the vacancy's range with its reason", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=offers");
    await pick("Tunde Bakare");
    const r = record("Tunde Bakare");
    expect(within(r).getByText("Outside Range")).toBeTruthy();
    expect(within(r).getByText(/Matched a competing offer/)).toBeTruthy();
  }, 60000);

  it("the CEO approves an offer waiting on them, on the offer itself", async () => {
    await openAs("ifeoma@mycityapp.io", "/recruitment?tab=offers");
    await pick("Adaeze Nnadi");
    const r = record("Adaeze Nnadi");
    await waitFor(() => expect(within(r).getByRole("button", { name: "Approve Offer" })).toBeTruthy());
    await press(r, "Approve Offer");
    await waitFor(() => expect(within(record("Adaeze Nnadi")).getAllByText("Approved").length).toBeGreaterThan(0));
    expect(within(record("Adaeze Nnadi")).queryByRole("button", { name: "Approve Offer" })).toBeNull();
  }, 60000);

  it("the Offer Signatory signs for the company, then Send Offer sends it to the candidate", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=offers");
    await pick("Tunde Bakare");
    expect(within(record("Tunde Bakare")).queryByRole("button", { name: "Send Offer" })).toBeNull();
    await press(record("Tunde Bakare"), "Sign for Company");
    const d = dialog();
    expect(copyProblems(d)).toEqual([]);
    fireEvent.click(within(d).getByRole("radio", { name: "Type" }));
    await settled();
    fireEvent.change(within(dialog()).getByLabelText("Typed Signature"), { target: { value: "C. Osakunih" } });
    // Without the consent tick it does not sign.
    await press(dialog(), "Sign Offer");
    expect(screen.queryAllByRole("dialog").length).toBe(1);
    fireEvent.click(within(dialog()).getByRole("checkbox", { name: "Agree to Sign Electronically" }));
    await press(dialog(), "Sign Offer");
    await waitFor(() => expect(screen.queryAllByRole("dialog").length).toBe(0));
    await waitFor(() => expect(within(record("Tunde Bakare")).getByRole("button", { name: "Send Offer" })).toBeTruthy());
    await press(record("Tunde Bakare"), "Send Offer");
    await waitFor(() => expect(within(record("Tunde Bakare")).getAllByText("With Candidate").length).toBeGreaterThan(0));
    expect(within(record("Tunde Bakare")).getByRole("button", { name: "Resend Offer" })).toBeTruthy();
  }, 60000);

  it("New Offer from a link starts from the candidate's vacancy and drafts the offer", async () => {
    // Seun Okonkwo declined an offer and is back at Shortlist: another may be made.
    await openAs("cynthia@mycityapp.io", `/recruitment?tab=offers&new=1&application=${sid("app:18")}`);
    let d = dialog();
    await waitFor(() => expect((within(d).getByLabelText("Job Title") as HTMLInputElement).value).toBe("Graphics and Motion Designer"));
    expect(copyProblems(d)).toEqual([]);
    await press(d, "Next");
    d = dialog();
    expect(within(d).getByText("Monthly Total")).toBeTruthy();
    fireEvent.change(within(d).getAllByLabelText("Monthly Amount")[0]!, { target: { value: "350,000" } });
    await press(d, "Next");
    d = dialog();
    fireEvent.change(within(d).getByLabelText("Start Date"), { target: { value: "01/12/2026" } });
    await settled();
    await press(d, "Next");
    await press(dialog(), "Draft Offer");
    await waitFor(() => expect(screen.queryAllByRole("dialog").length).toBe(0));
    await waitFor(() => expect(within(record("Seun Okonkwo")).getAllByText("Draft").length).toBeGreaterThan(0));
    expect(within(record("Seun Okonkwo")).getByRole("button", { name: "Submit for Approval" })).toBeTruthy();
  }, 60000);

  it("the board's link opens a card's offer by its application", async () => {
    await openAs("cynthia@mycityapp.io", `/recruitment?tab=offers&application=${sid("app:16")}`);
    await waitFor(() => expect(within(record("Dayo Martins")).getAllByText("OFF-0018").length).toBeGreaterThan(0), { timeout: 8000 });
    expect(window.location.search).not.toContain("application");
  }, 60000);

  it("a refused send shows on the offer, and Change Email sends the link to the corrected address", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=offers");
    await pick("Dayo Martins");
    const r = record("Dayo Martins");
    expect(within(r).getByText(/^The offer email to dayo\.martins@example\.test was refused on/)).toBeTruthy();
    await press(r, "Change Email");
    const d = dialog();
    expect(copyProblems(d)).toEqual([]);
    fireEvent.change(within(d).getByLabelText("Email"), { target: { value: "dayo.martins@example.org" } });
    await press(d, "Send to Email");
    await waitFor(() => expect(screen.queryAllByRole("dialog").length).toBe(0));
    await waitFor(() => expect(within(record("Dayo Martins")).getByText("dayo.martins@example.org")).toBeTruthy());
    expect(within(record("Dayo Martins")).queryByText(/was refused on/)).toBeNull();
  }, 60000);

  it("Not Progressing a candidate withdraws their open offer", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=candidates");
    const sheet = await openRow("Kunle Afolabi");
    await press(sheet, "Not Progressing");
    fireEvent.change(within(dialog()).getByLabelText("Reason"), { target: { value: "The role went to someone with more experience" } });
    await press(dialog(), "Not Progressing");
    cleanup();
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=offers");
    await pick("Kunle Afolabi");
    expect(within(record("Kunle Afolabi")).getAllByText("Withdrawn").length).toBeGreaterThan(0);
    expect(within(record("Kunle Afolabi")).getAllByText("The candidate was not progressed").length).toBeGreaterThan(0);
  }, 60000);

  it("on a phone a tapped offer opens in a sheet, never under the list", async () => {
    setViewport(390);
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=offers");
    expect(screen.queryAllByRole("article").length).toBe(0);
    expect(copyProblems()).toEqual([]);
    const sheet = await openRow("Dayo Martins");
    expect(within(sheet).getByRole("button", { name: "Resend Offer" })).toBeTruthy();
    expect(within(sheet).getByText("Monthly Total")).toBeTruthy();
  }, 60000);
});
