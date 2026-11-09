// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import deductions from "@mycity/contract/schemas/deductions.js";
import { formatMoney, ModalProvider, Toaster } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { ScreenActionProvider } from "@/shell/screen-action";
import Deductions from "./Deductions";

/**
 * Payroll · Deductions on the in-browser mock, in the contract's shapes (docs/guides/payroll.md §3.3, §3.4,
 * §6.6, §10): the figures, the list pending first, a fine accepted for this month, spread or waived, an advance
 * recorded, and the phone's sheet. The rules themselves are the API's, tested in tests/integration/deductions.
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

async function open(email = "cynthia@mycityapp.io", ui: ReactNode = <Deductions />) {
  mockSession.set(null);
  invalidate("/api/v1");
  render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <ScreenActionProvider>
            <Harness>{ui}</Harness>
            <Toaster />
          </ScreenActionProvider>
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>,
  );
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 10000 });
  await act(async () => {
    await auth!.signIn(email, "demo1234");
  });
  await screen.findByRole("heading", { name: "Deductions", level: 1 }, { timeout: 5000 });
}

const readPage = async () => deductions.DeductionPage.parse(await api.call("GET /api/v1/deductions", { query: {} }));

describe("Payroll · Deductions", () => {
  it("shows the four figures and the waiting deductions, pending first, as the contract's rows", async () => {
    await open();
    const page = await readPage();
    expect(page.data[0]!.status).toBe("pending");
    const summary = deductions.DeductionSummary.parse(await api.call("GET /api/v1/deductions/summary", {}));
    const strip = await screen.findByRole("list", { name: "Deduction figures" });
    for (const [label, fig] of [
      ["Pending Fines", summary.pending_fines],
      ["Pending Attendance", summary.pending_attendance],
      ["Active", summary.active],
      ["Recovered This Year", summary.recovered_this_year],
    ] as const) {
      const item = within(strip).getByText(label).closest("button")!;
      expect(item.textContent).toContain(String(fig.count));
      expect(item.textContent).toContain(formatMoney(fig.pay_amount!));
    }
    const table = await screen.findByRole("table", { name: "Pending Deductions" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(expect.arrayContaining(["Employee", "Reason", "Source", "Amount", "Month", "Status"]));
    expect(within(table).queryAllByText("Waived")).toHaveLength(0);
    expect(await axe(document.body)).toHaveNoViolations();
  }, 40000);

  it("filters by status and source on the server, and each figure opens its list in a pop-up", async () => {
    await open();
    await screen.findByRole("table", { name: "Pending Deductions" });
    const statuses = within(screen.getByRole("group", { name: "Status" }));
    fireEvent.click(statuses.getByRole("button", { name: /^Waived/ }));
    const table = await screen.findByRole("table", { name: "Deductions" });
    await waitFor(() => expect(within(table).getAllByText("Waived").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("radio", { name: "Advances" }));
    await waitFor(() => expect(screen.getByText("Nothing Here")).toBeTruthy());

    fireEvent.click(statuses.getByRole("button", { name: /^Pending/ }));
    fireEvent.click(screen.getByRole("radio", { name: "All" }));
    fireEvent.click(screen.getByText("Pending Fines").closest("button")!);
    const dialog = await screen.findByRole("dialog", { name: "Pending Fines" });
    await waitFor(() => expect(within(dialog).getAllByRole("row").length).toBeGreaterThan(1));
    expect(within(dialog).queryByText("Attendance")).toBeNull();
  }, 40000);

  it("Accept This Month accepts the fine in the open month, and it is Active from then on", async () => {
    await open();
    const fine = (await readPage()).data.find((r) => r.source === "fine" && r.can_accept)!;
    const table = await screen.findByRole("table", { name: "Pending Deductions" });
    fireEvent.click(within(table).getByText(fine.reason).closest("tr")!);
    fireEvent.click(await screen.findByRole("button", { name: "Accept This Month" }));
    await screen.findByText("Fine accepted for this month");
    const after = (await readPage()).data.find((r) => r.source_id === fine.source_id)!;
    expect(after).toMatchObject({ status: "active", instalments: 1, instalments_applied: 0, can_accept: false, can_release: true });
    expect(after.period).toBe((await api.call("GET /api/v1/deductions/summary", {})).open_period);
  }, 40000);

  it("Spread Over Months asks for the months and the first month, and Waive for a reason of ten characters", async () => {
    await open();
    const fines = (await readPage()).data.filter((r) => r.source === "fine" && r.can_accept);
    const table = await screen.findByRole("table", { name: "Pending Deductions" });
    fireEvent.click(within(table).getByText(fines[0]!.reason).closest("tr")!);
    fireEvent.click(await screen.findByRole("button", { name: "Spread Over Months" }));
    const spread = await screen.findByRole("dialog", { name: "Spread Fine" });
    expect(within(spread).getByText("Months")).toBeTruthy();
    expect(within(spread).getByText("Start Month")).toBeTruthy();
    fireEvent.click(within(spread).getByRole("button", { name: "Spread Fine" }));
    await screen.findByText("Deduction scheduled");
    const spreadRow = (await readPage()).data.find((r) => r.source_id === fines[0]!.source_id)!;
    expect(spreadRow).toMatchObject({ status: "active", instalments: 3 });

    cleanup();
    await open();
    const left = (await readPage()).data.find((r) => r.source === "fine" && r.can_waive)!;
    const again = await screen.findByRole("table", { name: "Pending Deductions" });
    fireEvent.click(within(again).getByText(left.reason).closest("tr")!);
    fireEvent.click(await screen.findByRole("button", { name: "Waive" }));
    const waive = await screen.findByRole("dialog", { name: "Waive Fine" });
    fireEvent.click(within(waive).getByRole("button", { name: "Waive Fine" }));
    await waitFor(() => expect(within(waive).getByText(/Give a reason|At least 10 characters/)).toBeTruthy());
    fireEvent.change(within(waive).getByRole("textbox"), { target: { value: "Settled in review" } });
    fireEvent.click(within(waive).getByRole("button", { name: "Waive Fine" }));
    await screen.findByText("Fine waived");
    expect((await readPage()).data.find((r) => r.source_id === left.source_id)!.status).toBe("waived");
  }, 60000);

  it("an attendance deduction offers nothing but the way to People · Attendance", async () => {
    await open();
    const table = await screen.findByRole("table", { name: "Pending Deductions" });
    const late = (await readPage()).data.find((r) => r.source === "attendance")!;
    fireEvent.click(within(table).getByText(late.reason).closest("tr")!);
    expect(await screen.findByRole("button", { name: "Open Attendance" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept This Month" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Waive" })).toBeNull();
  }, 40000);

  it("Record Advance checks every field as it is filled and names nothing it has not been given", async () => {
    await open();
    await screen.findByRole("list", { name: "Deduction figures" });
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Deduction figures" })).getByText("Pending Fines").closest("button")!.textContent).toMatch(/\d/));
    fireEvent.click(screen.getByRole("button", { name: "Record Advance" }));
    const form = await screen.findByRole("dialog", { name: "Record Advance" });
    fireEvent.click(within(form).getByRole("button", { name: "Record Advance" }));
    await waitFor(() => expect(within(form).getByText("Pick a person")).toBeTruthy());
    expect(within(form).getByText("Give a reason")).toBeTruthy();
    expect(within(form).getAllByText("Required")).toHaveLength(2);
    expect(within(form).getByText("Start Month")).toBeTruthy();
    expect(await axe(document.body)).toHaveNoViolations();
  }, 40000);

  it("on a phone the deductions are cards and nothing opens until one is tapped", async () => {
    setViewport(390);
    await open();
    await screen.findByText("Pending Deductions");
    expect(document.querySelector("table")).toBeNull();
    expect(screen.queryByRole("button", { name: "Accept This Month" })).toBeNull();
    const fine = (await readPage()).data.find((r) => r.source === "fine" && r.can_accept)!;
    const card = (await screen.findAllByRole("button", { name: new RegExp(fine.employee.display_name) }))[0]!;
    // The source and the month stay off the card.
    expect(within(card.closest("li")!).queryByText("Source")).toBeNull();
    fireEvent.click(card);
    const sheet = await screen.findByRole("dialog", { name: "Deduction" });
    expect(within(sheet).getByRole("button", { name: "Accept This Month" })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Spread Over Months" })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Waive" })).toBeTruthy();
  }, 40000);
});

describe("the mock holds the API's rules", () => {
  it("refuses an early start, a short reason, a second acceptance and an advance for a day to come", async () => {
    await open();
    const fine = (await readPage()).data.find((r) => r.source === "fine" && r.can_accept)!;
    const { open_period: openMonth } = await api.call("GET /api/v1/deductions/summary", {});
    const call = (path: "accept" | "waive", body: object) => api.call(`POST /api/v1/deductions/fines/:sanction_fine_id/${path}` as "POST /api/v1/deductions/fines/:sanction_fine_id/accept", { params: { sanction_fine_id: fine.source_id }, body: body as never });
    await expect(call("accept", { months: 1, start_period: "2020-01-01" })).rejects.toMatchObject({ code: "START_NOT_ALLOWED", fields: { start_period: ["Pick a later month"] } });
    await expect(call("waive", { reason: "short" })).rejects.toMatchObject({ fields: { reason: ["At least 10 characters"] } });
    deductions.DeductionRow.parse(await call("accept", { months: 2, start_period: openMonth }));
    await expect(call("accept", { months: 1, start_period: openMonth })).rejects.toMatchObject({ code: "FINE_NOT_MOVABLE" });
  }, 40000);
});
