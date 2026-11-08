"use strict";
/**
 * Where Chromium is, and the one browser the worker keeps open.
 *
 * "Works locally, fails live" for PDFs is almost always the browser: a path that
 * does not exist on the server, a second caller that looks somewhere else, or a
 * browser launched per document until the server runs out of memory. So:
 *
 *  - ONE resolver: CHROMIUM_PATH when set (and it must exist: a stale path is an
 *    error at boot of the first render, not a silent fallback), else the usual
 *    install paths. ops/provision installs it at /usr/bin/chromium.
 *  - ONE browser per process, launched on first use, relaunched if it dies, closed on
 *    shutdown. Each render opens and closes its own page.
 *  - At most two renders at once per process; the rest wait their turn.
 *  - A slow first launch is waited for. Chromium's first start on a machine builds the
 *    font cache before it answers: 10 s with 335 fonts, past puppeteer's 30 s default on a
 *    CI runner with thousands (08/11/2026). So a launch waits LAUNCH_TIMEOUT_MS, tries once
 *    more if that runs out, and never waits on a D-Bus session a server does not have.
 *
 * puppeteer-core is used, not puppeteer: it never downloads a browser of its own.
 */
const fs = require("node:fs");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");

const KNOWN_PATHS = Object.freeze([
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/snap/bin/chromium",
  "/opt/pw-browsers/chromium",
]);

const MAX_CONCURRENT = 2;
/** How long a launch may take before it is tried once more (the font cache, above). */
const LAUNCH_TIMEOUT_MS = 90_000;

const exists = (p) => {
  try {
    return Boolean(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Playwright-style installs keep the binary a few folders down. */
function findUnder(dir) {
  try {
    for (const entry of fs.readdirSync(dir)) {
      for (const sub of [
        "chrome-linux/chrome",
        "chrome-linux64/chrome",
        "chrome",
      ]) {
        const p = `${dir}/${entry}/${sub}`;
        if (exists(p)) return p;
      }
    }
  } catch {
    /* not there */
  }
  return null;
}

/**
 * The browser executable, or null.
 * @returns {string|null}
 */
function resolvePath() {
  if (config.CHROMIUM_PATH) {
    if (!exists(config.CHROMIUM_PATH))
      throw new Error(
        `CHROMIUM_PATH is ${config.CHROMIUM_PATH}, which does not exist`,
      );
    return config.CHROMIUM_PATH;
  }
  return KNOWN_PATHS.find(exists) || findUnder("/opt/pw-browsers") || null;
}

let browserPromise = null;
let closing = false;

async function launch() {
  const executablePath = resolvePath();
  if (!executablePath)
    throw new Error(
      "Chromium is not installed; set CHROMIUM_PATH (ops/provision installs it)",
    );
  try {
    return await start(executablePath);
  } catch (err) {
    if (err?.name !== "TimeoutError") throw err;
    logger.warn({ err: err.message }, "chromium was slow to start; trying once more");
    return start(executablePath);
  }
}

/** One launch of the browser at `executablePath`, watched until it dies. */
async function start(executablePath) {
  const puppeteer = require("puppeteer-core");
  const instance = await puppeteer.launch({
    executablePath,
    headless: true,
    timeout: LAUNCH_TIMEOUT_MS,
    // No session bus on a server or a runner: Chromium fails fast instead of waiting on one.
    env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: "disabled:" },
    // The background-networking flags stop Chromium itself calling out (Google sign-in,
    // component updates, sync): a PDF renderer on our server talks to nobody.
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--font-render-hinting=none",
      "--no-first-run",
      "--mute-audio",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-sync",
      "--no-default-browser-check",
      "--metrics-recording-only",
    ],
  });
  instance.on("disconnected", () => {
    if (!closing)
      logger.warn("chromium disconnected; the next render relaunches it");
    browserPromise = null;
  });
  return instance;
}

/** The shared browser, launched on first use. */
function browser() {
  if (!browserPromise) {
    browserPromise = launch().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

let active = 0;
const waiting = [];

/** Run `fn(page)` on a fresh page, at most MAX_CONCURRENT at a time. */
async function withPage(fn) {
  if (active >= MAX_CONCURRENT)
    await new Promise((resolve) => waiting.push(resolve));
  active += 1;
  let page;
  try {
    page = await (await browser()).newPage();
    return await fn(page);
  } finally {
    if (page) await page.close().catch(() => {});
    active -= 1;
    const next = waiting.shift();
    if (next) next();
  }
}

/** Close the browser (worker shutdown). */
async function close() {
  const p = browserPromise;
  browserPromise = null;
  if (!p) return;
  closing = true;
  try {
    const instance = await p.catch(() => null);
    if (instance) await instance.close().catch(() => {});
  } finally {
    closing = false;
  }
}

/** Readiness: is there a browser to launch? Does not launch it. */
function health() {
  try {
    const p = resolvePath();
    return {
      status: p ? "up" : "degraded",
      path: p,
      error: p ? undefined : "Chromium not found",
    };
  } catch (err) {
    return { status: "degraded", error: err.message };
  }
}

module.exports = { KNOWN_PATHS, LAUNCH_TIMEOUT_MS, resolvePath, browser, withPage, close, health };
