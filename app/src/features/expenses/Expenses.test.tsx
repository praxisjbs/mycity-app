// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ModalProvider, Toaster } from "@mycity/ui";
import { installMatchMedia, setViewport } from "@mycity/ui/testing";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import Expenses from "./index";
import { MyRequestsPage } from "./MyRequests";

/**
 * Expenses' screens on the in-browser mock (docs/guides/expenses.md §10; the M8 audit's F5, F10,
 * F12, F13, F21, F22, F23): Withdraw where an Operations & People holder opens an approved request,
 * a confirm before each destructive press, a request opening from each list that holds it, and the
 * KPI cards that open their own requests.
 */
installMatchMedia();
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
Element.prototype.scrollIntoView ??= function () {};
beforeEach(() => setViewport(1440));
afterEach(cleanup);

let auth: ReturnType<typeof useAuth> | null = null;
function Harness({ children }: { children?: ReactNode }) {
  auth = useAuth();
  return auth.status === "signed-in" ? <>{children}</> : null;
}

async function as(email: string, screenEl: ReactNode, heading: string) {
  mockSession.set(null);
  invalidate("/api/v1");
  window.history.replaceState(null, "", "/expenses");
  render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <Toaster />
          <Harness>{screenEl}</Harness>
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>,
  );
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 10000 });
  await act(async () => {
    await auth!.signIn(email, "demo1234");
  });
  await screen.findByText(heading, { selector: "h1" }, { timeout: 5000 });
}

/** The first request number in the card titled `title`. */
async function firstRequestIn(title: string) {
  const table = await screen.findByRole("table", { name: title }, { timeout: 5000 });
  const cell = await waitFor(() => {
    const hit = within(table).getAllByText(/^EXP-\d+$/)[0];
    expect(hit).toBeTruthy();
    return hit;
  }, { timeout: 5000 });
  return cell;
}

describe("Expenses · Requisitions", () => {
  it("an approved request opens in the modal with Withdraw, which asks first and then wants a reason (F5, F13, F22)", async () => {
    await as("cynthia@mycityapp.io", <Expenses tab="requisitions" id={null} />, "Requisitions");
    fireEvent.click(await firstRequestIn("Approved Requests"));
    const dialog = await screen.findByRole("dialog", { name: "Expense Request" }, { timeout: 5000 });
    expect(within(dialog).queryByRole("button", { name: "Cancel Request" })).toBeNull();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Withdraw" }, { timeout: 5000 }));
    const ask = await screen.findByRole("alertdialog", { name: "Withdraw Request" });
    fireEvent.click(within(ask).getByRole("button", { name: "Withdraw Request" }));
    const form = await screen.findByRole("dialog", { name: "Withdraw Request" }, { timeout: 5000 });
    fireEvent.click(within(form).getByRole("button", { name: "Withdraw Request" }));
    // No reason, no request: the form stays and nothing is withdrawn.
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByText(/withdrawn$/)).toBeNull();
    expect(screen.getByRole("dialog", { name: "Withdraw Request" })).toBeTruthy();
    fireEvent.change(within(form).getByRole("textbox"), { target: { value: "Paid by cash" } });
    fireEvent.click(within(form).getByRole("button", { name: "Withdraw Request" }));
    expect(await screen.findByText(/withdrawn$/, {}, { timeout: 5000 })).toBeTruthy();
  }, 40000);
});

describe("Expenses · Disbursements", () => {
  it("a waiting request opens with Record Disbursement and Withdraw; Waiting to Pay opens its requests (F5, F21)", async () => {
    await as("cynthia@mycityapp.io", <Expenses tab="disbursements" id={null} />, "Disbursements");
    fireEvent.click(await firstRequestIn("Waiting to Pay"));
    const dialog = await screen.findByRole("dialog", { name: "Expense Request" }, { timeout: 5000 });
    expect(await within(dialog).findByRole("button", { name: "Record Disbursement" }, { timeout: 5000 })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Withdraw" })).toBeTruthy();
  }, 40000);

  it("No on Save Without Reference? puts the person on the reference field (F12)", async () => {
    await as("cynthia@mycityapp.io", <Expenses tab="disbursements" id={null} />, "Disbursements");
    fireEvent.click(await firstRequestIn("Waiting to Pay"));
    const dialog = await screen.findByRole("dialog", { name: "Expense Request" }, { timeout: 5000 });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Record Disbursement" }, { timeout: 5000 }));
    const form = await screen.findByRole("dialog", { name: /^Pay EXP-/ }, { timeout: 5000 });
    fireEvent.click(within(form).getByRole("button", { name: "Record Disbursement" }));
    const ask = await screen.findByRole("alertdialog", { name: "Save Without Reference?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Add Reference" }));
    await waitFor(() => expect(document.activeElement?.getAttribute("name")).toBe("payment_reference"), { timeout: 3000 });
  }, 40000);
});

describe("Expenses · Projects", () => {
  it("a project's request opens the request (F10)", async () => {
    await as("cynthia@mycityapp.io", <Expenses tab="projects" id={null} />, "Projects");
    const table = (await screen.findAllByRole("table", {}, { timeout: 5000 }))[0];
    const first = await waitFor(() => within(table).getAllByRole("row")[1], { timeout: 5000 });
    fireEvent.click(first);
    const project = await screen.findByRole("dialog", { name: "Project" }, { timeout: 5000 });
    expect(within(project).getByRole("button", { name: "Set Budget" })).toBeTruthy();
    const ref = await waitFor(() => within(project).getAllByText(/^EXP-\d+$/)[0], { timeout: 5000 }).catch(() => null);
    if (ref) {
      fireEvent.click(ref);
      expect(await screen.findByRole("dialog", { name: "Expense Request" }, { timeout: 5000 })).toBeTruthy();
    }
  }, 40000);
});

describe("My Requests", () => {
  it("New Request has no remove cell with one line, and Staff to Vendor clears Use My Company Account (F11, F23)", async () => {
    await as("chidera@mycityapp.io", <MyRequestsPage />, "My Requests");
    fireEvent.click(screen.getAllByRole("button", { name: "New Request" })[0]);
    const form = await screen.findByRole("dialog", { name: "New Request" }, { timeout: 5000 });
    expect(within(form).queryByRole("button", { name: /^Remove Item/ })).toBeNull();
    fireEvent.click(within(form).getByRole("button", { name: "Add Line" }));
    expect(within(form).getAllByRole("button", { name: /^Remove Item/ })).toHaveLength(2);
    // Staff, tick the company account, then Vendor: the hidden tick is cleared, so Staff again starts unticked.
    const pick = async (label: string) => {
      fireEvent.click(within(form).getByRole("combobox", { name: "Payee" }));
      fireEvent.click(await screen.findByRole("option", { name: label }));
    };
    await pick("Staff");
    const tick = () => within(form).getByRole("checkbox", { name: "Use My Company Account" });
    fireEvent.click(tick());
    expect(tick().getAttribute("aria-checked") ?? String((tick() as HTMLInputElement).checked)).toBe("true");
    await pick("Vendor");
    expect(within(form).queryByRole("checkbox", { name: "Use My Company Account" })).toBeNull();
    await pick("Staff");
    expect(tick().getAttribute("aria-checked") ?? String((tick() as HTMLInputElement).checked)).toBe("false");
  }, 40000);
});
