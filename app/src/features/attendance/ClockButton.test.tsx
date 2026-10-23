// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ModalProvider } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api, ApiError } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { siteOf } from "@/api/mock/modules/worksites";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { useClock } from "./ClockButton";

/**
 * The clock panel on the in-browser mock (docs/guides/attendance.md §10, §11): the location is
 * read only after the press, the reason comes first, a lost answer is retried with the same
 * Idempotency-Key and body, and what the panel shows after a punch is the server's answer. On a
 * temporary site's day (§6.12) it names the site and its addresses, and once clocked in offers
 * Check In, retried the same way. The mock's TS-0001 is in progress for Bashir.
 */

type Position = { coords: { latitude: number; longitude: number; accuracy: number } };
let answer: ((p: Position) => void) | null = null;
let refuse: ((e: { code: number }) => void) | null = null;
const watchPosition = vi.fn((ok: (p: Position) => void, no: (e: { code: number }) => void) => {
  answer = ok;
  refuse = no;
  return 1;
});
const clearWatch = vi.fn();
let permission = "prompt";
const JSDOM_AGENT = navigator.userAgent;
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

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
  clearWatch.mockClear();
  answer = null;
  refuse = null;
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { watchPosition, clearWatch } });
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: JSDOM_AGENT });
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: async () => ({ state: permission }) } });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

let clock: ReturnType<typeof useClock> | null = null;
let auth: ReturnType<typeof useAuth> | null = null;
/** The clock mounts once signed in, as the shell mounts it. */
function Clock() {
  clock = useClock();
  return null;
}
function Harness() {
  auth = useAuth();
  return auth.status === "signed-in" ? <Clock /> : null;
}

async function signedInAs(email: string) {
  mockSession.set(null);
  // The reads' cache is kept by path, not by person: start each person from the server.
  invalidate("/api/v1");
  clock = null;
  render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <Harness />
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
/**
 * Waits for the punch the panel sent to be answered. Text such as Review Required may already be on
 * the panel from an earlier punch, so the next person must not sign in while this one is on its way.
 */
async function answered(call: MockInstance) {
  const i = call.mock.calls.findIndex((c) => c[0] === "POST /api/v1/attendance/punches");
  expect(i).toBeGreaterThanOrEqual(0);
  await act(async () => {
    await Promise.resolve(call.mock.results[i]!.value).catch(() => undefined);
  });
}
/** Opens the panel and presses whichever punch it offers: the mock's day may already hold a clock-in. */
async function openAndPunch() {
  act(() => clock!.open());
  await screen.findByText(/^(Start|Finish) Your Day$/);
  press(screen.queryByRole("button", { name: "Clock In" }) ? "Clock In" : "Clock Out");
}

describe("the clock panel", () => {
  it("asks for the location only after Clock In is pressed, after saying what it is matched to", async () => {
    permission = "prompt";
    await signedInAs("chidera@mycityapp.io");
    act(() => clock!.open());
    await screen.findByText("Start Your Day");
    expect(watchPosition).not.toHaveBeenCalled();
    expect(await axe(document.body)).toHaveNoViolations();

    press("Clock In");
    await screen.findByText("Share Your Location");
    expect(screen.getByText(/matched to MyCity Office, Lekki/)).toBeTruthy();
    expect(watchPosition).not.toHaveBeenCalled();

    press("Allow Location");
    await waitFor(() => expect(watchPosition).toHaveBeenCalledTimes(1));
    await screen.findByText("Finding Your Location");
    // While it reads the panel stays answerable: Not Now, never a held Clock In.
    expect(screen.getByRole("button", { name: "Not Now" }).getAttribute("aria-disabled")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clock In" })).toBeNull();
    act(() => answer!({ coords: { latitude: 6.44705, longitude: 3.47201, accuracy: 12 } }));

    // Inside the fence, but this browser is not a registered device: the server holds it for review.
    await screen.findByText("Review Required");
    expect(screen.getByText(/this device is not registered/)).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Send Note" })).toBeTruthy();
    await waitFor(() => expect(clock!.today?.state).toBe("clocked_in"));
  }, 20000);

  it("never sends a second punch: a lost answer is retried with the same key and body", async () => {
    permission = "granted";
    await signedInAs("ngozi@mycityapp.io");
    const real = api.call.bind(api);
    const call = vi.spyOn(api, "call").mockImplementationOnce(() => Promise.reject(new ApiError(0, null))).mockImplementation(real as typeof api.call);
    act(() => clock!.open());
    await screen.findByText("Start Your Day");
    press("Clock In");
    await waitFor(() => expect(watchPosition).toHaveBeenCalledTimes(1));
    act(() => answer!({ coords: { latitude: 6.45201, longitude: 3.43502, accuracy: 9 } }));

    await screen.findByText("No Connection");
    expect(clock!.today?.state).toBe("not_clocked_in");
    press("Try Again");
    await screen.findByText("Review Required");

    const punches = call.mock.calls.filter((c) => c[0] === "POST /api/v1/attendance/punches");
    expect(punches).toHaveLength(2);
    const [first, second] = punches.map((c) => c[1] as { body: unknown; idempotencyKey: string });
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.body).toEqual(first.body);
  }, 20000);

  it("offers to clock in without a location when it is off, and says the server's word on it", async () => {
    permission = "granted";
    await signedInAs("cynthia@mycityapp.io");
    act(() => clock!.open());
    await screen.findByText("Start Your Day");
    press("Clock In");
    await waitFor(() => expect(watchPosition).toHaveBeenCalledTimes(1));
    act(() => refuse!({ code: 1 }));
    await screen.findByText("Location Blocked");
    expect(screen.getByText(/turn Location on/)).toBeTruthy();
    const call = vi.spyOn(api, "call");
    press("Clock In Anyway");
    await answered(call);
    await screen.findByText("Review Required");
    const body = call.mock.calls.find((c) => c[0] === "POST /api/v1/attendance/punches")?.[1] as { body: { latitude: null; location_error: string } };
    expect(body.body).toMatchObject({ latitude: null, longitude: null, location_error: "denied" });
    expect(screen.getByText(/your location could not be checked/)).toBeTruthy();
  }, 20000);

  it("ignores a second press while the first is still being recorded", async () => {
    permission = "granted";
    await signedInAs("chidera@mycityapp.io");
    expect(clock!.today?.state).toBe("clocked_in");
    const call = vi.spyOn(api, "call");
    act(() => clock!.open());
    await screen.findByText("Finish Your Day");
    press("Clock Out");
    await waitFor(() => expect(watchPosition).toHaveBeenCalledTimes(1));
    act(() => answer!({ coords: { latitude: 6.44705, longitude: 3.47201, accuracy: 12 } }));
    await screen.findByText("Processing");
    fireEvent.click(screen.getByRole("button", { name: /Clock Out/ }));
    await screen.findByText(/Clocked Out/);
    expect(call.mock.calls.filter((c) => c[0] === "POST /api/v1/attendance/punches")).toHaveLength(1);
  }, 20000);

  it("with no office to match, says so, still asks for the location, and the punch goes to People", async () => {
    permission = "prompt";
    const office = siteOf("ngozi")!;
    office.active = false;
    try {
      await signedInAs("ngozi@mycityapp.io");
      act(() => clock!.open());
      // The mock may have clocked Ngozi in already today: the panel then offers Clock Out.
      await screen.findByText(/^(Start|Finish) Your Day$/);
      expect(screen.getByText("No Office Assigned")).toBeTruthy();
      expect(screen.getByText("No office assigned yet.")).toBeTruthy();

      press(screen.queryByRole("button", { name: "Clock In" }) ? "Clock In" : "Clock Out");
      await screen.findByText("Share Your Location");
      expect(screen.getByText(/goes to People with your location/)).toBeTruthy();
      press("Allow Location");
      await waitFor(() => expect(watchPosition).toHaveBeenCalledTimes(1));
      act(() => answer!({ coords: { latitude: 6.4281, longitude: 3.4219, accuracy: 12 } }));
      expect(await screen.findByText(/People will review it: you have no office assigned yet/)).toBeTruthy();
    } finally {
      office.active = true;
    }
  }, 20000);
  it("Not Now closes the panel while it reads, and the reading stops with it", async () => {
    permission = "granted";
    await signedInAs("cynthia@mycityapp.io");
    await openAndPunch();
    await screen.findByText("Finding Your Location");
    press(screen.queryByRole("button", { name: "Not Now" }) ? "Not Now" : "Remind Me");
    await waitFor(() => expect(screen.queryByText("Finding Your Location")).toBeNull());
    expect(clearWatch).toHaveBeenCalled();
  }, 20000);

  it("a blocked location skips the ask step and says how to allow it in this browser", async () => {
    permission = "denied";
    await signedInAs("cynthia@mycityapp.io");
    await openAndPunch();
    await screen.findByText("Location Blocked");
    expect(screen.queryByText("Share Your Location")).toBeNull();
    expect(watchPosition).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retry Location" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Anyway$/ })).toBeTruthy();
  }, 20000);

  it("an insecure page needs the secure address; no location support offers no Retry; either can clock in anyway", async () => {
    permission = "granted";
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    await signedInAs("cynthia@mycityapp.io");
    await openAndPunch();
    await screen.findByText("Secure Address Needed");
    expect(screen.queryByRole("button", { name: "Retry Location" })).toBeNull();
    const call = vi.spyOn(api, "call");
    fireEvent.click(screen.getByRole("button", { name: /Anyway$/ }));
    await answered(call);
    await screen.findByText("Review Required");
    const body = call.mock.calls.find((c) => c[0] === "POST /api/v1/attendance/punches")?.[1] as { body: { location_error: string } };
    expect(body.body).toMatchObject({ latitude: null, location_error: "insecure" });

    cleanup();
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
    await signedInAs("funke@mycityapp.io");
    await openAndPunch();
    await screen.findByText("No Location Support");
    expect(screen.queryByRole("button", { name: "Retry Location" })).toBeNull();
    expect(screen.getByRole("button", { name: /Anyway$/ })).toBeTruthy();
  }, 20000);

  it("a phone set to approximate location is told how to turn precise location on; a computer to use the phone", async () => {
    permission = "granted";
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: IPHONE });
    await signedInAs("emeka@mycityapp.io");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await openAndPunch();
    await waitFor(() => expect(watchPosition).toHaveBeenCalledTimes(1));
    act(() => answer!({ coords: { latitude: 6.44705, longitude: 3.47201, accuracy: 1800 } }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    vi.useRealTimers();
    await screen.findByText("Precise Location Off");
    expect(screen.getByText(/Safari Websites, and turn on Precise Location/)).toBeTruthy();
    const call = vi.spyOn(api, "call");
    fireEvent.click(screen.getByRole("button", { name: /Anyway$/ }));
    await answered(call);
    await screen.findByText("Review Required");
    const sent = call.mock.calls.find((c) => c[0] === "POST /api/v1/attendance/punches")?.[1] as { body: { accuracy_m: number } };
    expect(sent.body).toMatchObject({ accuracy_m: 1800, latitude: 6.44705 });

    cleanup();
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: JSDOM_AGENT });
    await signedInAs("funke@mycityapp.io");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await openAndPunch();
    await waitFor(() => expect(watchPosition).toHaveBeenCalledTimes(2));
    act(() => answer!({ coords: { latitude: 6.45201, longitude: 3.43502, accuracy: 640 } }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    vi.useRealTimers();
    await screen.findByText("Use Your Phone");
  }, 30000);

  it("on a temporary site's day: the site and its addresses, then Check In once clocked in, a lost answer tried again with the same key", async () => {
    permission = "granted";
    await signedInAs("bashir@mycityapp.io");
    expect(clock!.today!.location).toMatchObject({ kind: "temporary_site", name: "Partner Training Week" });
    expect(clock!.today!.temporary_site).toMatchObject({ number: "TS-0001", name: "Partner Training Week" });
    act(() => clock!.open());
    if (clock!.today!.state !== "clocked_in") {
      await screen.findByText("Start Your Day");
      // Check In waits for the clock-in.
      expect(screen.queryByRole("button", { name: "Check In" })).toBeNull();
      press("Clock In");
      // The permission is read first, then the location is asked for.
      await waitFor(() => expect(watchPosition).toHaveBeenCalledTimes(1));
      act(() => answer!({ coords: { latitude: 6.4282, longitude: 3.4219, accuracy: 12 } }));
      await waitFor(() => expect(clock!.today?.state).toBe("clocked_in"));
      watchPosition.mockClear();
      cleanup();
      await signedInAs("bashir@mycityapp.io");
      act(() => clock!.open());
    }
    await screen.findByText("Finish Your Day");
    expect(screen.getByText("TS-0001")).toBeTruthy();
    expect(screen.getByText("Hall · 200 m; Annex · 150 m")).toBeTruthy();

    const real = api.call.bind(api);
    let lost = false;
    const call = vi.spyOn(api, "call").mockImplementation(((key: string, opts: unknown) => {
      if (key === "POST /api/v1/attendance/check-ins" && !lost) {
        lost = true;
        return Promise.reject(new ApiError(0, null));
      }
      return (real as (k: string, o: unknown) => Promise<unknown>)(key, opts);
    }) as typeof api.call);
    press("Check In");
    await waitFor(() => expect(watchPosition).toHaveBeenCalledTimes(1));
    act(() => answer!({ coords: { latitude: 6.4285, longitude: 3.4219, accuracy: 12 } }));
    await screen.findByText("Check-in not sent yet.");
    press("Try Again");
    await screen.findByText("Checked in at Hall.");
    const sent = call.mock.calls.filter(([key]) => key === "POST /api/v1/attendance/check-ins");
    expect(sent).toHaveLength(2);
    expect(sent[1][1]).toEqual(sent[0][1]);
    expect(watchPosition).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(clock!.today!.check_ins).toHaveLength(1));
    expect(clock!.today!.check_ins[0]).toMatchObject({ location_name: "Hall", verdict: "inside", flagged: false });
    expect(await screen.findByText("Inside")).toBeTruthy();
    expect(await axe(document.body)).toHaveNoViolations();
  }, 30000);
});
