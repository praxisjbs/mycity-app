// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ModalProvider } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { byKey } from "@/api/mock/data/people";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { EmployeeWorkSchedule } from "./WorkSetup";

/**
 * The employee record's Work Schedule tab on the in-browser mock (docs/guides/attendance.md §6.13,
 * §10): a person's pattern, office and week, each weekday Working or Off with its hours and place,
 * and People setting anyone's schedule from a day. The mock's schedules are invented: Tolu is at the
 * office Monday, Tuesday and Thursday on the company hours, with Monday to Wednesday waiting to
 * start in a week; Damilola's later shift starts in three days; Emeka has none (Company Hours).
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

beforeEach(() => setViewport(1440));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let auth: ReturnType<typeof useAuth> | null = null;
function Harness({ children }: { children?: ReactNode }) {
  auth = useAuth();
  return auth.status === "signed-in" ? <>{children}</> : null;
}

async function signedInAs(email: string, screenUnderTest: ReactNode) {
  mockSession.set(null);
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
    await auth!.signIn(email, "demo1234");
  });
}

const idOf = (key: string) => byKey(key)!.employee_id;
/** A weekday's row on the Work Schedule card: its hours, Company Hours, and the place or Off. */
const rowOf = (day: string) => screen.getByText(day).parentElement!.textContent;
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const daysFrom = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
};

describe("the record's Work Schedule tab", () => {
  it("People read a hybrid employee's week and set their own hours on a day from today", async () => {
    await signedInAs("cynthia@mycityapp.io", <EmployeeWorkSchedule id={idOf("tolu")} />);
    await screen.findByText("Work Schedule");
    expect(rowOf("Monday")).toContain("09:00 to 17:00");
    expect(rowOf("Monday")).toContain("Company Hours");
    expect(rowOf("Monday")).toContain("Office");
    expect(rowOf("Wednesday")).toContain("Remote");
    expect(rowOf("Saturday")).toContain("09:00 to 15:00");
    expect(rowOf("Sunday")).toContain("Off");
    expect(rowOf("Next")).toContain(ddmmyyyy(daysFrom(7)));
    expect(await axe(document.body)).toHaveNoViolations();

    fireEvent.click(screen.getByRole("button", { name: "Set Schedule" }));
    const dialog = await screen.findByRole("dialog");
    // The schedule in force: Wednesday from home, on the company hours (both times blank).
    expect(within(within(dialog).getByRole("radiogroup", { name: "Wednesday Place" })).getByRole("radio", { name: "Remote" }).getAttribute("aria-checked")).toBe("true");
    expect((within(dialog).getAllByLabelText("Starts")[0] as HTMLInputElement).value).toBe("");
    expect(await axe(dialog)).toHaveNoViolations();

    // One time without the other is refused on the field, before anything is sent.
    fireEvent.change(within(dialog).getAllByLabelText("Starts")[0], { target: { value: "0800" } });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Early start for the planning desk" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Schedule" }));
    await waitFor(() => expect(within(dialog).getByText("Both times or neither")).toBeTruthy());

    fireEvent.change(within(dialog).getAllByLabelText("Ends")[0], { target: { value: "1600" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Schedule" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(rowOf("Monday")).toContain("08:00 to 16:00"));
    expect(rowOf("Monday")).not.toContain("Company Hours");
    expect(rowOf("From")).toContain(ddmmyyyy(daysFrom(0)));
  }, 30000);

  it("a day off has no hours, and a working day the company does not work needs its own", async () => {
    await signedInAs("cynthia@mycityapp.io", <EmployeeWorkSchedule id={idOf("emeka")} />);
    await screen.findByText("Work Schedule");
    expect(rowOf("From")).toContain("Company Hours");
    fireEvent.click(screen.getByRole("button", { name: "Set Schedule" }));
    const dialog = await screen.findByRole("dialog");
    const working = within(dialog).getAllByRole("checkbox", { name: "Working" });
    // Sunday is Off on the company hours: working it with no times is refused by the API.
    fireEvent.click(working[6]);
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Sunday market cover" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Schedule" }));
    await waitFor(() => expect(within(dialog).getByText("Give the hours")).toBeTruthy());
  }, 30000);

  it("shows a schedule waiting to start, and nobody sets their own", async () => {
    await signedInAs("cynthia@mycityapp.io", <EmployeeWorkSchedule id={idOf("damilola")} />);
    await screen.findByText("Work Schedule");
    expect(rowOf("Next")).toContain(ddmmyyyy(daysFrom(3)));
    expect(rowOf("Monday")).toContain("Company Hours");
    cleanup();

    await signedInAs("cynthia@mycityapp.io", <EmployeeWorkSchedule id={idOf("cynthia")} />);
    await screen.findByText("Work Schedule");
    expect(screen.queryByRole("button", { name: "Set Schedule" })).toBeNull();
  }, 30000);

  it("reads the same on a phone, with Set Schedule full width and its sheet full screen", async () => {
    setViewport(390);
    await signedInAs("cynthia@mycityapp.io", <EmployeeWorkSchedule id={idOf("bashir")} />);
    await screen.findByText("Work Schedule");
    expect(rowOf("Tuesday")).toContain("Office");
    expect(rowOf("Monday")).toContain("Remote");
    expect(screen.getByRole("button", { name: "Set Schedule" }).className).toContain("phone:w-full");
    expect(await axe(document.body)).toHaveNoViolations();
    fireEvent.click(screen.getByRole("button", { name: "Set Schedule" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByRole("checkbox", { name: "Working" })).toHaveLength(7);
    expect(await axe(dialog)).toHaveNoViolations();
  }, 30000);
});
