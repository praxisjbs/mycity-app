// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import attendance from "@mycity/contract/schemas/attendance.js";
import type { PayItem } from "@mycity/contract/contract.gen.ts";
import userEvent from "@testing-library/user-event";
import { addDaysIso, formatDate, formatMoney, ModalProvider, Toaster, todayIso } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { setMockOvertimeApproval } from "@/api/mock/modules/policies";
import { byId, byKey } from "@/api/mock/data/people";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { ScreenActionProvider, useRegisteredAction } from "@/shell/screen-action";
import { useClock } from "./ClockButton";
import { MyAttendancePage } from "./EssAttendance";
import { PeopleAttendance } from "./PeopleAttendance";
import { overtimeText, waivedText } from "./PayItems";
import { lateBy, PAY_STATUS } from "./labels";

/**
 * Pending deductions and overtime, and Give Real Time, on the in-browser mock
 * (docs/guides/attendance.md §6.14, §6.17, §10): a person reads their month's items on My
 * Attendance; People waive deductions one by one or ticked, confirm or cut overtime, and approve
 * overtime on a day beforehand; a person gives the real time of a System Clock-Out. The mock's
 * Attendance policy (version 2) deducts late arrivals by the minute and pays overtime past 30
 * minutes once the line manager confirms it, and its items are priced from each person's gross.
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

beforeEach(() => {
  setViewport(1440);
  Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: async () => ({ state: "prompt" }) } });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let clock: ReturnType<typeof useClock> | null = null;
let auth: ReturnType<typeof useAuth> | null = null;
let fab: ReturnType<typeof useRegisteredAction> = null;
function Clock({ children }: { children?: ReactNode }) {
  clock = useClock();
  fab = useRegisteredAction();
  return <>{children}</>;
}
function Harness({ children }: { children?: ReactNode }) {
  auth = useAuth();
  return auth.status === "signed-in" ? <Clock>{children}</Clock> : null;
}

async function signedInAs(email: string, screenUnderTest: ReactNode) {
  mockSession.set(null);
  invalidate("/api/v1");
  clock = null;
  render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <ScreenActionProvider>
            <Harness>{screenUnderTest}</Harness>
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
  await waitFor(() => expect(clock?.today).toBeTruthy(), { timeout: 5000 });
}

/** People's list, as Cynthia (Operations, everyone) reads it. */
const peopleItems = async (query: Record<string, string>): Promise<PayItem[]> => attendance.PayItemPage.parse(await api.call("GET /api/v1/attendance/pay-items", { query })).data;
const emailOf = (x: PayItem) => `${byId(x.employee.employee_id)!.user_key}@mycityapp.io`;
/** Steps My Attendance's month back to the item's month (the newest item may fall in the last one). */
async function toMonthOf(date: string) {
  if (date.slice(0, 7) === todayIso().slice(0, 7)) return;
  fireEvent.click(await screen.findByRole("button", { name: "Previous Month" }));
}
const rowWith = (table: HTMLElement, text: string) => within(table).getAllByText(text)[0].closest("tr")!;

describe("My Attendance's deductions and overtime", () => {
  it("lists the month's deductions with their amounts, and one opens with its method", async () => {
    await signedInAs("cynthia@mycityapp.io", <MyAttendancePage />);
    const someone = (await peopleItems({ group: "deductions", kind: "late" })).find((x) => x.employee.employee_id !== auth!.me!.employee_id)!;
    cleanup();
    await signedInAs(emailOf(someone), <MyAttendancePage />);
    await toMonthOf(someone.work_date);
    const mine = attendance.PayItemPage.parse(await api.call("GET /api/v1/attendance/me/pay-items", { query: { month: someone.work_date.slice(0, 7), group: "deductions" } })).data;
    const item = mine.find((x) => x.attendance_pay_item_id === someone.attendance_pay_item_id)!;
    // Their own amount is never masked from them.
    expect(item.pay_amount).not.toBeNull();
    const table = await screen.findByRole("table", { name: "Deductions" }, { timeout: 5000 });
    const row = rowWith(table, formatDate(item.work_date));
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual([formatDate(item.work_date), "Late", lateBy(item.minutes), "Pro-Rata by Minute", formatMoney(item.pay_amount), "Pending"]);
    expect(await axe(document.body)).toHaveNoViolations();

    fireEvent.click(row);
    const sheet = await screen.findByRole("dialog", { name: "Late" });
    expect(within(sheet).getByText("Method").nextElementSibling?.textContent).toBe("Pro-Rata by Minute");
    expect(within(sheet).getByRole("button", { name: "Amount" })).toBeTruthy();
  }, 40000);

  it("on a phone, the deductions are cards without the method, which waits in the item's sheet", async () => {
    setViewport(390);
    await signedInAs("cynthia@mycityapp.io", <MyAttendancePage />);
    const someone = (await peopleItems({ group: "deductions", kind: "late" })).find((x) => x.employee.employee_id !== auth!.me!.employee_id)!;
    cleanup();
    await signedInAs(emailOf(someone), <MyAttendancePage />);
    await toMonthOf(someone.work_date);
    await screen.findByText("Deductions", {}, { timeout: 5000 });
    expect(document.querySelector("table")).toBeNull();
    const card = (await screen.findAllByRole("button", { name: new RegExp(formatDate(someone.work_date)) }))[0].closest("li")!;
    expect(within(card).queryByText("Method")).toBeNull();
    // The kind and the minutes share a line, so the amount and the status stay on the card.
    expect(within(card).getByText("Kind").nextElementSibling?.textContent).toBe(`Late · ${lateBy(someone.minutes)}`);
    expect(within(card).getByText("Status").nextElementSibling?.textContent).toBe(PAY_STATUS[someone.status].text);
    expect(within(card).getByText("Amount")).toBeTruthy();
    fireEvent.click(within(card).getAllByRole("button")[0]);
    const sheet = await screen.findByRole("dialog", { name: "Late" });
    expect(within(sheet).getByText("Pro-Rata by Minute")).toBeTruthy();
    expect(await axe(document.body)).toHaveNoViolations();
  }, 40000);
});

describe("Give Real Time", () => {
  it("a System Clock-Out takes the person's real leaving time and a note, once", async () => {
    await signedInAs("cynthia@mycityapp.io", <MyAttendancePage />);
    // Her System Clock-Out lands on her last day worked two days back or more: this month, or the last.
    let day = attendance.AttendanceDayPage.parse(await api.call("GET /api/v1/attendance/me", { query: {} })).data.find((d) => d.clock_out_automatic);
    if (!day) {
      fireEvent.click(await screen.findByRole("button", { name: "Previous Month" }));
      const prev = new Date(`${todayIso().slice(0, 7)}-15T12:00:00Z`);
      prev.setUTCMonth(prev.getUTCMonth() - 1);
      day = attendance.AttendanceDayPage.parse(await api.call("GET /api/v1/attendance/me", { query: { month: prev.toISOString().slice(0, 7) } })).data.find((d) => d.clock_out_automatic);
    }
    expect(day).toBeTruthy();
    const table = await screen.findByRole("table", { name: "My Days" }, { timeout: 5000 });
    await waitFor(() => expect(within(table).queryAllByText(formatDate(day!.attendance_date)).length).toBeGreaterThan(0));
    const row = rowWith(table, formatDate(day!.attendance_date));
    expect(within(row).getByText("System Clock-Out")).toBeTruthy();
    fireEvent.click(row);
    const daySheet = await screen.findByRole("dialog", { name: formatDate(day!.attendance_date) });
    fireEvent.click(await within(daySheet).findByRole("button", { name: "Give Real Time" }));
    const sheet = await screen.findByRole("dialog", { name: "Give Real Time" });
    expect(within(sheet).getByText("System Clock-Out")).toBeTruthy();
    expect(await axe(sheet)).toHaveNoViolations();

    // A time before the clock-in is refused on the field by the API.
    fireEvent.change(within(sheet).getByLabelText("Real Time"), { target: { value: "0500" } });
    fireEvent.change(within(sheet).getByLabelText("Your Note"), { target: { value: "Left for the bank" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Send Time" }));
    expect(await within(sheet).findByText("After your clock-in")).toBeTruthy();

    fireEvent.change(within(sheet).getByLabelText("Real Time"), { target: { value: "1615" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Send Time" }));
    expect(await screen.findByText("Time sent to People")).toBeTruthy();
    const exceptions = attendance.AttendanceExceptionPage.parse(await api.call("GET /api/v1/attendance/me/exceptions", { query: {} })).data;
    const given = exceptions.find((x) => x.exception_type === "automatic_clock_out" && x.work_date === day!.attendance_date)!;
    expect(given).toMatchObject({ real_time: "16:15", employee_note: "Left for the bank", status: "open" });
    expect(given.detail).toMatch(/^System Clock-Out at \d{2}:\d{2}; real time 16:15$/);
  }, 40000);
});

describe("what a waive or an overtime decision says", () => {
  it("names the skipped deductions and why", () => {
    expect(waivedText({ waived: [1], skipped: [] })).toBe("Deduction waived");
    expect(waivedText({ waived: [1, 2], skipped: [] })).toBe("2 deductions waived");
    expect(waivedText({ waived: [1, 2], skipped: [{ code: "NOT_PENDING" }, { code: "IN_RUN" }] })).toBe("2 waived, 1 already decided, 1 in payroll");
    expect(waivedText({ waived: [], skipped: [{ code: "IN_RUN" }] })).toBe("None waived, 1 in payroll");
  });
  it("says when the monthly cap cut or shortened a confirmation", () => {
    expect(overtimeText({ status: "cut", reason: "Monthly cap", confirmed_minutes: 0 }, "confirm")).toBe("Overtime cut: monthly cap reached");
    expect(overtimeText({ status: "confirmed", reason: "Monthly cap", confirmed_minutes: 90 }, "confirm")).toBe("1h 30m confirmed: monthly cap reached");
    expect(overtimeText({ status: "cut", reason: "Not agreed", confirmed_minutes: 0 }, "cut")).toBe("Overtime cut");
    expect(overtimeText({ status: "confirmed", reason: null, confirmed_minutes: 60 }, "confirm")).toBe("Overtime confirmed");
  });
});

describe("People · Attendance's deductions and overtime", () => {
  it("People waive ticked deductions with a reason, never their own, and the floating button offers Waive Selected", async () => {
    await signedInAs("cynthia@mycityapp.io", <PeopleAttendance />);
    fireEvent.click(await screen.findByRole("radio", { name: "Deductions" }, { timeout: 5000 }));
    const table = await screen.findByRole("table", { name: "Deductions" }, { timeout: 5000 });
    const pending = (await peopleItems({ group: "deductions", status: "pending" })).slice(0, 25);
    await waitFor(() => expect(within(table).getAllByRole("row").length).toBeGreaterThan(1));
    // Her own deductions are someone else's to waive.
    expect(pending.filter((x) => x.employee.employee_id === auth!.me!.employee_id).every((x) => !x.can_decide)).toBe(true);
    const two = pending.filter((x) => x.can_decide).slice(0, 2);
    expect(two).toHaveLength(2);
    expect(await axe(document.body)).toHaveNoViolations();

    const boxes = within(table).getAllByRole("checkbox").slice(1);
    for (const x of two) fireEvent.click(boxes[pending.findIndex((p) => p.attendance_pay_item_id === x.attendance_pay_item_id)]);
    await waitFor(() => expect(fab?.label).toBe("Waive Selected"));
    fireEvent.click(screen.getByRole("button", { name: "Waive Selected" }));
    const sheet = await screen.findByRole("dialog", { name: "Waive Selected" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Waive Deductions" }));
    expect(await within(sheet).findByText("Required")).toBeTruthy();
    fireEvent.change(within(sheet).getByLabelText("Reason"), { target: { value: "Traffic on the bridge, agreed with People" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Waive Deductions" }));
    expect(await screen.findByText("2 deductions waived")).toBeTruthy();
    const waived = await peopleItems({ group: "deductions", status: "waived" });
    for (const x of two) expect(waived.find((w) => w.attendance_pay_item_id === x.attendance_pay_item_id)).toMatchObject({ status: "waived", reason: "Traffic on the bridge, agreed with People", decided_by_name: "Cynthia Osakunih" });
    await waitFor(() => expect(fab?.label).not.toBe("Waive Selected"));
  }, 40000);

  it("People confirm fewer minutes of pending overtime, or cut it with a reason", async () => {
    await signedInAs("cynthia@mycityapp.io", <PeopleAttendance />);
    fireEvent.click(await screen.findByRole("radio", { name: "Overtime" }, { timeout: 5000 }));
    const table = await screen.findByRole("table", { name: "Overtime" }, { timeout: 5000 });
    const pending = (await peopleItems({ group: "overtime", status: "pending" })).filter((x) => x.can_decide);
    expect(pending.length).toBeGreaterThan(1);
    const [first, second] = pending;
    await waitFor(() => expect(within(table).getAllByRole("row").length).toBeGreaterThan(1));
    const listed = await peopleItems({ group: "overtime", status: "pending" });
    fireEvent.click(within(table).getAllByRole("row")[1 + listed.findIndex((x) => x.attendance_pay_item_id === first.attendance_pay_item_id)]);
    let sheet = await screen.findByRole("dialog", { name: "Overtime" });
    expect((within(sheet).getByLabelText("Minutes") as HTMLInputElement).value).toBe(String(first.minutes));
    expect(await axe(sheet)).toHaveNoViolations();
    fireEvent.change(within(sheet).getByLabelText("Minutes"), { target: { value: String(first.minutes - 10) } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Overtime confirmed")).toBeTruthy();
    const confirmed = (await peopleItems({ group: "overtime", status: "confirmed" })).find((x) => x.attendance_pay_item_id === first.attendance_pay_item_id)!;
    expect(confirmed).toMatchObject({ confirmed_minutes: first.minutes - 10, decided_by_name: "Cynthia Osakunih" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const now = await peopleItems({ group: "overtime", status: "pending" });
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(now.length + 1));
    fireEvent.click(within(table).getAllByRole("row")[1 + now.findIndex((x) => x.attendance_pay_item_id === second.attendance_pay_item_id)]);
    sheet = await screen.findByRole("dialog", { name: "Overtime" });
    // Cutting needs a reason the person reads.
    fireEvent.click(within(sheet).getByRole("button", { name: "Cut" }));
    expect(await within(sheet).findByText("At least 10 characters")).toBeTruthy();
    fireEvent.change(within(sheet).getByLabelText("Reason"), { target: { value: "Not agreed with the line manager" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Cut" }));
    expect(await screen.findByText("Overtime cut")).toBeTruthy();
    expect((await peopleItems({ group: "overtime", status: "cut" })).find((x) => x.attendance_pay_item_id === second.attendance_pay_item_id)).toMatchObject({ confirmed_minutes: 0, reason: "Not agreed with the line manager" });
  }, 40000);

  it("People approve overtime beforehand only under Pre-Approved, for today or a day to come", async () => {
    // The mock's version pays overtime once the line manager confirms it: nothing to approve beforehand.
    await signedInAs("cynthia@mycityapp.io", <PeopleAttendance />);
    let table = await screen.findByRole("table", { name: "Register" }, { timeout: 5000 });
    fireEvent.click(await within(table).findByText("Damilola Eke", {}, { timeout: 5000 }));
    let day = await screen.findByRole("dialog", { name: "Damilola Eke" });
    await within(day).findAllByText("Punches");
    expect(within(day).queryByRole("button", { name: "Approve Overtime" })).toBeNull();
    cleanup();

    setMockOvertimeApproval("pre_approved");
    try {
      await signedInAs("cynthia@mycityapp.io", <PeopleAttendance />);
      table = await screen.findByRole("table", { name: "Register" }, { timeout: 5000 });
      fireEvent.click(await within(table).findByText("Damilola Eke", {}, { timeout: 5000 }));
      day = await screen.findByRole("dialog", { name: "Damilola Eke" });
      fireEvent.click(await within(day).findByRole("button", { name: "Approve Overtime" }));
      const sheet = await screen.findByRole("dialog", { name: "Approve Overtime" });
      const ahead = addDaysIso(todayIso(), 3);
      const user = userEvent.setup();
      await user.clear(within(sheet).getByLabelText("Day"));
      await user.type(within(sheet).getByLabelText("Day"), formatDate(ahead));
      fireEvent.change(within(sheet).getByLabelText("Minutes"), { target: { value: "90" } });
      fireEvent.change(within(sheet).getByLabelText("Reason"), { target: { value: "Month-end close with Finance" } });
      expect(await axe(sheet)).toHaveNoViolations();
      fireEvent.click(within(sheet).getByRole("button", { name: "Approve Overtime" }));
      expect(await screen.findByText("Overtime approved")).toBeTruthy();
      const detail = attendance.DayDetail.parse(await api.call("GET /api/v1/attendance/register/:employee_id", { params: { employee_id: byKey("damilola")!.employee_id }, query: { date: ahead } }));
      expect(detail.overtime_approval).toMatchObject({ minutes: 90, approved_by_name: "Cynthia Osakunih", reason: "Month-end close with Finance" });
    } finally {
      setMockOvertimeApproval("manager_after");
    }
  }, 40000);

  it("on a phone, deductions are cards with a tick, and Overtime and Deductions sit in the view switch", async () => {
    setViewport(390);
    await signedInAs("cynthia@mycityapp.io", <PeopleAttendance />);
    fireEvent.click(await screen.findByRole("radio", { name: "Deductions" }, { timeout: 5000 }));
    await screen.findByRole("heading", { name: "Deductions" }, { timeout: 5000 });
    expect(document.querySelector("table")).toBeNull();
    await waitFor(() => expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0));
    // The day, the kind and the minutes share a line, so the amount and the status stay on the card.
    const card = screen.getAllByRole("checkbox").map((c) => c.closest("li")).find(Boolean)!;
    expect(within(card).getByText("Day").nextElementSibling?.textContent).toMatch(/^\d{2}\/\d{2}\/\d{4} · .+ · .+$/);
    expect(within(card).getByText("Amount")).toBeTruthy();
    expect(within(card).getByText("Status")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Overtime" })).toBeTruthy();
    expect(await axe(document.body)).toHaveNoViolations();
  }, 40000);
});
