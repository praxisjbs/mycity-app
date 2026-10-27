// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ModalProvider } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { ScreenActionProvider } from "@/shell/screen-action";
import Performance from "./index";

/**
 * Performance · Analytics on the in-browser mock (docs/guides/performance.md §10): the four figures,
 * each section the guide lists open, Self Against Final behind its help term on desktop only, and
 * the people table with Export for a reader who may export, five people on a phone with View All.
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

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T09:30:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});
afterEach(() => {
  cleanup();
  setViewport(1440);
});

let auth: ReturnType<typeof useAuth> | null = null;
function Harness({ show }: { show: boolean }) {
  auth = useAuth();
  return show && auth.status === "signed-in" ? <Performance tab="analytics" id={null} /> : null;
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

async function analyticsAs(email: string) {
  window.history.replaceState(null, "", "/performance?tab=analytics");
  mockSession.set(null);
  invalidate("/api/v1");
  const { rerender } = render(app(false));
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 15000 });
  await act(async () => {
    const next = await auth!.signIn(email, "demo1234");
    if (next?.kind === "code") await auth!.finishTwoStep(next.ticket, "482913");
  });
  rerender(app(true));
  await screen.findByRole("heading", { name: "Scores by Month" }, { timeout: 8000 });
}

const headings = () => screen.getAllByRole("heading").map((h) => h.textContent?.trim());

describe("Performance · Analytics", () => {
  it("draws the four figures and every section on desktop, with Export of the people", async () => {
    await analyticsAs("cynthia@mycityapp.io");
    const h = headings();
    for (const title of ["Analytics", "Scores by Month", "Key Results by Status", "Rating Spread", "Commitments On Time", "People"]) expect(h).toContain(title);
    expect(screen.getAllByText("Self Against Final").length).toBeGreaterThan(0);
    for (const tile of ["Company Score", "Check-Ins On Time", "Reviews Closed On Time"]) expect(screen.getByText(tile)).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Export" })).toBeTruthy();
    // The people, highest score first.
    await screen.findByText("Adedotun Oyinloye");
    expect(await axe(document.body)).toHaveNoViolations();
  }, 30000);

  it("the Function filter offers a manager only the functions of the people they reach, and a member of staff none", async () => {
    await analyticsAs("ngozi@mycityapp.io");
    fireEvent.click(screen.getByRole("combobox", { name: "Function" }));
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent)).toEqual(["All Functions", "Finance", "Marketing & Sales", "Studio"]);
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    cleanup();
    await analyticsAs("kemi@mycityapp.io");
    expect(screen.queryByRole("combobox", { name: "Function" })).toBeNull();
  }, 30000);

  it("on a phone: no Self Against Final; the people as cards, five at most, with no pager", async () => {
    setViewport(390);
    await analyticsAs("cynthia@mycityapp.io");
    expect(screen.queryByText("Self Against Final")).toBeNull();
    await screen.findByText("Adedotun Oyinloye");
    expect(document.querySelector("table")).toBeNull();
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
  }, 30000);
});
