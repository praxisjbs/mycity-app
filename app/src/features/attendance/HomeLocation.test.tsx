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
import { setMockHomeLocation } from "@/api/mock/modules/policies";
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
 * from the mock's history). The policy's Home Location (attendance.md §1.3), off on the mock as in
 * production, is switched on for these cases; the last case runs with it off.
 */

type Position = { coords: { latitude: number; longitude: number; accuracy: number } };
let answer: ((p: Position) => void) | null = null;
const watchPosition = vi.fn((ok: (p: Position) => void) => {
  answer = ok;
  return 1;
});
const clearWatch = vi.fn();
const PHONE = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";

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
  watchPosition.mockClear();
  answer = null;
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { watchPosition, clearWatch } });
  // A phone, so a weak reading is the usual move-and-retry rather than Use Your Phone.
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: PHONE });
  Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: async () => ({ state: "prompt" }) } });
  byKey("chidera")!.work_pattern = "remote";
  setMockHomeLocation(true);
});
afterEach(() => {
  setMockHomeLocation(false);
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
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
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 15000 });
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
    await waitFor(() => expect(watchPosition).toHaveBeenCalledTimes(1));
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
    expect(watchPosition).not.toHaveBeenCalled();
    expect(await axe(document.body)).toHaveNoViolations();

    // A 240 m reading is kept while the reader looks for a better one, for ten seconds; only Not Now meanwhile.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    press("Use This Location");
    await waitFor(() => expect(watchPosition).toHaveBeenCalledTimes(1));
    act(() => answer!({ coords: { latitude: 6.5, longitude: 3.37, accuracy: 240 } }));
    expect(screen.getByText("Finding Your Location")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use This Location" })).toBeNull();
    expect(screen.getByRole("button", { name: "Not Now" })).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    vi.useRealTimers();
    await screen.findByText("Weak Location Signal");
    expect(clearWatch).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Send for Approval" })).toBeNull();

    press("Retry Location");
    await waitFor(() => expect(watchPosition).toHaveBeenCalledTimes(2));
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
    // Homes shows once today's policy says Home Location is on.
    fireEvent.click(await screen.findByRole("radio", { name: "Homes" }, { timeout: 5000 }));
    const row = await screen.findByText("Seyi Balogun");
    expect(screen.getByText("3 Fixture Road, Ikoyi")).toBeTruthy();
    fireEvent.click(row);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Record Decision")).toBeTruthy();
    const waiting = await api.call("GET /api/v1/attendance/homes", { query: { status: "pending", q: "seyi" } });
    expect(waiting.data[0]).toMatchObject({ can_decide: true });

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

describe("who decides", () => {
  // The mock's line managers hold no People grant, so the team-scope refusal is the API's test (attendance.test.js).
  it("People with scope all decide everyone's open exceptions but their own", async () => {
    await signedInAs("cynthia@mycityapp.io");
    const all = await api.call("GET /api/v1/attendance/exceptions", { query: { status: "open" } });
    const me = byKey("cynthia")!.employee_id;
    expect(all.data.filter((x) => x.employee.employee_id !== me).every((x) => x.can_decide)).toBe(true);
    expect(all.data.filter((x) => x.employee.employee_id === me).every((x) => !x.can_decide)).toBe(true);
  }, 20000);
});

describe("with the policy's Home Location off", () => {
  beforeEach(() => setMockHomeLocation(false));

  it("no card and no home banner; Clock In reads no location and the punch is not checked", async () => {
    await signedInAs("chidera@mycityapp.io", <HomeLocationCard openOnLoad />);
    act(() => clock!.open());
    await screen.findByText("Not Checked");
    expect(screen.queryByText("No approved home location yet.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Set Home" })).toBeNull();
    expect(screen.queryByText("Home Location")).toBeNull();

    // The mock keeps the first case's clock-in: whichever the panel offers, it sends no reading. The
    // device check still runs, so an unregistered device may still send the punch to review.
    const out = clock!.today!.state === "clocked_in";
    press(out ? "Clock Out" : "Clock In");
    await waitFor(() => expect(clock!.today!.state).toBe(out ? "clocked_out" : "clocked_in"), { timeout: 5000 });
    expect(watchPosition).not.toHaveBeenCalled();
    expect(screen.queryByText("Share Your Location")).toBeNull();
    const today = await api.call("GET /api/v1/attendance/me/today", {});
    expect(today.location).toEqual({ kind: "remote", name: null, radius_m: null, home_state: null, checked: false });
    expect(today.policy.home_location).toBe(false);
    const events = await api.call("GET /api/v1/attendance/me/events", { query: { date: today.date } });
    const punched = events.data.find((e) => e.event_type === (out ? "clock_out" : "clock_in"));
    expect(punched).toMatchObject({ geofence: "not_applied", location_reason: "home_location_off", distance_m: null });
  }, 20000);

  it("People see no Homes view, and the home routes refuse", async () => {
    await signedInAs("cynthia@mycityapp.io", <PeopleAttendance />);
    await screen.findByRole("radio", { name: "Register" });
    expect(screen.queryByRole("radio", { name: "Homes" })).toBeNull();
    await expect(api.call("GET /api/v1/attendance/homes", { query: {} })).rejects.toMatchObject({ code: "HOME_LOCATION_OFF" });
  }, 20000);
});
