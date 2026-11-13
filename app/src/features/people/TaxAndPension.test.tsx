// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ModalProvider, Toaster } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import type { Employee360 } from "@/api/types/organisation";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { ScreenActionProvider } from "@/shell/screen-action";
import { TaxAndPension } from "./TaxAndPension";

/**
 * People · Employees, the record's Tax and Pension tab on the in-browser mock (docs/guides/payroll.md §13.1 items 41, 44
 * and 46): the numbers, the NHF choice and the State as Edit Record set them, and the rent declared by year with Declare
 * Rent, which asks for every part of the declaration the Guidelines name, the evidence among them. The rules are the
 * API's, tested in tests/integration/payroll-advanced.test.js.
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
Element.prototype.scrollIntoView ??= () => undefined;

beforeEach(() => setViewport(1440));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let auth: ReturnType<typeof useAuth> | null = null;
function Harness({ children }: { children: ReactNode }) {
  auth = useAuth();
  return auth.status === "signed-in" ? <>{children}</> : null;
}

/** Signs in as Operations & People and opens the tab of the first person on the register, with their numbers set. */
async function open() {
  mockSession.set(null);
  invalidate("/api/v1");
  const view = render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <ScreenActionProvider>
            <Harness>
              <span>Signed In</span>
            </Harness>
            <Toaster />
          </ScreenActionProvider>
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>,
  );
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 10000 });
  await act(async () => {
    await auth!.signIn("cynthia@mycityapp.io", "demo1234");
  });
  await screen.findByText("Signed In");
  const page = (await api.call("GET /api/v1/employees", { query: {} })) as { data: Array<{ employee_id: string }> };
  const id = page.data[0]!.employee_id;
  const record = (await api.call("PATCH /api/v1/employees/:id", {
    params: { id },
    body: { tax_id: "23456789-0001", nhf_contributes: true, state_of_residence: "lagos" },
  })) as Employee360;
  view.rerender(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <ScreenActionProvider>
            <Harness>
              <TaxAndPension employee={record} />
            </Harness>
            <Toaster />
          </ScreenActionProvider>
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>,
  );
  return record;
}

describe("People · Employees, Tax and Pension", () => {
  it("shows the numbers, the NHF choice and the State, and no rent until one is declared", async () => {
    await open();
    expect(await screen.findByText("23456789-0001")).toBeTruthy();
    expect(screen.getByText("Lagos")).toBeTruthy();
    expect(screen.getByText("Yes")).toBeTruthy();
    expect(await screen.findByText("No Rent Declared")).toBeTruthy();
    expect(await axe(document.body)).toHaveNoViolations();
  }, 40000);

  it("Declare Rent asks for every part of the declaration, the evidence among them", async () => {
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "Declare Rent" }));
    const form = await screen.findByRole("dialog", { name: "Declare Rent" });
    for (const label of ["Rent Paid", "Covers From", "Covers To", "Legal Tenant", "Landlord", "Landlord NIN", "Property Address"])
      expect(within(form).getAllByText(label).length).toBeGreaterThan(0);
    fireEvent.click(within(form).getByRole("button", { name: "Declare Rent" }));
    await waitFor(() => expect(within(form).getByText("Upload the evidence")).toBeTruthy());
    expect(within(form).getAllByText("Required").length).toBeGreaterThan(0);
    expect(await axe(document.body)).toHaveNoViolations();
  }, 40000);

  it("on a phone the two cards stack and keep their actions", async () => {
    setViewport(390);
    await open();
    expect(await screen.findByRole("button", { name: "Declare Rent" })).toBeTruthy();
    expect(await axe(document.body)).toHaveNoViolations();
  }, 40000);
});
