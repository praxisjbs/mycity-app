"use strict";
/* global document */
/**
 * The component gallery as a gate target (FRONTEND_FOUNDATION F10, F23): build
 * packages/ui's gallery when its build is missing or stale, serve it on a local
 * port, and list its component pages. The screen gates (lib/screens.js, gates 8
 * and 11) and the accessibility gate (check/a11y.js) crawl it.
 *
 * STALE means the inputs changed since the last build: every file the build
 * reads (packages/ui/src without its tests, packages/ui/gallery, the package's
 * config and the root lockfile) is hashed, and the hash is written beside the
 * build as dist-gallery/.inputs. A build that has no stamp, or another hash, is
 * rebuilt (npm -w @mycity/ui run build writes no stamp, so the next gate run
 * rebuilds once: a few seconds).
 *
 * Every component page is a hash route, `#/<Component>`; the gallery's own
 * navigation lists them as links.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const UI = path.join(ROOT, "packages", "ui");
const DIST = path.join(UI, "dist-gallery");
const STAMP = path.join(DIST, ".inputs");

/** Files that do not change what the gallery build contains. */
const NOT_AN_INPUT = /\.(test|spec)\.[jt]sx?$/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (["node_modules", "dist", "dist-gallery"].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (!NOT_AN_INPUT.test(e.name)) out.push(full);
  }
  return out;
}

/** Every file the gallery build reads, sorted, absolute. */
function inputFiles() {
  return [
    ...walk(path.join(UI, "src")),
    ...walk(path.join(UI, "gallery")),
    ...["package.json", "vite.shared.js", "tsconfig.json"].map((f) => path.join(UI, f)),
    path.join(ROOT, "package-lock.json"),
  ].filter((f) => fs.existsSync(f));
}

/** A hash of the inputs: paths and contents, so a rename or a deletion counts too. */
function inputsHash(files = inputFiles()) {
  const h = crypto.createHash("sha1");
  for (const f of files) {
    h.update(path.relative(ROOT, f));
    h.update("\0");
    h.update(fs.readFileSync(f));
    h.update("\0");
  }
  return h.digest("hex").slice(0, 16);
}

/** Pure: does a build stamped `stamp` (null when there is none) need rebuilding for `hash`? */
const isStale = (stamp, hash, hasIndex) => !hasIndex || !stamp || stamp.trim() !== hash;

/** Vite's CLI as installed for packages/ui. */
function viteBin() {
  const pkg = require.resolve("vite/package.json", { paths: [UI] });
  return path.join(path.dirname(pkg), "bin", "vite.js");
}

/**
 * Build the gallery when it is missing or stale. Returns { dir, hash, built }.
 * Throws with the build's own output when the build fails: a gallery that does
 * not build fails the gate, it is never skipped.
 */
function ensureGallery() {
  const hash = inputsHash();
  const stamp = fs.existsSync(STAMP) ? fs.readFileSync(STAMP, "utf8") : null;
  if (!isStale(stamp, hash, fs.existsSync(path.join(DIST, "index.html")))) return { dir: DIST, hash, built: false };
  const r = spawnSync(process.execPath, [viteBin(), "build", "--config", "gallery/vite.config.ts", "--logLevel", "warn"], {
    cwd: UI,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`the gallery did not build (npm -w @mycity/ui run build):\n${`${r.stdout || ""}${r.stderr || ""}`.trim()}`);
  }
  fs.writeFileSync(STAMP, `${hash}\n`);
  return { dir: DIST, hash, built: true };
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  // PDF.js ships its worker as a module (pdf.worker.min-*.mjs); served as anything else, the browser refuses it.
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".json": "application/json",
};

/** Serve a folder on 127.0.0.1 at a free port. Resolves { url, close }. */
function serve(dir) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(String(req.url || "/").split(/[?#]/)[0]);
    const file = path.join(dir, urlPath === "/" ? "index.html" : urlPath);
    if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}/`, close: () => new Promise((done) => server.close(done)) });
    });
  });
}

/** The component names the gallery lists (its navigation links, `#/<Name>`), read from a page at desktop size. */
async function componentNames(page, url) {
  await page.goto(url);
  await page.waitForSelector("nav a[href^='#/']", { timeout: 15000 });
  return page.evaluate(() =>
    [...new Set([...document.querySelectorAll("nav a[href^='#/']")].map((a) => a.getAttribute("href").slice(2)))].filter(Boolean),
  );
}

/** Open one component page fresh (a reload, so no overlay or scroll lock leaks from the last one). */
async function openComponent(page, url, name) {
  await page.goto("about:blank");
  await page.goto(`${url}#/${name}`);
  await page.waitForFunction(
    (n) => {
      const h = document.querySelector("main h2");
      return !!h && h.textContent.trim() === n;
    },
    name,
    { timeout: 15000 },
  );
  await page.evaluate(() => document.fonts.ready.then(() => true));
  // Settle entrance animations: an overlay fading in reads as invisible (opacity 0).
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      if (a.effect && a.effect.getComputedTiming().endTime !== Infinity) a.finish();
    }
  });
}

module.exports = { DIST, inputFiles, inputsHash, isStale, ensureGallery, serve, componentNames, openComponent };
