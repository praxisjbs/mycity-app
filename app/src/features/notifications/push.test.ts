// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { disablePush, enablePush, resetPushForTest, syncPush } from "./push";

/** What this device allows, read before anything is subscribed (docs/guides/notifications.md §3). */
function browser({ permission, push = true, ua = "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0" }: { permission?: NotificationPermission; push?: boolean; ua?: string }) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
  if (push) {
    Object.defineProperty(window, "PushManager", { configurable: true, value: function PushManager() {} });
    const registration = { pushManager: { getSubscription: async () => null } };
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { ready: Promise.resolve(registration) } });
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: Object.assign(function Notification() {}, { permission, requestPermission: vi.fn(async () => "denied") }),
    });
  } else {
    delete (window as { PushManager?: unknown }).PushManager;
  }
}

describe("push on this device", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    resetPushForTest();
  });

  it("is blocked when the browser refused, and asks nothing on its own when never asked", async () => {
    browser({ permission: "denied" });
    expect(await syncPush()).toBe("blocked");
    browser({ permission: "default" });
    expect(await syncPush()).toBe("ask");
  });

  it("on an iPhone in Safari it needs installing first", async () => {
    browser({ permission: "default", push: false, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" });
    expect(await syncPush()).toBe("needs-install");
  });

  it("Turn On asks the browser, and a refusal reads Blocked", async () => {
    browser({ permission: "default" });
    expect(await enablePush()).toBe("blocked");
    expect(Notification.requestPermission).toHaveBeenCalledOnce();
  });

  it("Turn Off is remembered on this device, so the next start does not subscribe again", async () => {
    browser({ permission: "granted" });
    await disablePush().catch(() => undefined);
    expect(await syncPush()).toBe("off");
  });
});
