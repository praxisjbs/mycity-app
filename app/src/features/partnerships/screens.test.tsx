// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ModalProvider } from "@mycity/ui";
import { installMatchMedia, setViewport } from "@mycity/ui/testing";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider, useRouter } from "@/lib/router";
import { ScreenActionProvider } from "@/shell/screen-action";
import Partnerships from "./index";

/**
 * Pipeline, Partners and Leads with both 360s on the in-browser mock (docs/guides/partnerships.md §10):
 * each screen draws from the contract's shapes, a row opens its record beside the list, a lead's
 * stage moves on its switcher, and a phone opens the record in a sheet (F31).
 */
installMatchMedia();
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

let auth: ReturnType<typeof useAuth> | null = null;
function Screen() {
  const { location } = useRouter();
  return location.module === "partnerships" ? <Partnerships tab={location.tab ?? "pipeline"} id={location.id} /> : null;
}
function Harness({ show }: { show: boolean }) {
  auth = useAuth();
  return show && auth.status === "signed-in" ? <Screen /> : null;
}
const app = (show: boolean) => (
  <RouterProvider>
    <AuthProvider>
      <ModalProvider>
        <ScreenActionProvider>
          <Harness show={show} />
        </ScreenActionProvider>
      </ModalProvider>
    </AuthProvider>
  </RouterProvider>
);

/** Signs in on the mock as Operations and opens a Partnerships address. */
async function open(at: string) {
  window.history.replaceState(null, "", at);
  mockSession.set(null);
  invalidate("/api/v1");
  const { rerender } = render(app(false));
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 15000 });
  await act(async () => {
    const next = await auth!.signIn("cynthia@mycityapp.io", "demo1234");
    if (next?.kind === "code") await auth!.finishTwoStep(next.ticket, "482913");
  });
  rerender(app(true));
}

beforeAll(() => setViewport(1440));
afterEach(() => {
  cleanup();
  setViewport(1440);
});

describe("Partnerships on the contract", () => {
  it("Pipeline: the KPI strip, the stages and the stalled deals with their blockers", async () => {
    await open("/partnerships?tab=pipeline");
    expect(await screen.findByRole("heading", { level: 1, name: "Pipeline" }, { timeout: 8000 })).toBeTruthy();
    expect((await screen.findAllByText("Open Deals", {}, { timeout: 8000 })).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Signed Value").length).toBeGreaterThan(0);
    expect(await screen.findByRole("heading", { name: "Stalled" }, { timeout: 8000 })).toBeTruthy();
  }, 30000);

  it("Leads: a row opens the Lead 360 beside the list, with its stage switcher and KPI cards", async () => {
    await open("/partnerships?tab=leads");
    expect(await screen.findByRole("heading", { level: 1, name: "Leads" }, { timeout: 8000 })).toBeTruthy();
    const switcher = await screen.findByRole("group", { name: /^Stage of / }, { timeout: 8000 });
    expect(within(switcher).getByRole("button", { name: /current stage$/ }).getAttribute("aria-current")).toBe("step");
    expect(screen.getByText("Days at Stage")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Deal" })).toBeTruthy();
  }, 30000);

  it("Partners: the Partner 360 with its eight tabs and four cards", async () => {
    await open("/partnerships?tab=partners");
    expect(await screen.findByRole("heading", { level: 1, name: "Partners" }, { timeout: 8000 })).toBeTruthy();
    expect(await screen.findByText("Active Deals", {}, { timeout: 8000 })).toBeTruthy();
    for (const t of ["Overview", "Deals", "Documents", "Returns", "Work", "Activity", "Contacts", "Details"]) expect(screen.getByRole("tab", { name: t })).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Work" }), { button: 0 });
    expect(await screen.findByText("No Tasks Yet")).toBeTruthy();
  }, 30000);

  it("Partners: the Work tab's New Task opens My Workspace's form already connected, and lists the task (§6.16)", async () => {
    await open("/partnerships?tab=partners");
    expect(await screen.findByText("Active Deals", {}, { timeout: 8000 })).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Work" }), { button: 0 });
    fireEvent.click(await screen.findByRole("button", { name: "New Task" }));
    const dialog = await screen.findByRole("dialog");
    // Connected already: Partner names the record, with Disconnect beside it.
    expect(within(dialog).getByText("Partner")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Disconnect" })).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Task"), { target: { value: "Print the festival banners" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Task" }));
    expect(await screen.findByText("Print the festival banners", {}, { timeout: 8000 })).toBeTruthy();
  }, 30000);

  it("Partners: the Returns tab, with the money, lists the months and opens Enter Returns", async () => {
    await open("/partnerships?tab=partners");
    expect(await screen.findByText("Active Deals", {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Export" }).length).toBeGreaterThan(0);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Returns" }), { button: 0 });
    expect(await screen.findByRole("heading", { name: "Months" }, { timeout: 8000 })).toBeTruthy();
    for (const k of ["Commission", "Gross Sales", "Units Sold", "Downloads"]) expect(screen.getAllByText(k).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Enter Returns" }));
    const dialog = await screen.findByRole("dialog", {}, { timeout: 8000 });
    for (const label of ["Month", "Units Sold", "Gross Sales", "MyCity Commission", "Paid to Partner", "Downloads", "Note"]) expect(within(dialog).getAllByText(label).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole("button", { name: "Save Returns" })).toBeTruthy();
  }, 30000);

  it("Partners: the desktop filters, the Owner column, and the 360's Activity naming each deal's history", async () => {
    await open("/partnerships?tab=partners");
    expect(await screen.findByRole("heading", { level: 1, name: "Partners" }, { timeout: 8000 })).toBeTruthy();
    for (const f of ["Stage", "Category", "Region", "Owner", "Health"]) expect(screen.getAllByText(f).length).toBeGreaterThan(0);
    expect(await screen.findByRole("columnheader", { name: "Owner" }, { timeout: 8000 })).toBeTruthy();
    expect(await screen.findByText("Days Since Last Contact", {}, { timeout: 8000 })).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Activity" }), { button: 0 });
    expect(await screen.findByRole("heading", { name: "Stage History" }, { timeout: 8000 })).toBeTruthy();
    expect(screen.getAllByText(/ · Moved to /).length).toBeGreaterThan(0);
  }, 30000);

  it("New Deal: Deal Options up to five, and the deal's terms behind Advanced for a holder of the money", async () => {
    await open("/partnerships?tab=partners");
    fireEvent.click(await screen.findByRole("button", { name: "New Deal" }, { timeout: 8000 }));
    const dialog = await screen.findByRole("dialog", {}, { timeout: 8000 });
    for (let i = 0; i < 5; i += 1) fireEvent.click(within(dialog).getByRole("button", { name: "Add Option" }));
    expect(within(dialog).getByText("Option 5")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Add Option" })).toBeNull();
    expect(within(dialog).getAllByText("MyCity's Commission").length).toBe(5);
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove Option 5" }));
    expect(within(dialog).getByRole("button", { name: "Add Option" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /Advanced/ }));
    for (const label of ["Impact Rating", "Commission %", "Validity", "Team"]) expect(await within(dialog).findByText(label)).toBeTruthy();
  }, 30000);

  it("on a phone nothing opens until a row is tapped, then the record opens in a sheet", async () => {
    setViewport(390);
    await open("/partnerships?tab=leads");
    await screen.findByRole("heading", { level: 1, name: "Leads" }, { timeout: 8000 });
    expect(screen.queryByRole("group", { name: /^Stage of / })).toBeNull();
    await waitFor(() => expect(document.querySelector("[data-row-open]")).toBeTruthy(), { timeout: 8000 });
    fireEvent.click(document.querySelector("[data-row-open]") as HTMLElement);
    const sheet = await screen.findByRole("dialog", {}, { timeout: 8000 });
    expect(await within(sheet).findByRole("group", { name: /^Stage of / }, { timeout: 8000 })).toBeTruthy();
  }, 30000);
});
