// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { FieldMember } from "@mycity/contract/contract.gen.ts";
import { formatDate, ModalProvider, todayIso } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { useClock } from "./ClockButton";
import { MyAttendancePage } from "./EssAttendance";
import { PeopleAttendance } from "./PeopleAttendance";

/**
 * Field assignments on the in-browser mock (docs/guides/attendance.md §6.12, §10): the person sees
 * theirs on My Attendance and the clock names its site; People set one (checked as it is filled),
 * take someone off and cancel it, each with a reason. The mock's assignments are invented: FA-0002,
 * Stand Build, is in progress today for Adedotun and Grace at Expo Hall.
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

const typed = (days: number) => {
  const d = new Date(`${todayIso()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d.toISOString().slice(0, 10));
};
const fill = (dialog: HTMLElement, label: string, value: string) => fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
const pressIn = (dialog: HTMLElement, name: string) => fireEvent.click(within(dialog).getByRole("button", { name }));

describe("field assignments", () => {
  it("the person sees theirs on My Attendance, and the clock is matched to its site", async () => {
    await signedInAs("adedotun@mycityapp.io", <MyAttendancePage />);
    expect(clock!.today!.location).toMatchObject({ kind: "field", name: "Expo Hall", radius_m: 300 });
    fireEvent.click(await screen.findByText("FA-0002 · Stand Build"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Example Expo")).toBeTruthy();
    expect(within(dialog).getByText("9 Example Road, Victoria Island")).toBeTruthy();
    expect(within(dialog).getByText("Grace Okon")).toBeTruthy();
    // Their own: nothing to change.
    expect(within(dialog).queryByRole("button", { name: "Cancel Assignment" })).toBeNull();
    expect(await axe(dialog)).toHaveNoViolations();
  }, 30000);

  it("People set one, checked as it is filled; each person is put on it", async () => {
    await signedInAs("cynthia@mycityapp.io", <PeopleAttendance />);
    fireEvent.click(screen.getByRole("radio", { name: "Field" }));
    await screen.findByText("FA-0003 · Partner Visits");
    fireEvent.click(screen.getAllByRole("button", { name: "New Assignment" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New Assignment" });
    pressIn(dialog, "Save Assignment");
    await waitFor(() => expect(within(dialog).getByLabelText("Name").getAttribute("aria-invalid")).toBe("true"));
    expect(within(dialog).getByLabelText("Latitude").getAttribute("aria-invalid")).toBe("true");

    fill(dialog, "Name", "Venue Setup");
    fill(dialog, "Client or Event", "Northwind Events");
    fireEvent.change(within(dialog).getByPlaceholderText("Search people"), { target: { value: "Bashir" } });
    await waitFor(() => expect(within(dialog).getAllByRole("option").length).toBeGreaterThan(0), { timeout: 5000 });
    fireEvent.click(within(dialog).getByRole("option", { name: /Bashir Lawal/ }));
    fill(dialog, "First Day", typed(5));
    fill(dialog, "Last Day", typed(5));
    fill(dialog, "Site Name", "Hall B");
    fill(dialog, "Latitude", "6.5");
    fill(dialog, "Longitude", "3.4");
    pressIn(dialog, "Save Assignment");
    // Bashir is already on FA-0003 that day: the server marks the first day.
    await waitFor(() => expect(within(dialog).getByText("Overlaps another")).toBeTruthy());

    fill(dialog, "First Day", typed(8));
    fill(dialog, "Last Day", typed(9));
    pressIn(dialog, "Save Assignment");
    await screen.findByText("FA-0004 · Venue Setup");
    const page = await api.call("GET /api/v1/attendance/field-assignments", { query: { q: "FA-0004" } });
    expect(page.data[0]).toMatchObject({ state: "upcoming", people: 1, days: 2, can_change: true, sites: [{ name: "Hall B", latitude: 6.5, longitude: 3.4, radius_m: 200 }] });
  }, 30000);

  it("People take someone off with a reason, then cancel the assignment; never the last one taken off", async () => {
    await signedInAs("cynthia@mycityapp.io", <PeopleAttendance />);
    fireEvent.click(screen.getByRole("radio", { name: "Field" }));
    fireEvent.click(await screen.findByText("FA-0002 · Stand Build"));
    let dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByText("Grace Okon"));
    let form = await screen.findByRole("dialog", { name: "Take Off Grace Okon" });
    fill(form, "Reason", "short");
    pressIn(form, "Take Off");
    await waitFor(() => expect(within(form).getByLabelText("Reason").getAttribute("aria-invalid")).toBe("true"));
    fill(form, "Reason", "Needed at the office that day");
    pressIn(form, "Take Off");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    let fa = (await api.call("GET /api/v1/attendance/field-assignments", { query: { q: "FA-0002" } })).data[0];
    expect(fa).toMatchObject({ people: 1, status: "active" });
    expect(fa.members.find((m: FieldMember) => m.employee.display_name === "Grace Okon")).toMatchObject({ removed_reason: "Needed at the office that day" });

    fireEvent.click(await screen.findByText("FA-0002 · Stand Build"));
    dialog = await screen.findByRole("dialog");
    pressIn(dialog, "Cancel Assignment");
    form = await screen.findByRole("dialog", { name: "Cancel Assignment" });
    fill(form, "Reason", "The client moved the event");
    pressIn(form, "Cancel Assignment");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fa = (await api.call("GET /api/v1/attendance/field-assignments", { query: { q: "FA-0002" } })).data[0];
    expect(fa).toMatchObject({ status: "cancelled", state: "cancelled", cancel_reason: "The client moved the event", can_change: false });
  }, 30000);
});
