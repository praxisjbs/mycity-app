// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { formatDate, ModalProvider, todayIso } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { clear, invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { byKey } from "@/api/mock/data/people";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { PeopleAttendance } from "./PeopleAttendance";

/**
 * People · Attendance's All Days (docs/guides/attendance.md §10.1, QA DEF-02): ⌘K's "All Days of
 * <the person>" opens the page with `?person=`, which opens that person's days of this month in a
 * panel, newest first; a day opens its own sheet over the panel, which is still there after it.
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

beforeEach(() => {
  setViewport(1440);
  Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: async () => ({ state: "prompt" }) } });
});
afterEach(() => cleanup());

let auth: ReturnType<typeof useAuth> | null = null;
function Harness({ children }: { children?: ReactNode }) {
  auth = useAuth();
  return auth.status === "signed-in" ? <>{children}</> : null;
}

/** People · Attendance at `address`, signed in as Cynthia (Operations & People, everyone in scope). */
async function openAt(address: string) {
  window.history.replaceState(null, "", address);
  mockSession.set(null);
  clear();
  invalidate("/api/v1");
  render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <Harness>
            <PeopleAttendance />
          </Harness>
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>,
  );
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 10000 });
  await act(async () => {
    await auth!.signIn("cynthia@mycityapp.io", "demo1234");
  });
}

describe("All Days of a person", () => {
  it("opens the person's days of this month, newest first, and a day opens its own sheet", async () => {
    const bashir = byKey("bashir")!;
    await openAt(`/people?tab=attendance&person=${bashir.employee_id}`);
    const sheet = await screen.findByRole("dialog", { name: "Bashir Lawal" }, { timeout: 8000 });
    await within(sheet).findAllByText("All Days", undefined, { timeout: 5000 });
    const rows = (await within(sheet).findAllByRole("row", undefined, { timeout: 5000 })).slice(1);
    expect(rows.length).toBeGreaterThan(0);
    const month = todayIso().slice(0, 7);
    const dates = rows.map((r) => within(r).getAllByRole("cell")[0]!.textContent ?? "");
    // This month's days, newest first, as people read dates.
    for (const d of dates) expect(d).toMatch(new RegExp(`^\\d\\d/${month.slice(5, 7)}/${month.slice(0, 4)}$`));
    const iso = dates.map((d) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`);
    expect([...iso].sort().reverse()).toEqual(iso);
    expect(await axe(sheet)).toHaveNoViolations();

    fireEvent.click(within(rows[0]!).getAllByRole("cell")[0]!);
    // The day opens over the panel (the panel leaves the accessibility tree while it is covered).
    await waitFor(() => expect(screen.getAllByRole("dialog").some((d) => within(d).queryAllByText("Punches").length > 0)).toBe(true), { timeout: 5000 });
    const day = screen.getAllByRole("dialog").find((d) => within(d).queryAllByText("Punches").length > 0)!;
    expect(within(day).getByText(formatDate(iso[0]!))).toBeTruthy();
    fireEvent.click(within(day).getByRole("button", { name: "Close" }));
    // Closed, the person's days are still open beneath it.
    await waitFor(() => expect(screen.getAllByRole("dialog").some((d) => within(d).queryAllByText("All Days").length > 0)).toBe(true), { timeout: 5000 });
  }, 40000);
});
