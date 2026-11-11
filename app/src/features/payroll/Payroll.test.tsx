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
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { ScreenActionProvider } from "@/shell/screen-action";
import Payroll from "./index";

/**
 * Payroll · Payroll Runs and Payslips on the in-browser mock, in the contract's shapes (docs/guides/payroll.md §3.1,
 * §6.9, §6.10, §10): the open run with its figures, chain and problems; New Run on the month field; a person left out
 * and put back; Compute, Submit, the CEO's Approve and Mark Paid; a payslip in the modal at a desktop width; the
 * phone's sheet. The mock holds one state for the file, so the run moves through its life in the order written here.
 * The rules themselves are the API's, tested in tests/integration/payroll-run.test.js and payslips.test.js.
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

const OPERATIONS = "cynthia@mycityapp.io";
const CEO = "ifeoma@mycityapp.io";
const month = formatMonth(todayIso());

async function open(tab: "payroll-runs" | "payslips", email = OPERATIONS, title = tab === "payslips" ? "Payslips" : "Payroll Runs") {
  mockSession.set(null);
  invalidate("/api/v1");
  render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <ScreenActionProvider>
            <Harness>
              <Payroll tab={tab} id={null} />
            </Harness>
            <Toaster />
          </ScreenActionProvider>
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>,
  );
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 10000 });
  await act(async () => {
    // The CEO signs in with two steps on the mock (its code is 482913).
    const next = await auth!.signIn(email, "demo1234");
    if (next && "kind" in next && next.kind === "code") await auth!.finishTwoStep(next.ticket, "482913");
  });
  await screen.findByRole("heading", { name: title, level: 1 }, { timeout: 5000 });
}

const summary = async () => payroll.PayrollRunSummary.parse(await api.call("GET /api/v1/payroll/runs/summary", {}));
const card = () => screen.findByText(`${month} Run`, {}, { timeout: 5000 });

describe("Payroll · Payroll Runs", () => {
  it("shows the open run's figures, its chain and its problems, and Run History as the contract's rows", async () => {
    await open("payroll-runs");
    const s = await summary();
    expect(s.current).toMatchObject({ status: "computed", can_submit: true, can_decide: false });
    await card();
    for (const label of ["Staff in Run", "Gross", "Deductions", "Net"]) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getByRole("list", { name: `${month} run` })).toBeTruthy();
    expect(screen.getByText(/0 blocking, \d+ warnings?/)).toBeTruthy();
    const table = await screen.findByRole("table", { name: "Run History" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(expect.arrayContaining(["Month", "Staff", "Gross", "Net", "Approved By", "Status"]));
    payroll.PayrollRunPage.parse(await api.call("GET /api/v1/payroll/runs", { query: {} }));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const problems = await screen.findByRole("dialog", { name: "Run Problems" });
    await waitFor(() => expect(within(problems).getAllByText(/wait/).length).toBeGreaterThan(0));
    expect(await axe(document.body)).toHaveNoViolations();
  }, 40000);

  it("New Run picks a month on the month field, and a month with a run is refused on the field", async () => {
    await open("payroll-runs");
    fireEvent.click(await screen.findByRole("button", { name: "New Run" }));
    const form = await screen.findByRole("dialog", { name: "New Run" });
    expect(within(form).getByRole("button", { name: new RegExp(`Month ${month}`) })).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "Open Run" }));
    await waitFor(() => expect(within(form).getByText("Already has a run")).toBeTruthy());
    expect(await axe(document.body)).toHaveNoViolations();
  }, 40000);

  it("leaves a person out from a problem with a reason, sends the run back to Draft, and puts them back", async () => {
    await open("payroll-runs");
    await card();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const problems = await screen.findByRole("dialog", { name: "Run Problems" });
    fireEvent.click((await within(problems).findAllByRole("button", { name: "Exclude" }))[0]!);
    const form = await screen.findByRole("dialog", { name: "Exclude Person" });
    fireEvent.click(within(form).getByRole("button", { name: "Exclude Person" }));
    await waitFor(() => expect(within(form).getByText(/Give a reason|At least 10 characters/)).toBeTruthy());
    fireEvent.change(within(form).getByRole("textbox"), { target: { value: "Paid with the final settlement" } });
    fireEvent.click(within(form).getByRole("button", { name: "Exclude Person" }));
    await screen.findByText(/left out of the run/);
    await waitFor(async () => expect((await summary()).current?.status).toBe("draft"));
    const include = await screen.findByRole("button", { name: "Include" });
    fireEvent.click(include);
    await screen.findByText(/is back in the run/);
  }, 60000);

  it("Add Adjustment asks for every field as it is filled", async () => {
    await open("payroll-runs");
    await card();
    fireEvent.click(await screen.findByRole("button", { name: "Add Adjustment" }));
    const form = await screen.findByRole("dialog", { name: "Add Adjustment" });
    fireEvent.click(within(form).getByRole("button", { name: "Add Adjustment" }));
    await waitFor(() => expect(within(form).getByText("Pick a person")).toBeTruthy());
    expect(within(form).getByText("Give a label")).toBeTruthy();
    expect(within(form).getByText("Give a reason")).toBeTruthy();
    expect(await axe(document.body)).toHaveNoViolations();
  }, 40000);

  it("Add Adjustment takes an amount typed without kobo and sends it as the contract's two places", async () => {
    await open("payroll-runs");
    await card();
    fireEvent.click(await screen.findByRole("button", { name: "Add Adjustment" }));
    const form = await screen.findByRole("dialog", { name: "Add Adjustment" });
    fireEvent.change(within(form).getByPlaceholderText("Search people"), { target: { value: "Bashir" } });
    // The search answers after a pause: pick from the list it answers, not the first page shown before it.
    await waitFor(() => expect(within(form).getAllByRole("option")).toHaveLength(1), { timeout: 5000 });
    fireEvent.click(within(form).getByRole("option", { name: /Bashir/ }));
    fireEvent.change(within(form).getByLabelText("Label"), { target: { value: "October bonus" } });
    fireEvent.change(within(form).getByLabelText("Amount"), { target: { value: "15000" } });
    fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: "Quarterly target met" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add Adjustment" }));
    await screen.findByText("Adjustment added");
    const run = (await summary()).current!;
    const added = payroll.PayrollAdjustmentPage.parse(await api.call("GET /api/v1/payroll/runs/:id/adjustments", { params: { id: run.payroll_run_id }, query: {} }));
    expect(added.data[0]).toMatchObject({ label: "October bonus", pay_amount: "15000.00", kind: "earning" });
    expect(run.status).toBe("draft");
  }, 40000);

  it("Compute Run, then Submit for Approval: the run is Submitted and waits on the CEO", async () => {
    await open("payroll-runs");
    await card();
    fireEvent.click(await screen.findByRole("button", { name: "Compute Run" }));
    await screen.findByText("Run computed");
    fireEvent.click(await screen.findByRole("button", { name: "Submit for Approval" }));
    await screen.findByText("Sent for approval");
    await waitFor(async () => expect((await summary()).current).toMatchObject({ status: "submitted", can_submit: false }));
    await waitFor(() => expect(screen.getByText("Waiting On")).toBeTruthy());
    expect(screen.getAllByText("CEO").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  }, 60000);

  it("the CEO opens Send Back with its reason, Approves the run, and Mark Paid ends it", async () => {
    await open("payroll-runs", CEO);
    await card();
    fireEvent.click(await screen.findByRole("button", { name: "Send Back" }));
    const back = await screen.findByRole("dialog", { name: "Send Back" });
    expect(within(back).getByText("Reason")).toBeTruthy();
    fireEvent.click(within(back).getByRole("button", { name: "Cancel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    const sure = await screen.findByRole("alertdialog", { name: "Approve Run" });
    fireEvent.click(within(sure).getByRole("button", { name: "Approve Run" }));
    await screen.findByText(`${month} approved`);
    await waitFor(async () => expect((await summary()).current?.status).toBe("approved"));
    expect(await screen.findByRole("button", { name: "Email All Payslips" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download All" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Mark Paid" }));
    const paid = await screen.findByRole("dialog", { name: "Mark Paid" });
    expect(within(paid).getByText("Payment Reference")).toBeTruthy();
    fireEvent.click(within(paid).getByRole("button", { name: "Mark Paid" }));
    await screen.findByText("Run marked paid");
    await waitFor(async () => expect((await summary()).current?.status).toBe("paid"));
  }, 60000);

  it("on a phone the open run heads the page and a tapped run opens in a sheet with its actions", async () => {
    setViewport(390);
    await open("payroll-runs");
    await screen.findByText("Run History");
    expect((await screen.findAllByText("Staff in Run")).length).toBeGreaterThan(0);
    expect(document.querySelector("table")).toBeNull();
    expect(screen.queryByText(`${month} Run`)).toBeNull();
    const row = (await screen.findAllByRole("button", { name: new RegExp(month) })).find((b) => b.hasAttribute("data-row-open"))!;
    fireEvent.click(row);
    const sheet = await screen.findByRole("dialog", { name: "Payroll Run" });
    await within(sheet).findByText(`${month} Run`);
  }, 40000);
});

describe("Payroll · Payslips", () => {
  it("lists the month's payslips and opens one in the modal at a desktop width, never beside the list", async () => {
    await open("payslips");
    const strip = await screen.findByRole("list", { name: "Payslip figures" });
    expect(within(strip).getByText("Visible to Staff")).toBeTruthy();
    const table = await screen.findByRole("table");
    await waitFor(() => expect(within(table).getAllByRole("row").length).toBeGreaterThan(1));
    const first = within(table).getAllByRole("row")[1]!;
    fireEvent.click(first);
    const dialog = await screen.findByRole("dialog", { name: "Payslip" });
    await within(dialog).findByText("Net Pay");
    expect(within(dialog).getAllByText(/Payslip,/).length).toBeGreaterThan(0);
    const page = payslips.PayslipPage.parse(await api.call("GET /api/v1/payslips", { query: {} }));
    payslips.PayslipDetail.parse(await api.call("GET /api/v1/payslips/:id", { params: { id: page.data[0]!.payslip_id } }));
    expect(await axe(document.body)).toHaveNoViolations();
  }, 40000);
});

describe("the mock holds the API's rules", () => {
  it("refuses a second run for a month, a month still to come, a stale total and a negative net", async () => {
    await open("payroll-runs");
    const thisMonth = `${todayIso().slice(0, 7)}-01`;
    await expect(api.call("POST /api/v1/payroll/runs", { body: { period: thisMonth } })).rejects.toMatchObject({ code: "RUN_EXISTS", fields: { period: ["Already has a run"] } });
    await expect(api.call("POST /api/v1/payroll/runs", { body: { period: "2099-01-01" } })).rejects.toMatchObject({ code: "PERIOD_NOT_ALLOWED" });
    // An old month with no run opens as a Draft, computes and refuses a total the person never saw.
    const opened = payroll.PayrollRun.parse(await api.call("POST /api/v1/payroll/runs", { body: { period: "2023-01-01" } }));
    expect(opened).toMatchObject({ status: "draft", can_submit: false });
    const id = opened.payroll_run_id;
    await expect(api.call("POST /api/v1/payroll/runs/:id/submit", { params: { id }, body: {} })).rejects.toMatchObject({ code: "RUN_NOT_COMPUTED" });
    const computed = payroll.PayrollRun.parse(await api.call("POST /api/v1/payroll/runs/:id/compute", { params: { id }, body: {} }));
    await expect(api.call("POST /api/v1/payroll/runs/:id/submit", { params: { id }, body: { expected_net_total: "1.00" } })).rejects.toMatchObject({ code: "RUN_CHANGED", fields: { net_pay: [computed.net_pay] } });
    const slip = payslips.PayslipPage.parse(await api.call("GET /api/v1/payslips", { query: { run_id: id } })).data[0]!;
    await api.call("POST /api/v1/payroll/runs/:id/adjustments", { params: { id }, body: { employee_id: slip.employee.employee_id, kind: "deduction", label: "Correction", amount: "99999999.00", reason: "A correction far too large" } });
    await api.call("POST /api/v1/payroll/runs/:id/compute", { params: { id }, body: {} });
    const problems = payroll.PayrollProblemPage.parse(await api.call("GET /api/v1/payroll/runs/:id/problems", { params: { id }, query: {} }));
    expect(problems.data[0]).toMatchObject({ code: "NEGATIVE_NET", severity: "blocking" });
    await expect(api.call("POST /api/v1/payroll/runs/:id/submit", { params: { id }, body: {} })).rejects.toMatchObject({ code: "RUN_HAS_PROBLEMS" });
    await expect(api.call("POST /api/v1/payroll/runs/:id/email-payslips", { params: { id }, body: { resend: false } })).rejects.toMatchObject({ code: "NOT_APPROVED" });
    await api.call("DELETE /api/v1/payroll/runs/:id", { params: { id } });
    await expect(api.call("GET /api/v1/payroll/runs/:id", { params: { id } })).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, 40000);
});
