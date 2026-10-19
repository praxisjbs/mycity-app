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
import { EmployeeAttendance } from "./WorkSetup";

/**
 * The employee record's Attendance tab on the in-browser mock (docs/guides/attendance.md §6.13, §10):
 * a person's pattern, office and week, and People setting a hybrid employee's office days. The mock's
 * schedules are invented: Tolu is at the office Monday, Tuesday and Thursday, with Monday to
 * Wednesday waiting to start in a week.
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
/** The pill beside a weekday on the Work Week card. */
const placeOf = (day: string) => screen.getByText(day).parentElement!.textContent;
const dayGroup = (dialog: HTMLElement, day: string) => within(dialog).getByRole("radiogroup", { name: day });

describe("the record's Attendance tab", () => {
  it("People read a hybrid employee's week and set the office days from today", async () => {
    await signedInAs("cynthia@mycityapp.io", <EmployeeAttendance id={idOf("tolu")} />);
    await screen.findByText("Work Week");
    expect(placeOf("Monday")).toContain("Office");
    expect(placeOf("Wednesday")).toContain("Remote");
    expect(placeOf("Sunday")).toContain("Off");
    expect(screen.getByText(/^Office Mon, Tue, Wed from /)).toBeTruthy();
    expect(await axe(document.body)).toHaveNoViolations();

    fireEvent.click(screen.getByRole("button", { name: "Set Schedule" }));
    const dialog = await screen.findByRole("dialog");
    // The schedule in force: Wednesday at home.
    expect(within(dayGroup(dialog, "Wednesday")).getByRole("radio", { name: "Remote" }).getAttribute("aria-checked")).toBe("true");
    expect(await axe(dialog)).toHaveNoViolations();

    // Every working day at the office is refused on the field, before anything is sent.
    for (const day of ["Wednesday", "Friday", "Saturday"]) fireEvent.click(within(dayGroup(dialog, day)).getByRole("radio", { name: "Office" }));
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Planning moved to Wednesday" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Schedule" }));
    await waitFor(() => expect(within(dialog).getByText("Leave a home day")).toBeTruthy());

    fireEvent.click(within(dayGroup(dialog, "Saturday")).getByRole("radio", { name: "Remote" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Schedule" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(placeOf("Wednesday")).toContain("Office"));
    expect(placeOf("Saturday")).toContain("Remote");
  }, 30000);

  it("an on-site employee is at the office every working day, and nobody sets a schedule on their own record", async () => {
    await signedInAs("cynthia@mycityapp.io", <EmployeeAttendance id={idOf("emeka")} />);
    await screen.findByText("Work Week");
    expect(placeOf("Wednesday")).toContain("Office");
    expect(screen.queryByRole("button", { name: "Set Schedule" })).toBeNull();
    cleanup();

    await signedInAs("cynthia@mycityapp.io", <EmployeeAttendance id={idOf("cynthia")} />);
    await screen.findByText("Work Week");
    expect(screen.queryByRole("button", { name: "Set Schedule" })).toBeNull();
  }, 30000);

  it("reads the same on a phone, with Set Schedule full width", async () => {
    setViewport(390);
    await signedInAs("cynthia@mycityapp.io", <EmployeeAttendance id={idOf("bashir")} />);
    await screen.findByText("Work Week");
    expect(placeOf("Tuesday")).toContain("Office");
    expect(placeOf("Monday")).toContain("Remote");
    expect(screen.getByRole("button", { name: "Set Schedule" }).className).toContain("phone:w-full");
    expect(await axe(document.body)).toHaveNoViolations();
  }, 30000);
});
