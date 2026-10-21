// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ASK_MS, browserOf, deviceOf, fixFor, newKey, readLocation, READ_MS, type Reading } from "./location";

/**
 * The attendance feature's one location reader (docs/guides/attendance.md §6.5): it watches for up
 * to ten seconds and keeps the best fix, stops early at 50 m, takes no cached position, always ends,
 * and names the fix for this device when a reading cannot prove the place. Every device and browser
 * here is a user-agent string; no location is real.
 */

type Position = { coords: { latitude: number; longitude: number; accuracy: number } };
let onFix: ((p: Position) => void) | null = null;
let onError: ((e: { code: number }) => void) | null = null;
const watchPosition = vi.fn((ok: (p: Position) => void, no: (e: { code: number }) => void) => {
  onFix = ok;
  onError = no;
  return 7;
});
const clearWatch = vi.fn();
let state = "granted";

const at = (accuracy: number) => ({ coords: { latitude: 6.5, longitude: 3.4, accuracy } });
/** Lets the permission read settle, so the watch has started; no time passes meanwhile. */
const started = async () => {
  for (let i = 0; i < 20 && watchPosition.mock.calls.length === 0; i += 1) await Promise.resolve();
  expect(watchPosition).toHaveBeenCalled();
};
const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 15; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  windowsEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0",
  macFirefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
};
const as = (userAgent: string, maxTouchPoints = 0) => ({ userAgent, maxTouchPoints });

beforeEach(() => {
  vi.useFakeTimers();
  watchPosition.mockClear();
  clearWatch.mockClear();
  onFix = null;
  onError = null;
  state = "granted";
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { watchPosition, clearWatch } });
  Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: async () => ({ state }) } });
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("reading the location", () => {
  it("watches with high accuracy and no cached position, and stops at the first fix of 50 m or better", async () => {
    const reading = readLocation();
    await started();
    expect((watchPosition.mock.calls[0] as unknown[])[2]).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 });
    onFix!(at(400));
    onFix!(at(48));
    await expect(reading).resolves.toEqual({ fix: { latitude: 6.5, longitude: 3.4, accuracy_m: 48 }, error: null });
    expect(clearWatch).toHaveBeenCalledWith(7);
  });

  it("keeps the best fix and ends after ten seconds when none is fine enough", async () => {
    let done: Reading | null = null;
    void readLocation().then((r) => (done = r));
    await started();
    onFix!(at(900));
    onFix!(at(120));
    onFix!(at(300));
    await vi.advanceTimersByTimeAsync(READ_MS - 1);
    expect(done).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toEqual({ fix: { latitude: 6.5, longitude: 3.4, accuracy_m: 120 }, error: null });
    expect(clearWatch).toHaveBeenCalledTimes(1);
  });

  it("always ends: a browser that never answers is timed out by the watchdog", async () => {
    const reading = readLocation();
    await started();
    await vi.advanceTimersByTimeAsync(READ_MS);
    await expect(reading).resolves.toEqual({ fix: null, error: "timeout" });
    expect(clearWatch).toHaveBeenCalledWith(7);
  });

  it("while the browser asks it waits for the answer, then reads for ten seconds from it", async () => {
    state = "prompt";
    let done: Reading | null = null;
    void readLocation().then((r) => (done = r));
    await started();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(done).toBeNull();
    onFix!(at(200));
    await vi.advanceTimersByTimeAsync(READ_MS - 1);
    expect(done).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toMatchObject({ fix: { accuracy_m: 200 } });
  });

  it("an ask nobody answers still ends", async () => {
    state = "prompt";
    const reading = readLocation();
    await started();
    await vi.advanceTimersByTimeAsync(ASK_MS);
    await expect(reading).resolves.toEqual({ fix: null, error: "timeout" });
  });

  it("denied ends at once; a passing error keeps it reading and is the answer only without a fix", async () => {
    const denied = readLocation();
    await started();
    onError!({ code: 1 });
    await expect(denied).resolves.toEqual({ fix: null, error: "denied" });

    watchPosition.mockClear();
    const lost = readLocation();
    await started();
    onError!({ code: 3 });
    onError!({ code: 2 });
    await vi.advanceTimersByTimeAsync(READ_MS);
    await expect(lost).resolves.toEqual({ fix: null, error: "unavailable" });

    watchPosition.mockClear();
    const recovered = readLocation();
    await started();
    onError!({ code: 3 });
    onFix!(at(30));
    await expect(recovered).resolves.toMatchObject({ fix: { accuracy_m: 30 }, error: null });
  });

  it("an insecure page or a browser with no location never starts a watch", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    await expect(readLocation()).resolves.toEqual({ fix: null, error: "insecure" });
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
    await expect(readLocation()).resolves.toEqual({ fix: null, error: "unsupported" });
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it("closing the screen stops the watch at once", async () => {
    const stop = new AbortController();
    const reading = readLocation({ signal: stop.signal });
    await started();
    stop.abort();
    await reading;
    expect(clearWatch).toHaveBeenCalledWith(7);
  });
});

describe("the fix for this device", () => {
  it("knows an iPhone, an iPad, an Android phone and a computer, and the browser", () => {
    expect(deviceOf(as(UA.iphone))).toBe("iphone");
    expect(deviceOf(as(UA.macSafari, 5))).toBe("iphone");
    expect(deviceOf(as(UA.android))).toBe("android");
    expect(deviceOf(as(UA.windowsChrome))).toBe("computer");
    expect(deviceOf(as(UA.macSafari))).toBe("computer");
    expect(browserOf(as(UA.iphone))).toBe("safari");
    expect(browserOf(as(UA.iphoneChrome))).toBe("chrome");
    expect(browserOf(as(UA.samsung))).toBe("samsung");
    expect(browserOf(as(UA.windowsEdge))).toBe("edge");
    expect(browserOf(as(UA.macFirefox))).toBe("firefox");
  });

  it("a phone rougher than 1,000 m has precise location off: how to turn it on, for iPhone or Android", () => {
    expect(fixFor({ error: null, accuracy_m: 1500 }, as(UA.iphone))).toEqual({
      title: "Precise Location Off",
      text: "open Settings, Privacy, Location Services, Safari Websites, and turn on Precise Location.",
    });
    expect(fixFor({ error: null, accuracy_m: 2000 }, as(UA.android))?.text).toBe(
      "open Settings, Location, App permissions, Chrome, and turn on Use precise location.",
    );
    // A weak signal on a phone is the usual move-and-retry, which the step says itself.
    expect(fixFor({ error: null, accuracy_m: 300 }, as(UA.android))).toBeNull();
    expect(fixFor({ error: "timeout" }, as(UA.iphone))).toBeNull();
  });

  it("a computer is told to use the phone; a blocked permission says how in that browser; an insecure page needs the secure address", () => {
    expect(fixFor({ error: null, accuracy_m: 2400 }, as(UA.windowsChrome))?.title).toBe("Use Your Phone");
    expect(fixFor({ error: "unavailable" }, as(UA.macSafari))?.title).toBe("Use Your Phone");
    expect(fixFor({ error: "denied" }, as(UA.iphone))).toEqual({ title: "Location Blocked", text: "tap aA in the address bar, then Website Settings, Location, Allow." });
    expect(fixFor({ error: "denied" }, as(UA.android))?.text).toBe("tap the icon beside the address, then Permissions, Location, Allow.");
    expect(fixFor({ error: "denied" }, as(UA.windowsChrome))?.text).toBe("click the icon beside the address, then turn Location on.");
    expect(fixFor({ error: "denied" }, as(UA.macFirefox))?.text).toBe("tap the icon beside the address, then clear Blocked next to Location.");
    expect(fixFor({ error: "denied" }, as(UA.iphoneChrome))?.text).toBe("open Settings, Privacy, Location Services, Chrome, and choose While Using.");
    expect(fixFor({ error: "insecure" }, as(UA.android))).toEqual({ title: "Secure Address Needed", text: `open https://${location.host} to clock in.` });
    expect(fixFor({ error: "unsupported" }, as(UA.windowsChrome))).toBeNull();
  });

  it("every fix keeps to the word limits and carries no dashes", () => {
    const all = [
      fixFor({ error: null, accuracy_m: 1500 }, as(UA.iphone)),
      fixFor({ error: null, accuracy_m: 1500 }, as(UA.samsung)),
      fixFor({ error: null, accuracy_m: 1500 }, as(UA.windowsEdge)),
      ...(["denied", "insecure"] as const).flatMap((error) => Object.values(UA).map((ua) => fixFor({ error }, as(ua)))),
    ].filter((f): f is NonNullable<typeof f> => f !== null);
    const words = (t: string) => t.split(/\s+/).filter((w) => /[a-z]/i.test(w)).length;
    for (const f of all) {
      expect(words(f.title)).toBeLessThanOrEqual(4);
      expect(words(`${f.title}: ${f.text}`)).toBeLessThanOrEqual(20);
      expect(`${f.title} ${f.text}`).not.toMatch(/[–—]|--/);
    }
  });
});

describe("a punch's key", () => {
  it("is a UUID, also where crypto.randomUUID is missing", () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(newKey()).toMatch(/^[0-9a-f-]{36}$/);
    const real = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: undefined });
    try {
      const a = newKey();
      expect(a).toMatch(uuid);
      expect(newKey()).not.toBe(a);
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: real });
    }
  });
});
