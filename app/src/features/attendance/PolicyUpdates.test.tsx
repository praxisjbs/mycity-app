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
 * ESS · Policy Updates on the in-browser mock (docs/guides/attendance.md §6.15, §10): the newest
 * version in sentences with what it changed, Acknowledge, and an earlier version. The mock's
 * versions are invented: Version 1 gave 15 minutes' grace, Version 2 (in force) gives 10 and
 * reviews unregistered devices; Chidera has not acknowledged it.
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
    await auth!.signIn(email, "demo1234");
  });
}

/** A section's card, by its title. */
const card = (title: string) => screen.getByRole("heading", { name: title }).closest<HTMLElement>("[data-card]")!;

describe("Policy Updates", () => {
  it("shows the newest version in sentences, tags what changed, and takes one acknowledgement", async () => {
    await signedInAs("chidera@mycityapp.io");
    await screen.findByText(/Grace is now 10 minutes/, {}, { timeout: 5000 });
    expect(screen.getByText("You have a grace period of 10 minutes after your resumption time. A clock-in after it counts as late.")).toBeTruthy();
    expect(screen.getByText("A clock-in from a device not registered on My Devices is accepted and sent for review.")).toBeTruthy();
    expect(within(card("Clocking In")).getByText("Changed")).toBeTruthy();
    expect(within(card("Your Devices")).getByText("Changed")).toBeTruthy();
    expect(within(card("At the Office")).queryByText("Changed")).toBeNull();
    expect(await axe(document.body)).toHaveNoViolations();

    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(await screen.findByText(/^Acknowledged \d{2}\/\d{2}\/\d{4}$/, {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Acknowledge" })).toBeNull();
  }, 30000);

  it("opens an earlier version with its own sentences", async () => {
    await signedInAs("chidera@mycityapp.io");
    fireEvent.click(await screen.findByText("Version 1", {}, { timeout: 5000 }));
    const dialog = await screen.findByRole("dialog", {}, { timeout: 5000 });
    expect(within(dialog).getByText("You have a grace period of 15 minutes after your resumption time. A clock-in after it counts as late.")).toBeTruthy();
    expect(within(dialog).getByText("You can clock in from any device. Each device you use is recorded.")).toBeTruthy();
    expect(within(dialog).getByText("Replaced")).toBeTruthy();
  }, 30000);

  it("on a phone, the version comes first with Acknowledge, and the versions are cards", async () => {
    setViewport(390);
    await signedInAs("ngozi@mycityapp.io");
    await screen.findByRole("button", { name: "Acknowledge" }, { timeout: 5000 });
    expect(document.querySelector("table")).toBeNull();
  }, 30000);
});
