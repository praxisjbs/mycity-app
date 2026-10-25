// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { ModalProvider } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { invalidate } from "@/api/hooks";
import { dispatch, mockSession } from "@/api/mock/core";
import type { Me } from "@/api/types/identity";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider, useRouter } from "@/lib/router";
import { ScreenActionProvider } from "@/shell/screen-action";
import { mayUseTab, TAB_CAPABILITIES } from "./access";
import Home from "./index";

/**
 * Home's gated tabs (docs/guides/home.md §8, §10.1, §11): Team, Alerts and Reports stay in
 * place for every Home viewer, and a reader without the tab's capability finds the lock there
 * instead of an empty screen or an error, and the tab reads nothing. Every request the screen
 * makes passes through the mock's dispatch, which is watched here.
 */

vi.mock("@/api/mock/core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@/api/mock/core")>();
  return { ...core, dispatch: vi.fn(core.dispatch) };
});

expect.extend(axeMatchers);
installMatchMedia();
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

afterEach(() => {
  cleanup();
  setViewport(1440);
});

let auth: ReturnType<typeof useAuth> | null = null;
function Screen() {
  const { location } = useRouter();
  return location.module === "home" ? <Home tab={location.tab ?? "overview"} id={location.id} /> : null;
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

/** Signs in on the mock, opens the tab, and gives back the Home reads it made. */
async function open(email: string, tab: string) {
  window.history.replaceState(null, "", `/home?tab=${tab}`);
  mockSession.set(null);
  invalidate("/api/v1");
  const { rerender } = render(app(false));
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 15000 });
  await act(async () => {
    const next = await auth!.signIn(email, "demo1234");
    if (next?.kind === "code") await auth!.finishTwoStep(next.ticket, "482913");
  });
  vi.mocked(dispatch).mockClear();
  rerender(app(true));
  await screen.findByRole("heading", { level: 1 }, { timeout: 8000 });
  // Long enough for any read the tab would make to have been sent.
  await act(() => new Promise((r) => setTimeout(r, 400)));
  return vi.mocked(dispatch).mock.calls.map(([req]) => req.path).filter((path) => path.startsWith("/api/v1/home"));
}

const TABS = [
  ["team", "Team"],
  ["alerts", "Alerts"],
  ["reports", "Reports"],
] as const;

describe("a tab whose capability the reader lacks", () => {
  it.each(TABS)("%s shows a member of staff its title and the lock, and reads nothing", async (tab, title) => {
    const reads = await open("chidera@mycityapp.io", tab);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(title);
    expect(screen.getByRole("heading", { name: "For Managers" })).toBeTruthy();
    expect(screen.getByText("This tab is for managers and the CEO.")).toBeTruthy();
    expect(document.querySelector('[data-ui="page-subtitle"]')).toBeNull();
    expect(reads).toEqual([]);
    expect(await axe(document.body)).toHaveNoViolations();
  }, 30000);

  it("shows the same lock on a phone, with nothing else on it", async () => {
    setViewport(390);
    await open("chidera@mycityapp.io", "team");
    expect(screen.getByRole("heading", { name: "For Managers" })).toBeTruthy();
    expect(screen.queryAllByRole("button")).toEqual([]);
  }, 30000);
});

describe("a tab whose capability the reader holds", () => {
  it.each([
    ["team", "Team Roster", "/api/v1/home/team"],
    ["alerts", "Open Alerts", "/api/v1/home/alerts"],
    ["reports", "Recent Runs", "/api/v1/home/report-runs"],
  ])("%s opens for Operations, reading its own list", async (tab, list, path) => {
    const reads = await open("cynthia@mycityapp.io", tab);
    expect(await screen.findByRole("heading", { name: list }, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "For Managers" })).toBeNull();
    expect(reads).toContain(path);
  }, 30000);
});

describe("which capability opens which tab", () => {
  const reader = (capabilities: string[], is_ceo = false) => ({ is_ceo, capabilities }) as unknown as Me;
  const usable = (me: Me) => (Object.keys(TAB_CAPABILITIES) as Array<keyof typeof TAB_CAPABILITIES>).filter((tab) => mayUseTab(me, tab));

  it("follows the capability codes, never a role or managing people", () => {
    expect(usable(reader([]))).toEqual([]);
    expect(usable(reader(["home.team"]))).toEqual(["team"]);
    expect(usable(reader(["alerts.clear"]))).toEqual(["alerts"]);
    expect(usable(reader(["alerts.manage"]))).toEqual(["alerts"]);
    expect(usable(reader(["home.reports"]))).toEqual(["reports"]);
    // A Line Manager or a Head of Department, as 1199 grants them.
    expect(usable(reader(["alerts.clear", "home.reports", "home.team"]))).toEqual(["team", "alerts", "reports"]);
  });

  it("opens each tab to every code TAB_CAPABILITIES names for it, and only that tab", () => {
    for (const [tab, codes] of Object.entries(TAB_CAPABILITIES)) {
      for (const code of codes) expect([code, usable(reader([code]))]).toEqual([code, [tab]]);
    }
  });

  it("opens every tab to the CEO, who holds every capability", () => {
    expect(usable(reader([], true))).toEqual(["team", "alerts", "reports"]);
  });
});
