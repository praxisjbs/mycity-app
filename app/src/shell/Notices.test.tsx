// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ModalProvider } from "@mycity/ui";
import { setGuideReturn, clearGuideReturn } from "@/features/knowledge/guide/return";
import { RouterProvider } from "@/lib/router";
import { offersScreen, ShellNotices } from "./Notices";
import { resetPwaForTest } from "./pwa";

/**
 * The shell's floating offers (a new version, notifications, installing the app) show on Home
 * only, any tab, so they never sit over another page's own content at its foot: a message box,
 * a report, a list's last rows. Back to Guide, which the reader asked for, shows wherever it led.
 */

let push = "on";
vi.mock("@/features/notifications/push", () => ({ usePushState: () => push, turnOnPush: vi.fn() }));

const at = (url: string) => window.history.replaceState(null, "", url);
const show = () =>
  render(
    <RouterProvider>
      <ModalProvider>
        <ShellNotices />
      </ModalProvider>
    </RouterProvider>,
  );
const installOffer = () => resetPwaForTest({ prompt: Object.assign(new Event("beforeinstallprompt"), { prompt: async () => undefined, userChoice: Promise.resolve({ outcome: "dismissed" }) }) as never, visits: 2 });

afterEach(() => {
  cleanup();
  act(() => clearGuideReturn());
  resetPwaForTest();
  localStorage.clear();
  push = "on";
  at("/");
});

describe("the shell's offers, on Home only", () => {
  it("knows the screen: Home, any tab, and nowhere else", () => {
    expect(offersScreen("home")).toBe(true);
    expect(offersScreen("community")).toBe(false);
    expect(offersScreen("praxis-ai")).toBe(false);
    expect(offersScreen("people")).toBe(false);
    expect(offersScreen("mailbox")).toBe(false);
    expect(offersScreen(null)).toBe(false);
  });

  it("shows the install offer on Home's tabs, and on no other screen", () => {
    installOffer();
    for (const url of ["/community?tab=channels", "/praxis-ai?tab=ask", "/people?tab=employees", "/settings?tab=audit-log"]) {
      at(url);
      const { unmount } = show();
      expect(screen.queryByText("Install MyCity App on this device")).toBeNull();
      unmount();
    }
    for (const url of ["/home?tab=overview", "/home?tab=reports"]) {
      at(url);
      const { unmount } = show();
      expect(screen.getByText("Install MyCity App on this device")).toBeTruthy();
      unmount();
    }
  });

  it("keeps the new version and notifications offers for Home too", () => {
    resetPwaForTest({ update: async () => undefined });
    push = "ask";
    at("/people?tab=attendance");
    const { unmount } = show();
    expect(screen.queryByText("A new version is ready")).toBeNull();
    expect(screen.queryByText("Get notified of new mail and approvals")).toBeNull();
    unmount();
    at("/home?tab=reports");
    const home = show();
    expect(screen.getByText("A new version is ready")).toBeTruthy();
    home.unmount();
    resetPwaForTest();
    at("/home?tab=overview");
    show();
    expect(screen.getByText("Get notified of new mail and approvals")).toBeTruthy();
  });

  it("still shows Back to Guide off Home, as the reader asked for it", () => {
    installOffer();
    act(() => setGuideReturn({ id: "start-a-poll", step: 2, title: "Start a Poll" }));
    at("/community?tab=channels");
    show();
    expect(screen.getByText("Start a Poll · Step 2")).toBeTruthy();
    expect(screen.queryByText("Install MyCity App on this device")).toBeNull();
  });
});
