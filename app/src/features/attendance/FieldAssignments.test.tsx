// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { FieldMember } from "@mycity/contract/contract.gen.ts";
import { ModalProvider } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { useClock } from "./ClockButton";
import { MyAttendancePage } from "./EssAttendance";
import { Worksites } from "./Worksites";

/**
 * Field assignments made before PR 4 on the in-browser mock (docs/guides/attendance.md §6.12, §10):
 * the person sees theirs on My Attendance and the clock names its site; People take someone off and
 * cancel one on People · Worksites, Temporary, Field, each with a reason; nobody makes a new one.
 * The mock's assignments are invented: FA-0002,
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

  it("People take someone off with a reason, then cancel the assignment; never the last one taken off", async () => {
    await signedInAs("cynthia@mycityapp.io", <Worksites />);
    fireEvent.click(screen.getByRole("radio", { name: "Temporary" }));
    // FA-0002 is in force, so the views made before PR 4 sit beside the sites.
    fireEvent.click(await screen.findByRole("radio", { name: "Field" }, { timeout: 5000 }));
    fireEvent.click(await screen.findByText("FA-0002 · Stand Build"));
    let dialog = await screen.findByRole("dialog");
    // Each person on it has a Take Off of their own.
    fireEvent.click(within(within(dialog).getByText("Grace Okon").closest("tr")!).getByRole("button", { name: "Take Off" }));
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
    // The last person on it has no Take Off: Cancel Assignment ends it instead.
    await waitFor(() => expect(within(dialog).queryByRole("button", { name: "Take Off" })).toBeNull());
    pressIn(dialog, "Cancel Assignment");
    form = await screen.findByRole("dialog", { name: "Cancel Assignment" });
    fill(form, "Reason", "The client moved the event");
    pressIn(form, "Cancel Assignment");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fa = (await api.call("GET /api/v1/attendance/field-assignments", { query: { q: "FA-0002" } })).data[0];
    expect(fa).toMatchObject({ status: "cancelled", state: "cancelled", cancel_reason: "The client moved the event", can_change: false });
  }, 30000);
});
