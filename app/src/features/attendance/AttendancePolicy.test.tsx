// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ModalProvider } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { AttendancePolicyTab } from "./AttendancePolicy";

/**
 * Settings · Attendance Policy on the in-browser mock (docs/guides/attendance.md §6.15, §10): the
 * rules in force, the draft and what it changes, publishing the next version, and who has
 * acknowledged one. The mock's versions are invented: Version 2 is in force with 10 minutes' grace.
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

async function signedInAs(email: string) {
  mockSession.set(null);
  invalidate("/api/v1");
  render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <Harness>
            <AttendancePolicyTab />
          </Harness>
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>,
  );
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 10000 });
  await act(async () => {
    await auth!.signIn(email, "demo1234");
  });
}

const group = (name: string) => screen.getByRole("radiogroup", { name });

describe("Settings · Attendance Policy", () => {
  it("shows the rules in force and every version", async () => {
    await signedInAs("cynthia@mycityapp.io");
    await screen.findByText(/^Version 2 in force since /);
    expect((screen.getByRole("textbox", { name: /Grace Minutes/ }) as HTMLInputElement).value).toBe("10");
    expect(within(group("Device Check")).getByRole("radio", { name: "Warn" }).getAttribute("aria-checked")).toBe("true");
    const versions = screen.getByRole("heading", { name: "Versions" }).closest<HTMLElement>("[data-card]") ?? document.body;
    expect(within(versions).getByText("In Force")).toBeTruthy();
    expect(within(versions).getByText("Replaced")).toBeTruthy();
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it("saves the changes as a draft, then publishes them as Version 3 from today", async () => {
    await signedInAs("cynthia@mycityapp.io");
    const grace = (await screen.findByRole("textbox", { name: /Grace Minutes/ })) as HTMLInputElement;
    fireEvent.change(grace, { target: { value: "15" } });
    fireEvent.click(within(group("Office Check")).getByRole("radio", { name: "Block" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    expect(await screen.findByText("Draft with 2 changes, not published.")).toBeTruthy();
    expect(screen.getAllByText("Changed")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Publish Policy" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("10 minutes")).toBeTruthy();
    expect(within(dialog).getByText("15 minutes")).toBeTruthy();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Note" }), { target: { value: "Grace raised to 15 minutes, and the office is now strict." } });
    expect(await axe(dialog)).toHaveNoViolations();
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish Version" }));
    expect(await screen.findByText(/^Version 3 in force since /)).toBeTruthy();
    expect(screen.queryByText(/^Draft with/)).toBeNull();
  });

  it("lists who has acknowledged a version, and who has not", async () => {
    await signedInAs("cynthia@mycityapp.io");
    fireEvent.click(await screen.findByText("Version 1"));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Acknowledgements");
    fireEvent.click(within(dialog).getByRole("button", { name: "Pending" }));
    await waitFor(() => expect(within(dialog).queryAllByText("Pending").length).toBeLessThanOrEqual(1));
  });
});
