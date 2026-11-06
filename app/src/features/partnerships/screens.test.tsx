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
    expect(await screen.findByText("No Work Yet")).toBeTruthy();
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
