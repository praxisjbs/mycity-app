// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ModalProvider } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { byKey } from "@/api/mock/data/people";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { useClock } from "./ClockButton";
import { HomeLocationCard } from "./HomeLocation";
import { PeopleAttendance } from "./PeopleAttendance";

/**
 * Remote staff's homes on the in-browser mock (docs/guides/attendance.md §6.10, §10): with no
 * approved home the clock still asks for the location and says People will review it; Set Home
 * Location takes one reading good enough and the address; People approve or reject what waits.
 * Chidera, who has not clocked in today on the mock, is made remote for this file only, so each
 * test starts from the same day whatever the date (the Remote demonstration account's day comes
 * from the mock's history).
 */

type Position = { coords: { latitude: number; longitude: number; accuracy: number } };
let answer: ((p: Position) => void) | null = null;
const getCurrentPosition = vi.fn((ok: (p: Position) => void) => {
  answer = ok;
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

beforeEach(() => {
  setViewport(1440);
  getCurrentPosition.mockClear();
  answer = null;
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
  Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: async () => ({ state: "prompt" }) } });
  byKey("chidera")!.work_pattern = "remote";
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let clock: ReturnType<typeof useClock> | null = null;
let auth: ReturnType<typeof useAuth> | null = null;
function Clock({ children }: { children?: ReactNode }) {
  clock = useClock();
  return <>{children}</>;
}
function Harness({ children }: { children?: ReactNode }) {
  auth = useAuth();
  return auth.status === "signed-in" ? <Clock>{children}</Clock> : null;
}

async function signedInAs(email: string, screenUnderTest?: ReactNode) {
  mockSession.set(null);
  invalidate("/api/v1");
  clock = null;
  render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <Harness>{screenUnderTest}</Harness>
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>,
  );
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 5000 });
  await act(async () => {
    await auth!.signIn(email, "demo1234");
  });
  await waitFor(() => expect(clock?.today).toBeTruthy(), { timeout: 5000 });
}

const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("remote staff's homes", () => {
  it("with no approved home the clock asks for the location and People review the punch", async () => {
    await signedInAs("chidera@mycityapp.io");
    act(() => clock!.open());
    await screen.findByText("No approved home location yet.");
    expect(screen.getByText("No Approved Home")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set Home" })).toBeTruthy();

    press("Clock In");
    await screen.findByText("Share Your Location");
    expect(screen.getByText(/goes to People with your location/)).toBeTruthy();
    press("Allow Location");
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    act(() => answer!({ coords: { latitude: 6.5, longitude: 3.37, accuracy: 15 } }));
    await screen.findByText("Review Required");
    expect(screen.getByText(/you have no approved home location yet/)).toBeTruthy();
  }, 20000);

  it("Set Home Location takes a reading good enough and the address, then shows it waiting", async () => {
    await signedInAs("chidera@mycityapp.io", <HomeLocationCard openOnLoad={false} />);
    await screen.findByText("Home Location");
    expect(screen.getByText("Not Set")).toBeTruthy();
    press("Set Home Location");
    await screen.findByText("At Home Now");
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(await axe(document.body)).toHaveNoViolations();

    press("Use This Location");
    act(() => answer!({ coords: { latitude: 6.5, longitude: 3.37, accuracy: 240 } }));
    await screen.findByText("Weak Location Signal");
    expect(screen.queryByRole("button", { name: "Send for Approval" })).toBeNull();

    press("Retry Location");
    act(() => answer!({ coords: { latitude: 6.50012, longitude: 3.37008, accuracy: 14 } }));
    await screen.findByText("Location Found");
    expect(screen.getByText("Accurate to 14 m.")).toBeTruthy();

    press("Send for Approval");
    await waitFor(() => expect(screen.getByLabelText("Address").getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByText("Location Found")).toBeTruthy();

    // The address is picked, never typed (F27).
    const box = screen.getByRole("combobox", { name: /Address/ });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "herbert" } });
    fireEvent.click(await screen.findByRole("option", { name: /21 Herbert Macaulay Way, Yaba/ }, { timeout: 5000 }));
    press("Send for Approval");
    await screen.findByText("Sent for Approval");
    expect(screen.getByText("Waiting")).toBeTruthy();
    expect(screen.getByText("21 Herbert Macaulay Way, Yaba, Lagos")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update Home" })).toBeTruthy();
    // The server has the reading taken here, not one typed in.
    const mine = await api.call("GET /api/v1/attendance/me/home", {});
    expect(mine.pending).toMatchObject({ home_address: "21 Herbert Macaulay Way, Yaba, Lagos", home_latitude: 6.50012, home_longitude: 3.37008, accuracy_m: 14 });
    const today = await api.call("GET /api/v1/attendance/me/today", {});
    expect(today.location).toMatchObject({ kind: "remote", home_state: "pending" });
  }, 20000);

  it("People see homes waiting first and decide one; a rejection needs its reason", async () => {
    await signedInAs("cynthia@mycityapp.io", <PeopleAttendance />);
    fireEvent.click(screen.getByRole("radio", { name: "Homes" }));
    const row = await screen.findByText("Seyi Balogun");
    expect(screen.getByText("3 Fixture Road, Ikoyi")).toBeTruthy();
    fireEvent.click(row);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Record Decision")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("radio", { name: "Reject" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Record Decision" }));
    await waitFor(() => expect(within(dialog).getByLabelText("Reason").getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("radio", { name: "Approve" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Record Decision" }));
    // Approved, it leaves the waiting list; the home in force for Seyi is now this one.
    await waitFor(() => expect(screen.queryByText("Seyi Balogun")).toBeNull());
    const approved = await api.call("GET /api/v1/attendance/homes", { query: { status: "approved", q: "seyi" } });
    expect(approved.data.map((h) => [h.employee.display_name, h.home_address, h.decided_by_name])).toEqual([["Seyi Balogun", "3 Fixture Road, Ikoyi", "Cynthia Osakunih"]]);
  }, 20000);
});
