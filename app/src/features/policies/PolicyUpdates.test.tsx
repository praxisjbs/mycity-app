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
import { PolicyUpdatesPage } from "./PolicyUpdates";

/**
 * ESS · Policy Updates on the in-browser mock (docs/guides/policies.md §10): what the reader owes
 * first, acknowledging from the list, a policy opened as its sentences with what changed, and an
 * approver's view of a version waiting on them. The mock's policies are invented: Chidera owes the
 * Attendance policy's Version 2 and Data Protection's Version 2; Ifeoma (CEO) has a change to Remote
 * and Hybrid Working waiting on her.
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
            <PolicyUpdatesPage />
          </Harness>
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>,
  );
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 10000 });
  await act(async () => {
    const next = await auth!.signIn(email, "demo1234");
    // The CEO's account asks for a code: any six digits but 000000 on the mock.
    if (next && next.kind === "code") await auth!.finishTwoStep(next.ticket, "482913");
  });
}

const rowOf = (title: string) => screen.getByText(title).closest<HTMLElement>("tr")!;

describe("Policy Updates", () => {
  it("lists what is owed first, and takes an acknowledgement from the list", async () => {
    await signedInAs("chidera@mycityapp.io");
    await screen.findByText("Data Protection", {}, { timeout: 5000 });
    expect(screen.getByText("Attendance Policy")).toBeTruthy();
    expect(await axe(document.body)).toHaveNoViolations();

    fireEvent.click(within(rowOf("Data Protection")).getByRole("button", { name: "Acknowledge" }));
    await waitFor(() => expect(screen.queryByText("Data Protection")).toBeNull(), { timeout: 5000 });
    expect(screen.getByText("Attendance Policy")).toBeTruthy();
  }, 30000);

  it("opens a rules policy as its sentences, with what the version changed tagged", async () => {
    await signedInAs("chidera@mycityapp.io");
    fireEvent.click(await screen.findByRole("radio", { name: "All Policies" }, { timeout: 5000 }));
    fireEvent.click(await screen.findByText("Attendance Policy", {}, { timeout: 5000 }));
    const dialog = await screen.findByRole("dialog", {}, { timeout: 5000 });
    expect(within(dialog).getByText("You have a grace period of 10 minutes after your resumption time. A clock-in after it counts as late.")).toBeTruthy();
    expect(within(dialog).getByText("Grace Minutes: 15 minutes to 10 minutes")).toBeTruthy();
    const clocking = within(dialog).getByRole("heading", { name: "Clocking In" }).closest<HTMLElement>("[data-card]")!;
    expect(within(clocking).getByText("Changed")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Acknowledge" })).toBeTruthy();
  }, 30000);

  it("shows an approver the version waiting on them, and refuses an approval with no signature", async () => {
    await signedInAs("ifeoma@mycityapp.io");
    fireEvent.click(await screen.findByRole("radio", { name: "Waiting On You" }, { timeout: 5000 }));
    fireEvent.click(await screen.findByText("Remote and Hybrid Working", {}, { timeout: 5000 }));
    const dialog = await screen.findByRole("dialog", {}, { timeout: 5000 });
    expect(within(dialog).getByText("Agree your home days with your line manager each month.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve Policy" }));
    const sign = await screen.findByRole("dialog", { name: "Approve Policy" }, { timeout: 5000 });
    fireEvent.click(within(sign).getByRole("button", { name: "Approve Policy" }));
    expect(await within(sign).findByText("Sign in the box", {}, { timeout: 5000 })).toBeTruthy();
  }, 30000);
});
