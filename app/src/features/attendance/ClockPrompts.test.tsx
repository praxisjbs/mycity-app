// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Button, ModalProvider, useModal } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { ClockPrompts, useClock } from "./ClockButton";

/**
 * The clock panel opening by itself (docs/guides/attendance.md §6.14) on the in-browser mock: at
 * the shift's start for someone not clocked in, at its end for someone still in, with Remind Me,
 * never dismissed by Esc and never over a dialog that is open. The clock is held on Monday 19
 * October 2026 (09:00 to 17:00 on the mock's week); only Date is faked, so timers run.
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

const lagos = (hhmm: string) => new Date(`2026-10-19T${hhmm}:00+01:00`);

beforeEach(() => {
  setViewport(1440);
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

let clock: ReturnType<typeof useClock> | null = null;
let auth: ReturnType<typeof useAuth> | null = null;
let modal: ReturnType<typeof useModal> | null = null;

function Signed() {
  clock = useClock();
  modal = useModal();
  return <ClockPrompts />;
}
function Harness() {
  auth = useAuth();
  return auth.status === "signed-in" ? <Signed /> : null;
}

async function signedInAs(email: string) {
  mockSession.set(null);
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
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 15000 });
  await act(async () => {
    await auth!.signIn(email, "demo1234");
  });
  await waitFor(() => expect(clock?.today).toBeTruthy(), { timeout: 5000 });
}

/** The app coming to the front, which makes the prompts look at the time again. */
const toFront = () => act(() => void document.dispatchEvent(new Event("visibilitychange")));

/** Clock in on the mock, now, and let the clock read it. */
async function clockIn() {
  await act(async () => {
    await api.call("POST /api/v1/attendance/punches", {
      body: { event_type: "clock_in", device_at: new Date().toISOString(), latitude: null, longitude: null, accuracy_m: null, location_error: "denied" },
      idempotencyKey: crypto.randomUUID(),
    });
    invalidate("/api/v1/attendance");
  });
  await waitFor(() => expect(clock!.today?.state).toBe("clocked_in"));
}

/** The sign-in prompt the first screen opens for anyone not clocked in: answered with Not Now. */
async function skipSignInPrompt() {
  await screen.findByText("Start Your Day", {}, { timeout: 5000 });
  fireEvent.click(screen.getByRole("button", { name: "Not Now" }));
  await waitFor(() => expect(screen.queryByText("Start Your Day")).toBeNull());
}

describe("the clock prompts", () => {
  it("open on the first screen of the day's first sign-in, over a blurred screen, once, and Esc does not dismiss it", async () => {
    vi.setSystemTime(lagos("08:30"));
    await signedInAs("cynthia@mycityapp.io");
    expect(await screen.findByText("Start Your Day", {}, { timeout: 5000 })).toBeTruthy();
    expect(document.querySelector("[data-blur]")?.className).toContain("backdrop-blur-md");
    expect(await axe(document.body)).toHaveNoViolations();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(screen.getByText("Start Your Day")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Not Now" }));
    await waitFor(() => expect(screen.queryByText("Start Your Day")).toBeNull());
    toFront();
    expect(screen.queryByText("Start Your Day")).toBeNull();

    // Shown before the start, it still opens at the start, once.
    vi.setSystemTime(lagos("09:05"));
    toFront();
    expect(await screen.findByText("Start Your Day", {}, { timeout: 5000 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Not Now" }));
    await waitFor(() => expect(screen.queryByText("Start Your Day")).toBeNull());
    toFront();
    expect(screen.queryByText("Start Your Day")).toBeNull();
  }, 20000);

  it("open it at the end for someone still in, with Remind Me, and again when the reminder is up", async () => {
    vi.setSystemTime(lagos("16:50"));
    await signedInAs("cynthia@mycityapp.io");
    await skipSignInPrompt();
    await clockIn();
    expect(screen.queryByText("Finish Your Day")).toBeNull();

    vi.setSystemTime(lagos("17:05"));
    invalidate("/api/v1/attendance");
    expect(await screen.findByText("Finish Your Day", {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clock Out" })).toBeTruthy();
    expect(document.querySelector("[data-blur]")).toBeTruthy();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Remind Me" }), { button: 0, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "In 30 Minutes" }));
    await waitFor(() => expect(screen.queryByText("Finish Your Day")).toBeNull());

    toFront();
    expect(screen.queryByText("Finish Your Day")).toBeNull();
    vi.setSystemTime(lagos("17:36"));
    invalidate("/api/v1/attendance");
    expect(await screen.findByText("Finish Your Day", {}, { timeout: 5000 })).toBeTruthy();
  }, 20000);

  it("wait for a dialog that is open instead of replacing it", async () => {
    vi.setSystemTime(lagos("16:50"));
    await signedInAs("chidera@mycityapp.io");
    await skipSignInPrompt();
    await clockIn();
    act(() => modal!.open({ title: "New Task", body: (close) => <Button onClick={close}>Done Here</Button> }));
    await screen.findByRole("dialog", { name: "New Task" });
    // A panel the person opens is not a prompt: nothing behind it is blurred.
    expect(document.querySelector("[data-blur]")).toBeNull();

    vi.setSystemTime(lagos("17:10"));
    invalidate("/api/v1/attendance");
    toFront();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(screen.getByRole("dialog", { name: "New Task" })).toBeTruthy();
    expect(screen.queryByText("Finish Your Day")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Done Here" }));
    expect(await screen.findByText("Finish Your Day", {}, { timeout: 5000 })).toBeTruthy();
  }, 20000);

  it("leave the sign-in prompt to the first session: someone already clocked in is not asked", async () => {
    vi.setSystemTime(lagos("10:15"));
    await signedInAs("ngozi@mycityapp.io");
    await skipSignInPrompt();
    await clockIn();
    cleanup();
    localStorage.clear();
    // Signing in again later that day, already clocked in: no prompt, whatever this device remembers.
    await signedInAs("ngozi@mycityapp.io");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  }, 20000);
});
