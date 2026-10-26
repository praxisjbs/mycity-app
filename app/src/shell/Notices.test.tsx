// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ModalProvider } from "@mycity/ui";
import { setGuideReturn, clearGuideReturn } from "@/features/knowledge/guide/return";
import { RouterProvider } from "@/lib/router";
import { ShellNotices, writingScreen } from "./Notices";
import { resetPwaForTest } from "./pwa";

/**
 * The shell's floating offers keep off a screen whose message box sits at the foot of the page
 * (Staff Community, Praxis AI's Ask), so they never cover what a person is typing, and come back
 * on the next other screen. Back to Guide, which the reader asked for, still shows there.
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

describe("the shell's offers on a screen with a message box", () => {
  it("knows the screens: every Staff Community tab and Praxis AI's Ask", () => {
    expect(writingScreen("community", "channels")).toBe(true);
    expect(writingScreen("community", "direct-messages")).toBe(true);
    expect(writingScreen("community", "announcements")).toBe(true);
    expect(writingScreen("community", null)).toBe(true);
    expect(writingScreen("praxis-ai", "ask")).toBe(true);
    expect(writingScreen("praxis-ai", null)).toBe(true);
    expect(writingScreen("praxis-ai", "history")).toBe(false);
    expect(writingScreen("mailbox", "inbox")).toBe(false);
    expect(writingScreen("home", null)).toBe(false);
    expect(writingScreen(null, null)).toBe(false);
  });

  it("keeps the install offer off Staff Community, and shows it on the next other screen", () => {
    installOffer();
    at("/community?tab=channels");
    const { unmount } = show();
    expect(screen.queryByText("Install MyCity App on this device")).toBeNull();
    unmount();
    at("/home");
    show();
    expect(screen.getByText("Install MyCity App on this device")).toBeTruthy();
  });

  it("keeps the new version and notifications offers off a chat too", () => {
    resetPwaForTest({ update: async () => undefined });
    push = "ask";
    at("/community?tab=direct-messages");
    const { unmount } = show();
    expect(screen.queryByText("A new version is ready")).toBeNull();
    expect(screen.queryByText("Get notified of new mail and approvals")).toBeNull();
    unmount();
    at("/praxis-ai?tab=ask");
    const again = show();
    expect(screen.queryByText("A new version is ready")).toBeNull();
    again.unmount();
    at("/people?tab=employees");
    show();
    expect(screen.getByText("A new version is ready")).toBeTruthy();
  });

  it("still shows Back to Guide on a chat, as the reader asked for it", () => {
    installOffer();
    act(() => setGuideReturn({ id: "start-a-poll", step: 2, title: "Start a Poll" }));
    at("/community?tab=channels");
    show();
    expect(screen.getByText("Start a Poll · Step 2")).toBeTruthy();
    expect(screen.queryByText("Install MyCity App on this device")).toBeNull();
  });
});
