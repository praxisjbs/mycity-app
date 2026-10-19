// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { install, installLater, noteVisit, reloadOnTakeover, resetPwaForTest, STAYED_MS, TAKEOVER_MS, usePwa } from "./pwa";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetPwaForTest();
});

const prompt = (outcome: "accepted" | "dismissed") => Object.assign(new Event("beforeinstallprompt"), { prompt: async () => undefined, userChoice: Promise.resolve({ outcome }) });

describe("the installed app (PR 2 question 4)", () => {
  it("offers the banner from the second signed-in visit, counting once per browser session", () => {
    resetPwaForTest({ prompt: prompt("dismissed") as never });
    const { result } = renderHook(() => usePwa());
    act(() => noteVisit());
    act(() => noteVisit());
    expect(result.current).toMatchObject({ canInstall: true, banner: false });
    sessionStorage.clear();
    act(() => noteVisit());
    expect(result.current.banner).toBe(true);
  });

  it("Not Now holds the banner for 30 days", () => {
    resetPwaForTest({ prompt: prompt("dismissed") as never, visits: 3 });
    const { result } = renderHook(() => usePwa());
    expect(result.current.banner).toBe(true);
    act(() => installLater());
    expect(result.current.banner).toBe(false);
    expect(Number(localStorage.getItem("mc-install-later"))).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);
  });

  it("offers nothing once installed", () => {
    resetPwaForTest({ prompt: prompt("dismissed") as never, visits: 5, installed: true });
    const { result } = renderHook(() => usePwa());
    expect(result.current).toMatchObject({ canInstall: false, banner: false });
  });

  it("installs through the browser's prompt, and shows the steps on an iPhone", async () => {
    resetPwaForTest({ prompt: prompt("accepted") as never });
    const { result } = renderHook(() => usePwa());
    await act(async () => expect(await install()).toBe("done"));
    expect(result.current.installed).toBe(true);
    resetPwaForTest({ ios: true });
    expect(await install()).toBe("steps");
  });
});

describe("Reload, after a new version is ready", () => {
  /** A waiting service worker and the page's container, as plain event targets. */
  const worker = () => Object.assign(new EventTarget(), { state: "installed" }) as unknown as ServiceWorker & { state: ServiceWorkerState };
  const container = () => new EventTarget() as unknown as ServiceWorkerContainer;

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks the new version to take over and reloads once it controls the page", async () => {
    const waiting = worker();
    const page = container();
    const skipWaiting = vi.fn(async () => undefined);
    const reload = vi.fn();
    void reloadOnTakeover(waiting, skipWaiting, reload, page);
    await Promise.resolve();
    expect(skipWaiting).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
    page.dispatchEvent(new Event("controllerchange"));
    page.dispatchEvent(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads when the new version activates, on a page no worker controls (a hard refresh)", () => {
    const waiting = worker();
    const reload = vi.fn();
    void reloadOnTakeover(waiting, async () => undefined, reload, container());
    waiting.state = "activating";
    waiting.dispatchEvent(new Event("statechange"));
    expect(reload).not.toHaveBeenCalled();
    waiting.state = "activated";
    waiting.dispatchEvent(new Event("statechange"));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads anyway when the handover stalls, and at once when nothing waits", () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    void reloadOnTakeover(worker(), async () => undefined, reload, container());
    vi.advanceTimersByTime(TAKEOVER_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reload).toHaveBeenCalledOnce();
    const now = vi.fn();
    void reloadOnTakeover(null, async () => undefined, now, container());
    expect(now).toHaveBeenCalledOnce();
  });

  it("keeps the button busy until the page goes, and lets it back if the page stays", async () => {
    vi.useFakeTimers();
    let settled = false;
    void reloadOnTakeover(null, async () => undefined, () => undefined, container()).then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(STAYED_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });
});
