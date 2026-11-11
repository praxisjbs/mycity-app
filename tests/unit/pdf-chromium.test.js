"use strict";
/**
 * The one browser the worker keeps (src/services/pdf/chromium.js), without a browser: a first
 * launch slower than its timeout (Chromium building its font cache on a fresh machine) is tried
 * once more, and any other failure is not.
 */
jest.mock("puppeteer-core", () => ({ launch: jest.fn() }));

const timeout = () => Object.assign(new Error("Timed out after 90000 ms while waiting for the WS endpoint URL to appear in stdout!"), { name: "TimeoutError" });
const fakeBrowser = () => ({ on: jest.fn(), close: jest.fn().mockResolvedValue(undefined) });

let chromium;
let puppeteer;
beforeEach(() => {
  jest.resetModules();
  // The fresh registry's mock: the one chromium.js will require.
  puppeteer = require("puppeteer-core");
  puppeteer.launch.mockReset();
  // Any file that exists stands for the browser: the launch itself is mocked.
  process.env.CHROMIUM_PATH = process.execPath;
  chromium = require("../../src/services/pdf/chromium");
});
afterEach(async () => {
  await chromium.close();
  jest.restoreAllMocks();
});

test("waits for a slow first launch, with no D-Bus session to wait on", async () => {
  puppeteer.launch.mockResolvedValue(fakeBrowser());
  await chromium.browser();
  const opts = puppeteer.launch.mock.calls[0][0];
  expect(opts.timeout).toBe(chromium.LAUNCH_TIMEOUT_MS);
  expect(chromium.LAUNCH_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  expect(opts.env.DBUS_SESSION_BUS_ADDRESS).toBe("disabled:");
});

test("a launch that runs out of time is tried once more", async () => {
  const b = fakeBrowser();
  puppeteer.launch.mockRejectedValueOnce(timeout()).mockResolvedValueOnce(b);
  await expect(chromium.browser()).resolves.toBe(b);
  expect(puppeteer.launch).toHaveBeenCalledTimes(2);
});

test("twice out of time, or any other failure, is not tried again", async () => {
  puppeteer.launch.mockRejectedValueOnce(timeout()).mockRejectedValueOnce(timeout());
  await expect(chromium.browser()).rejects.toThrow(/WS endpoint/);
  expect(puppeteer.launch).toHaveBeenCalledTimes(2);

  puppeteer.launch.mockReset();
  puppeteer.launch.mockRejectedValueOnce(new Error("Failed to launch the browser process"));
  await expect(chromium.browser()).rejects.toThrow(/Failed to launch/);
  expect(puppeteer.launch).toHaveBeenCalledTimes(1);
});

// A script run by hand as the environment's user keeps that user's home, which it may not
// write (staging's seed, 11/11/2026): Chromium is given the temp folder instead.
test("keeps a home it may write, and swaps one it may not for the temp folder", () => {
  const os = require("node:os");
  const fs = require("node:fs");
  const path = require("node:path");
  const mine = fs.mkdtempSync(path.join(os.tmpdir(), "home-"));
  expect(chromium.homeFor({ HOME: mine })).toEqual({});
  const locked = path.join(mine, "locked");
  fs.mkdirSync(locked, { mode: 0o500 });
  const swapped = process.getuid && process.getuid() === 0 ? null : chromium.homeFor({ HOME: locked });
  if (swapped) expect(swapped).toEqual({ HOME: os.tmpdir(), XDG_CONFIG_HOME: path.join(os.tmpdir(), ".config"), XDG_CACHE_HOME: path.join(os.tmpdir(), ".cache") });
  expect(chromium.homeFor({ HOME: path.join(mine, "missing") }).HOME).toBe(os.tmpdir());
  expect(chromium.homeFor({}).HOME).toBe(os.tmpdir());
  fs.rmSync(mine, { recursive: true, force: true });
});
