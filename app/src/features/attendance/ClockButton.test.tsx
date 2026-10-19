// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
 * Idempotency-Key and body, and what the panel shows after a punch is the server's answer.
 */

type Position = { coords: { latitude: number; longitude: number; accuracy: number } };
let answer: ((p: Position) => void) | null = null;
let refuse: ((e: { code: number }) => void) | null = null;
const getCurrentPosition = vi.fn((ok: (p: Position) => void, no: (e: { code: number }) => void) => {
  answer = ok;
  refuse = no;
});
let permission = "prompt";

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
  refuse = null;
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
  Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: async () => ({ state: permission }) } });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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

describe("the clock panel", () => {
  it("asks for the location only after Clock In is pressed, after saying what it is matched to", async () => {
    permission = "prompt";
    await signedInAs("chidera@mycityapp.io");
    act(() => clock!.open());
    await screen.findByText("Start Your Day");
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(await axe(document.body)).toHaveNoViolations();

    press("Clock In");
    await screen.findByText("Share Your Location");
    expect(screen.getByText(/matched to MyCity Office, Lekki/)).toBeTruthy();
    expect(getCurrentPosition).not.toHaveBeenCalled();

    press("Allow Location");
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    await screen.findByText("Finding Your Location");
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
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledTimes(1));
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
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledTimes(1));
    act(() => refuse!({ code: 1 }));
    await screen.findByText("Location Is Off");
    const call = vi.spyOn(api, "call");
    press("Clock In Anyway");
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
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledTimes(1));
    act(() => answer!({ coords: { latitude: 6.44705, longitude: 3.47201, accuracy: 12 } }));
    expect(screen.getByText("Processing")).toBeTruthy();
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
      act(() => answer!({ coords: { latitude: 6.4281, longitude: 3.4219, accuracy: 12 } }));
      expect(await screen.findByText(/People will review it: you have no office assigned yet/)).toBeTruthy();
    } finally {
      office.active = true;
    }
  }, 20000);
});
