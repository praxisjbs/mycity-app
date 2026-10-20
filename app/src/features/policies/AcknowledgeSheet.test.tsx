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
import * as prompts from "@/features/attendance/prompts";
import { AcknowledgePrompts } from "./AcknowledgeSheet";

/**
 * The acknowledge sheet on the in-browser mock (docs/guides/policies.md §6.7): once the clock has
 * been answered it shows each version the person owes, one at a time, and Later or Acknowledge
 * moves to the next. Chidera owes the Attendance policy's Version 2 and Data Protection's Version 2.
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

beforeEach(() => setViewport(390));
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
            <AcknowledgePrompts />
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

describe("the acknowledge sheet", () => {
  it("shows what is owed one at a time, oldest due first, once the clock is answered", async () => {
    // The day's first clock prompt has been asked for, so nothing is left to wait for.
    vi.spyOn(prompts, "signInAsked").mockReturnValue(true);
    await signedInAs("chidera@mycityapp.io");
    const first = await screen.findByRole("dialog", { name: "Policy Update" }, { timeout: 5000 });
    expect(within(first).getByRole("button", { name: "Acknowledge" })).toBeTruthy();
    expect(within(first).getByRole("button", { name: "Read Full Policy" })).toBeTruthy();
    expect(await axe(document.body)).toHaveNoViolations();

    // The oldest due first: the Attendance policy's version is past its due date, so Later is gone.
    expect(within(first).getByRole("heading", { level: 3 }).textContent).toBe("Attendance Policy");
    expect(within(first).getByText(/^Overdue since \d{2}\/\d{2}\/\d{4}$/)).toBeTruthy();
    expect(within(first).queryByRole("button", { name: "Later" })).toBeNull();
    fireEvent.click(within(first).getByRole("button", { name: "Acknowledge" }));

    // Then Data Protection, still before its due date: Later puts it off until tomorrow.
    await waitFor(() => expect(within(screen.getByRole("dialog", { name: "Policy Update" })).getByRole("heading", { level: 3 }).textContent).toBe("Data Protection"), { timeout: 5000 });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Policy Update" })).getByRole("button", { name: "Later" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: 5000 });
  }, 30000);
});
