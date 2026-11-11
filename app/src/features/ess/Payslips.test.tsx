// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import payroll from "@mycity/contract/schemas/payroll.js";
import payslips from "@mycity/contract/schemas/payslips.js";
import { formatMonth, ModalProvider, todayIso, Toaster } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { mockSession, sid } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { ScreenActionProvider } from "@/shell/screen-action";
import { MyPayslipsPage } from "./Payslips";

/**
 * ESS · My Payslips on the in-browser mock, in the contract's shapes (docs/guides/payroll.md §3.7, §10; ess.md §10): a
 * person's own published payslips for a year, the figures, a month in the modal with Download PDF and Email a Copy,
 * Salary Deductions with the query, the phone's sheet, and In the run for a month the CEO approved and nobody has paid.
 */

expect.extend(axeMatchers);
installMatchMedia();
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
Element.prototype.scrollIntoView ??= () => undefined;

beforeEach(() => setViewport(1440));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let auth: ReturnType<typeof useAuth> | null = null;
function Harness({ children }: { children: ReactNode }) {
  auth = useAuth();
  return auth.status === "signed-in" ? <>{children}</> : null;
}

const STAFF = "chidera@mycityapp.io";
const OPERATIONS = "cynthia@mycityapp.io";
const CEO = "ifeoma@mycityapp.io";

async function signIn(email: string) {
  await act(async () => {
    const next = await auth!.signIn(email, "demo1234");
    if (next && "kind" in next && next.kind === "code") await auth!.finishTwoStep(next.ticket, "482913");
  });
}

async function open(email = STAFF, id: string | null = null) {
  mockSession.set(null);
  invalidate("/api/v1");
  render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <ScreenActionProvider>
            <Harness>
              <MyPayslipsPage id={id} />
            </Harness>
            <Toaster />
          </ScreenActionProvider>
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>,
  );
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 10000 });
  await signIn(email);
  await screen.findByRole("heading", { name: "My Payslips", level: 1 }, { timeout: 5000 });
}

describe("ESS · My Payslips", () => {
  it("shows the year's figures and months, and a month opens in the modal with Download PDF and Email a Copy", async () => {
    await open();
    const strip = await screen.findByRole("list", { name: "Payslip figures" });
    for (const label of ["Net Received", "Payslips", "Deductions", "Next Payday"]) expect(within(strip).getByText(label)).toBeTruthy();
    const page = payslips.PayslipPage.parse(await api.call("GET /api/v1/ess/payslips", { query: {} }));
    expect(page.data.every((p) => p.status === "published")).toBe(true);
    payslips.EssPayslipSummary.parse(await api.call("GET /api/v1/ess/payslips/summary", { query: {} }));
    const table = await screen.findByRole("table");
    await waitFor(() => expect(within(table).getAllByText("Paid").length).toBe(page.data.length));
    // The person started this year, so the year switch goes nowhere.
    const disabled = (name: string) => (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;
    await waitFor(() => expect(disabled("Previous Year")).toBe(true));
    expect(disabled("Next Year")).toBe(true);
    fireEvent.click(within(table).getByText(formatMonth(page.data[0]!.period)).closest("tr")!);
    const dialog = await screen.findByRole("dialog", { name: "Payslip" });
    await within(dialog).findByText("Net Pay");
    expect(within(dialog).getByRole("button", { name: "Download PDF" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Email a Copy" }));
    await screen.findByText("Sent to your work email");
    fireEvent.click(within(dialog).getByRole("button", { name: "Email a Copy" }));
    await screen.findByText(/Try again in a minute/);
    expect(await axe(document.body)).toHaveNoViolations();
  }, 40000);

  it("Deductions opens every month that carried one, with its query, and the way to My Queries", async () => {
    await open(OPERATIONS);
    const strip = await screen.findByRole("list", { name: "Payslip figures" });
    fireEvent.click(within(strip).getByText("Deductions").closest("button")!);
    const dialog = await screen.findByRole("dialog", { name: "Salary Deductions" });
    await within(dialog).findByText("QRY-0011");
    expect(within(dialog).getByRole("button", { name: "Open My Queries" })).toBeTruthy();
  }, 40000);

  it("on a phone the months are a list and a tapped month opens as a full sheet", async () => {
    setViewport(390);
    await open();
    await screen.findByRole("list", { name: "Payslip figures" });
    await waitFor(() => expect(document.querySelectorAll("[data-row-open]").length).toBeGreaterThan(0));
    expect(document.querySelector("table")).toBeNull();
    fireEvent.click(document.querySelector("[data-row-open]")!);
    const sheet = await screen.findByRole("dialog", { name: "Payslip" });
    await within(sheet).findByText("Net Pay");
  }, 40000);

  it("a link to a payslip opens it, and a link to a deduction opens Salary Deductions", async () => {
    const [y, m] = todayIso().split("-").map(Number);
    const last = new Date(Date.UTC(y!, m! - 2, 1)).toISOString().slice(0, 7);
    await open(STAFF, sid(`slip:chidera:${last}`));
    const dialog = await screen.findByRole("dialog", { name: "Payslip" });
    await within(dialog).findByText(`Payslip, ${formatMonth(last)}`);
    cleanup();
    await open(STAFF, sid("deduction:a-deduction-of-mine"));
    await screen.findByRole("dialog", { name: "Salary Deductions" });
  }, 40000);

  it("a month the CEO approved and nobody has paid reads In the run", async () => {
    await open(OPERATIONS);
    const run = payroll.PayrollRunSummary.parse(await api.call("GET /api/v1/payroll/runs/summary", {})).current!;
    await api.call("POST /api/v1/payroll/runs/:id/submit", { params: { id: run.payroll_run_id }, body: { expected_net_total: run.net_pay! } });
    cleanup();
    await open(CEO);
    const sent = await api.call("GET /api/v1/payroll/runs/:id", { params: { id: run.payroll_run_id } });
    await api.call("POST /api/v1/workflow/instances/:id/approve", { params: { id: sent.workflow_instance_id! }, body: {} });
    cleanup();
    await open();
    const table = await screen.findByRole("table");
    const month = formatMonth(todayIso());
    const row = (await within(table).findByText(month)).closest("tr")!;
    expect(within(row).getByText("In the run")).toBeTruthy();
  }, 60000);
});
