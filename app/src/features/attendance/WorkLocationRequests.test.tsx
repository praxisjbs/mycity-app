// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { formatDate, ModalProvider, todayIso } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { useClock } from "./ClockButton";
import { PeopleAttendance } from "./PeopleAttendance";
import { WorkLocationRequestsPage } from "./WorkLocationRequests";

/**
 * Work location requests on the in-browser mock (docs/guides/attendance.md §6.11, §10): the sheet
 * offers the types the person's work pattern allows, a temporary home takes its reading there
 * first, a request waiting can be withdrawn, and People decide the stage that waits on them, the
 * line manager first and then Operations & People. The mock's requests are invented: WLR-0002 is
 * Kemi's temporary home waiting on Operations & People, WLR-0003 Chidera's remote day waiting on
 * their line manager.
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

async function signedInAs(email: string, screenUnderTest: ReactNode) {
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
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 10000 });
  await act(async () => {
    await auth!.signIn(email, "demo1234");
  });
  await waitFor(() => expect(clock?.today).toBeTruthy(), { timeout: 5000 });
}

/** A day from today, as a person types it (day-first). */
const typed = (days: number) => {
  const d = new Date(`${todayIso()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d.toISOString().slice(0, 10));
};
const fill = (dialog: HTMLElement, label: string, value: string) => fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
const pressIn = (dialog: HTMLElement, name: string) => fireEvent.click(within(dialog).getByRole("button", { name }));

describe("work location requests", () => {
  it("a hybrid employee asks for a client visit, sees it wait on their line manager and withdraws it", async () => {
    await signedInAs("chidera@mycityapp.io", <WorkLocationRequestsPage />);
    await screen.findByText("WLR-0003 · Remote Day");
    fireEvent.click((await screen.findAllByRole("button", { name: "New Request" }))[0]);
    let dialog = await screen.findByRole("dialog");
    // A hybrid employee asks for a remote day or a client visit, never a temporary home.
    expect(within(dialog).getByRole("radio", { name: "Remote Day" })).toBeTruthy();
    expect(within(dialog).queryByRole("radio", { name: "Temporary Home" })).toBeNull();
    expect(await axe(dialog)).toHaveNoViolations();

    fireEvent.click(within(dialog).getByRole("radio", { name: "Client Visit" }));
    pressIn(dialog, "Send Request");
    await waitFor(() => expect(within(dialog).getByLabelText("First Day").getAttribute("aria-invalid")).toBe("true"));
    expect(within(dialog).getByLabelText("Address").getAttribute("aria-invalid")).toBe("true");

    fill(dialog, "First Day", typed(5));
    fill(dialog, "Last Day", typed(6));
    fill(dialog, "Address", "Client office, 9 Sample Close, Yaba");
    fill(dialog, "Reason", "Setting up the client's new meeting rooms");
    pressIn(dialog, "Send Request");
    const row = await screen.findByText("WLR-0006 · Client Visit");
    expect(getCurrentPosition).not.toHaveBeenCalled();

    fireEvent.click(row);
    dialog = await screen.findByRole("dialog");
    const route = await within(dialog).findByRole("list", { name: "Approval route" });
    expect(within(route).getByText("Line Manager").textContent).toBe("Line Manager, waiting here");
    pressIn(dialog, "Withdraw Request");
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Withdraw Request" }));
    await waitFor(async () => {
      const mine = await api.call("GET /api/v1/attendance/me/requests", { query: {} });
      expect(mine.data.find((r) => r.number === "WLR-0006")?.status).toBe("cancelled");
    });
  }, 30000);

  it("a remote employee's temporary home takes a reading there before it can be sent", async () => {
    await signedInAs("kemi@mycityapp.io", <WorkLocationRequestsPage />);
    await screen.findByText("WLR-0002 · Temporary Home");
    fireEvent.click((await screen.findAllByRole("button", { name: "New Request" }))[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("radio", { name: "Remote Day" })).toBeNull();
    await within(dialog).findByText("At That Home");
    expect(within(dialog).queryByRole("button", { name: "Send Request" })).toBeNull();

    pressIn(dialog, "Use This Location");
    act(() => answer!({ coords: { latitude: 6.4521, longitude: 3.3912, accuracy: 300 } }));
    await within(dialog).findByText("Weak Location Signal");
    expect(within(dialog).queryByRole("button", { name: "Send Request" })).toBeNull();
    pressIn(dialog, "Retry Location");
    act(() => answer!({ coords: { latitude: 6.4521, longitude: 3.3912, accuracy: 12 } }));
    await within(dialog).findByText("Location Found");

    fill(dialog, "First Day", typed(25));
    fill(dialog, "Last Day", typed(40));
    fill(dialog, "Address", "House 4, 7 Example Lane, Surulere");
    fill(dialog, "Reason", "Looking after a relative for two weeks");
    pressIn(dialog, "Send Request");
    await waitFor(() => expect(screen.getAllByText(/· Temporary Home$/)).toHaveLength(2));
    // The server has the reading taken there, not one typed in.
    const mine = await api.call("GET /api/v1/attendance/me/requests", { query: {} });
    expect(mine.data.find((r) => r.days === 16)).toMatchObject({ request_type: "temporary_home", status: "submitted", waiting_on: "Line Manager", home_latitude: 6.4521, home_longitude: 3.3912, accuracy_m: 12, days: 16 });
  }, 30000);

  it("People decide the stage waiting on them: the line manager first, then Operations & People", async () => {
    await signedInAs("cynthia@mycityapp.io", <PeopleAttendance />);
    fireEvent.click(screen.getByRole("radio", { name: "Requests" }));
    // Chidera's remote day waits on Cynthia as their line manager.
    fireEvent.click(await screen.findByText("WLR-0003 · Remote Day"));
    let dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Reject" }));
    pressIn(dialog, "Record Decision");
    await waitFor(() => expect(within(dialog).getByLabelText("Reason").getAttribute("aria-invalid")).toBe("true"));
    fireEvent.click(within(dialog).getByRole("radio", { name: "Approve" }));
    pressIn(dialog, "Record Decision");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Approved by the line manager, it now waits on Operations & People, which Cynthia also is.
    let flow = await api.call("GET /api/v1/attendance/requests", { query: { q: "WLR-0003" } });
    expect(flow.data[0]).toMatchObject({ status: "submitted", waiting_on: "Operations & People", can_decide: true });
    fireEvent.click(await screen.findByText("WLR-0003 · Remote Day"));
    dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/^Approved by/);
    pressIn(dialog, "Record Decision");
    await waitFor(() => expect(screen.queryByText("WLR-0003 · Remote Day")).toBeNull());
    flow = await api.call("GET /api/v1/attendance/requests", { query: { q: "WLR-0003" } });
    expect(flow.data[0]).toMatchObject({ status: "approved", waiting_on: null, can_decide: false });
  }, 30000);
});
