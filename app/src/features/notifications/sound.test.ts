// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alertArrival, resetSoundForTest, setSoundInApp } from "./sound";

/** What the app does when a notice arrives while it is open (docs/guides/notifications.md §6). */
const as = (ua: string) => vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

describe("the sound when a notice arrives", () => {
  beforeEach(() => {
    resetSoundForTest();
    localStorage.clear();
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vi.fn(() => true) });
  });
  afterEach(() => vi.restoreAllMocks());

  it("on Android it vibrates and stays quiet unless Sound in App is on", () => {
    as(ANDROID);
    expect(alertArrival("comms", 1_000_000)).toBe("vibrate");
    expect(navigator.vibrate).toHaveBeenCalled();
    setSoundInApp(true);
    expect(alertArrival("comms", 2_000_000)).toBe("both");
  });

  it("on desktop it chimes, and Sound in App off silences it", () => {
    as(DESKTOP);
    expect(alertArrival("approvals", 1_000_000)).toBe("chime");
    setSoundInApp(false);
    expect(alertArrival("approvals", 2_000_000)).toBe("none");
  });

  it("at most once every 5 seconds, and only for mail, messages and approvals", () => {
    as(DESKTOP);
    expect(alertArrival("comms", 1_000_000)).toBe("chime");
    expect(alertArrival("comms", 1_004_000)).toBe("none");
    expect(alertArrival("comms", 1_006_000)).toBe("chime");
    expect(alertArrival("payroll", 2_000_000)).toBe("none");
  });
});
