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
import { MyQueriesPage } from "./Queries";

/**
 * ESS · My Queries on the in-browser mock (docs/guides/queries.md §10): one tab with a Queries and
 * Sanctions switch. Chidera has an open query (QRY-0015, raised by Emeka) and a closed one that led
 * to a sanction (QRY-0011, SAN-0001).
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
            <MyQueriesPage />
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

describe("ESS · My Queries", () => {
  it("lists the person's queries, open first, with the newest open one beside the list", async () => {
    await signedInAs("chidera@mycityapp.io");
    const queries = await screen.findByRole("radio", { name: /Queries/ });
    expect(queries.getAttribute("aria-checked")).toBe("true");
    const rows = await screen.findAllByText(/QRY-00(15|11)/);
    expect(rows[0].textContent).toContain("QRY-0015");
    // Desktop: the first open query shows beside the list unasked, with Respond.
    expect(await screen.findByText("QRY-0015 · Missing clock-out on Thursday")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Respond" })).toBeTruthy();
    expect(await axe(document.body)).toHaveNoViolations();
  }, 30000);

  it("refuses an empty response on its field, before anything is sent", async () => {
    await signedInAs("chidera@mycityapp.io");
    fireEvent.click(await screen.findByRole("button", { name: "Respond" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Send Response" }));
    await waitFor(() => expect(within(dialog).getByText("Write your response")).toBeTruthy());
  }, 30000);

  it("Sanctions is read only: each row opens its letter", async () => {
    await signedInAs("chidera@mycityapp.io");
    fireEvent.click(await screen.findByRole("radio", { name: /Sanctions/ }));
    const row = await screen.findByText("QRY-0011");
    expect(screen.queryByRole("button", { name: "Respond" })).toBeNull();
    fireEvent.click(row);
    expect(await screen.findByRole("dialog", { name: /SAN-0001 · Letter/ })).toBeTruthy();
  }, 30000);
});
