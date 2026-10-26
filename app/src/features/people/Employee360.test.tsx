// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ModalProvider } from "@mycity/ui";
import { installMatchMedia, setViewport } from "@mycity/ui/testing";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { byKey } from "@/api/mock/data/people";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { Employee360 } from "./Employee360";

/**
 * The employee record's Queries and Sanctions tabs on the in-browser mock (docs/guides/queries.md
 * §2, foundation.md §10.1): shown to a viewer holding `queries` view, each listing the person's own.
 * Chidera has QRY-0015 (open) and QRY-0011 (sanctioned, SAN-0001); Seyi has QRY-0012 only.
 */

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

async function signedInAs(email: string, screenUnderTest: ReactNode) {
  mockSession.set(null);
  invalidate("/api/v1");
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
}

describe("the record's Queries and Sanctions tabs", () => {
  it("People see the person's queries and sanctions, and no one else's", async () => {
    await signedInAs("cynthia@mycityapp.io", <Employee360 id={byKey("chidera")!.employee_id} />);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Queries" }));
    expect(await screen.findByText("QRY-0015")).toBeTruthy();
    expect(screen.getByText("QRY-0011")).toBeTruthy();
    expect(screen.queryByText("QRY-0012")).toBeNull();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Sanctions" }));
    expect(await screen.findByText("QRY-0011")).toBeTruthy();
    expect(screen.queryByText("QRY-0015")).toBeNull();
  }, 30000);
});
