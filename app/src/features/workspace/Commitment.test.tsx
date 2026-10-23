// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { ModalProvider } from "@mycity/ui";
import { installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { clear, invalidate } from "@/api/hooks";
import { isoDaysAhead, mockSession } from "@/api/mock/core";
import { byKey } from "@/api/mock/data/people";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { commitmentMonths, commitmentPill } from "./Commitment";
import Workspace from "./index";

/**
 * How a commitment reads on a card, a panel and the Commitments view (docs/guides/performance.md
 * §6.11, §10): its state as a pill, an unapproved one saying whether its month was sent or came
 * back, and the two months a new one may be for. Then, on the in-browser mock, its flows on My
 * Workspace · Tasks: Send Commitments lists the month the server finds and sends it, an approved
 * one is rescoped, and a missed one gets its recovery.
 */
describe("a commitment's state", () => {
  it("says whether an unapproved month was sent, returned or not sent yet", () => {
    expect(commitmentPill("awaiting_approval", "submitted")).toEqual({ tone: "warn", text: "Awaiting Approval" });
    expect(commitmentPill("awaiting_approval", "returned")).toEqual({ tone: "err", text: "Returned" });
    expect(commitmentPill("awaiting_approval", null)).toEqual({ tone: "neutral", text: "Not Sent" });
    expect(commitmentPill("awaiting_approval", "draft").text).toBe("Not Sent");
  });

  it("names each approved state in words, with colour that is never alone", () => {
    expect(commitmentPill("on_time", "approved")).toEqual({ tone: "ok", text: "On Time" });
    expect(commitmentPill("late", "approved")).toEqual({ tone: "warn", text: "Late" });
    expect(commitmentPill("missed", "approved")).toEqual({ tone: "err", text: "Missed" });
    expect(commitmentPill("rescoped", "approved").text).toBe("Rescoped");
    expect(commitmentPill("due", "approved").text).toBe("Due");
  });
});

describe("a commitment's month", () => {
  it("is this month or the next, across a year's end", () => {
    expect(commitmentMonths("2026-10-22").map(([v]) => v)).toEqual(["2026-10-01", "2026-11-01"]);
    expect(commitmentMonths("2026-12-30").map(([v]) => v)).toEqual(["2026-12-01", "2027-01-01"]);
    expect(commitmentMonths("2026-10-22")[0][1]).toBe("October 2026");
  });
});

installMatchMedia();
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

let auth: ReturnType<typeof useAuth> | null = null;
function Harness({ children }: { children?: ReactNode }) {
  auth = useAuth();
  return auth.status === "signed-in" ? <>{children}</> : null;
}

/** The screen, signed in on the mock as Cynthia (Operations & People, Bashir's line manager). */
async function signedIn(screenUnderTest: ReactNode) {
  mockSession.set(null);
  // Nothing one test's reader read is kept for the next (the data client's own sign-out clearing).
  clear();
  invalidate("/api/v1");
  render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <Harness>{screenUnderTest}</Harness>
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>,
  );
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 10000 });
  await act(async () => {
    await auth!.signIn("cynthia@mycityapp.io", "demo1234");
  });
}

/** dd/mm/yyyy, as a person types a date. */
const typed = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const closed = (name: string) => waitFor(() => expect(screen.queryByRole("dialog", { name })).toBeNull(), { timeout: 5000 });

describe("commitments on the board", () => {
  beforeEach(() => setViewport(1440));
  afterEach(() => cleanup());

  it("Send Commitments lists the month's unapproved commitments from the server and sends them", async () => {
    await signedIn(<Workspace tab="tasks" id={null} />);
    await screen.findByText("Review Partnerships Associate shortlist", undefined, { timeout: 8000 });
    fireEvent.click(screen.getByRole("button", { name: "Send Commitments" }));
    let form = await screen.findByRole("dialog", { name: "Send Commitments" });
    const list = await within(form).findByRole("table", { name: "Commitments to Send" }, { timeout: 5000 });
    const row = (await within(list).findByText("Review Partnerships Associate shortlist", undefined, { timeout: 5000 })).closest("tr")!;
    expect(within(row as HTMLElement).getByText("Not Sent")).toBeTruthy();
    // Approved ones are not the month's to send.
    expect(within(list).queryByText("Collect NDPA certificates from 4 staff")).toBeNull();
    fireEvent.click(within(form).getByRole("button", { name: "Send Commitments" }));
    await closed("Send Commitments");

    fireEvent.click(screen.getByRole("button", { name: "Send Commitments" }));
    form = await screen.findByRole("dialog", { name: "Send Commitments" });
    const sent = (await within(form).findByText("Review Partnerships Associate shortlist", undefined, { timeout: 5000 })).closest("tr")!;
    await within(sent as HTMLElement).findByText("Awaiting Approval", undefined, { timeout: 5000 });
  }, 30000);

  it("Rescope Commitment on an approved commitment sends it for approval", async () => {
    await signedIn(<Workspace tab="tasks" id={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /Collect NDPA certificates from 4 staff/ }, { timeout: 8000 }));
    const panel = await screen.findByRole("dialog");
    fireEvent.click(await within(panel).findByRole("button", { name: "Rescope Commitment" }, { timeout: 5000 }));
    const form = await screen.findByRole("dialog", { name: "Rescope Commitment" });
    // A rescope needs its reason: Send Rescope marks the field rather than sending.
    fireEvent.click(within(form).getByRole("button", { name: "Send Rescope" }));
    await waitFor(() => expect(within(form).getByRole("textbox", { name: /Reason/ }).getAttribute("aria-invalid")).toBe("true"));
    fireEvent.change(within(form).getByRole("textbox", { name: /Reason/ }), { target: { value: "Two staff are on leave until November" } });
    fireEvent.click(within(form).getByRole("button", { name: "Send Rescope" }));
    await closed("Rescope Commitment");
    await waitFor(() => expect(within(panel).queryByRole("button", { name: "Rescope Commitment" })).toBeNull(), { timeout: 5000 });
  }, 30000);

  it("Set Recovery on a commitment missed last month names its owner and day", async () => {
    await signedIn(<Workspace tab="tasks" id={null} />);
    await screen.findByText("Review Partnerships Associate shortlist", undefined, { timeout: 8000 });
    // Bashir's commitment for last month, sent by Cynthia (his manager, so approved as sent) and never done.
    const first = new Date();
    first.setUTCDate(1);
    first.setUTCMonth(first.getUTCMonth() - 1);
    const month = first.toISOString().slice(0, 10);
    const bashir = byKey("bashir")!.employee_id;
    await act(async () => {
      await api.call("POST /api/v1/tasks", {
        body: { title: "Close the Q3 partner files", primary_assignee_id: bashir, due_on: `${month.slice(0, 8)}10`, is_commitment: true, acceptance_criteria: "Every file closed", commitment_month: month } as never,
      });
      await api.call("POST /api/v1/performance/commitments/sets/:employee_id/:month/submit", { params: { employee_id: bashir, month: month.slice(0, 7) }, body: {} });
      invalidate("/api/v1/tasks");
    });
    fireEvent.click(await screen.findByRole("button", { name: /Close the Q3 partner files/ }, { timeout: 5000 }));
    const panel = await screen.findByRole("dialog");
    await within(panel).findByText("Missed", undefined, { timeout: 5000 });
    fireEvent.click(within(panel).getByRole("button", { name: "Set Recovery" }));
    const form = await screen.findByRole("dialog", { name: "Set Recovery" });
    expect(within(form).getByText("Bashir Lawal")).toBeTruthy();
    const due = isoDaysAhead(7);
    await userEvent.type(within(form).getByLabelText("Due"), typed(due));
    fireEvent.click(within(form).getByRole("button", { name: "Set Recovery" }));
    await closed("Set Recovery");
    await within(panel).findByText("Recovery", undefined, { timeout: 5000 });
    expect(within(panel).queryByRole("button", { name: "Set Recovery" })).toBeNull();
  }, 30000);
});
