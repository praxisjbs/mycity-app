// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ModalProvider, Toaster } from "@mycity/ui";
import { installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api, ApiError } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { ScreenActionProvider } from "@/shell/screen-action";
import Mailbox from "./index";

/**
 * A mailbox press the server refuses says so (docs/guides/mailbox.md §10.1): Refresh and Empty
 * Trash on the in-browser mock, with the one call refused, toast why, and Empty Trash can be
 * pressed again rather than spinning for good.
 */

installMatchMedia();
for (const name of ["ResizeObserver", "IntersectionObserver"] as const) {
  if (!(name in window)) {
    (window as unknown as Record<string, unknown>)[name] = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
}

beforeEach(() => setViewport(1440));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let auth: ReturnType<typeof useAuth> | null = null;

async function signedIn(tab: string) {
  window.history.replaceState(null, "", `/mailbox?tab=${tab}`);
  mockSession.set(null);
  invalidate("/api/v1");
  function Gate() {
    auth = useAuth();
    return auth.status === "signed-in" ? <Mailbox tab={tab} id={null} /> : null;
  }
  render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <ScreenActionProvider>
            <Gate />
            <Toaster />
          </ScreenActionProvider>
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>,
  );
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 10000 });
  await act(async () => {
    const next = await auth!.signIn("kemi@mycityapp.io", "demo1234");
    if (next?.kind === "code") await auth!.finishTwoStep(next.ticket, "482913");
  });
}

/** Refuses one endpoint, as the server would, and lets every other call through to the mock. */
function refuse(endpoint: string, message: string) {
  const real = api.call.bind(api);
  return vi.spyOn(api, "call").mockImplementation(((path: string, ...rest: unknown[]) =>
    path === endpoint
      ? Promise.reject(new ApiError(503, { error: { code: "MAIL_UNAVAILABLE", message } }))
      : (real as (p: string, ...r: unknown[]) => Promise<unknown>)(path, ...rest)) as typeof api.call);
}

describe("a mailbox press the server refuses", () => {
  it("Refresh says why it did not refresh", async () => {
    await signedIn("inbox");
    refuse("POST /api/v1/mailbox/connection/sync", "Mail server not reached");
    fireEvent.click(await screen.findByRole("button", { name: "Refresh" }, { timeout: 10000 }));
    expect(await screen.findByText("Mail server not reached", {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByText("Mailbox up to date")).toBeNull();
  });

  it("Empty Trash says why, and can be pressed again", async () => {
    await signedIn("trash");
    const call = refuse("POST /api/v1/mailbox/folders/:kind/empty", "Mail server not reached");
    fireEvent.click(await screen.findByRole("button", { name: "Empty Trash" }, { timeout: 10000 }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Empty Trash" }));
    expect(await screen.findByText("Mail server not reached", {}, { timeout: 5000 })).toBeTruthy();
    // The dialog stays open with its button ready for another press, not spinning.
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Empty Trash" }).getAttribute("data-press")).toBeNull());
    fireEvent.click(within(dialog).getByRole("button", { name: "Empty Trash" }));
    await waitFor(() => expect(call.mock.calls.filter(([p]) => p === "POST /api/v1/mailbox/folders/:kind/empty")).toHaveLength(2));
  });
});
