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
import { PoliciesTab } from "./PoliciesHub";

/**
 * Knowledge Hub · Policies on the in-browser mock (docs/guides/policies.md §10; attendance.md §6.15):
 * the list, the Attendance worksheet with what a draft changes, the rules a new version may not set,
 * and the publish sheet's signature. The mock's policies are invented: the Attendance policy's
 * Version 2 is in force with 10 minutes' grace; Dress Code is a draft.
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
  window.history.replaceState(null, "", "/knowledge?tab=policies");
});
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
            <PoliciesTab />
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

const cardOf = (title: string) => screen.getByRole("heading", { name: title }).closest<HTMLElement>("[data-card]")!;

describe("Knowledge Hub · Policies", () => {
  it("lists every policy with its state and acknowledgements", async () => {
    await signedInAs("cynthia@mycityapp.io");
    await screen.findByText("Remote and Hybrid Working", {}, { timeout: 5000 });
    expect(screen.getByText("Attendance Policy")).toBeTruthy();
    expect(screen.getByText("Dress Code")).toBeTruthy();
    expect(screen.getAllByText("Awaiting Approval").length).toBeGreaterThan(0);
    expect(await axe(document.body)).toHaveNoViolations();
  }, 30000);

  it("opens the Attendance worksheet, tags a changed rule and saves it as a draft", async () => {
    await signedInAs("cynthia@mycityapp.io");
    fireEvent.click(await screen.findByText("Attendance Policy", {}, { timeout: 5000 }));
    const lateness = await waitFor(() => cardOf("Lateness"), { timeout: 5000 });
    const grace = within(lateness).getByRole("textbox", { name: /Grace Minutes/ });
    expect((grace as HTMLInputElement).value).toBe("10");
    expect(within(lateness).queryByText("Changed")).toBeNull();
    fireEvent.change(grace, { target: { value: "12" } });
    expect(await within(lateness).findByText("Changed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    expect(await screen.findByText("Draft with 1 change, not published.", {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish Policy" })).toBeTruthy();
  }, 30000);

  it("Home Location starts off with its checks hidden; switched on, a home radius under 150 m is refused on the field", async () => {
    await signedInAs("cynthia@mycityapp.io");
    fireEvent.click(await screen.findByText("Attendance Policy", {}, { timeout: 5000 }));
    const checks = await waitFor(() => cardOf("Location Checks"), { timeout: 5000 });
    expect(within(checks).queryByRole("textbox", { name: /Home Radius/ })).toBeNull();
    expect(within(checks).queryByText("Home Check")).toBeNull();
    fireEvent.click(within(checks).getByRole("checkbox", { name: "On" }));
    expect(await within(checks).findByText("Changed")).toBeTruthy();
    expect(within(checks).getByText("Home Check")).toBeTruthy();
    fireEvent.change(within(checks).getByRole("textbox", { name: /Home Radius/ }), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    expect(await within(checks).findByText("At least 150", {}, { timeout: 5000 })).toBeTruthy();
  }, 30000);

  it("publishes only with a signature", async () => {
    await signedInAs("cynthia@mycityapp.io");
    fireEvent.click(await screen.findByText("Dress Code", {}, { timeout: 5000 }));
    fireEvent.click(await screen.findByRole("button", { name: "Publish Policy" }, { timeout: 5000 }));
    const sheet = await screen.findByRole("dialog", { name: "Publish Policy" }, { timeout: 5000 });
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Note" }), { target: { value: "First written dress code." } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Publish Policy" }));
    expect(await within(sheet).findByText("Sign in the box", {}, { timeout: 5000 })).toBeTruthy();
  }, 30000);
});
