"use strict";
/**
 * The API process serves both frontend builds and keeps the two surfaces apart
 * by host (SYSTEM_ARCHITECTURE §3). The hosting panel's proxy only terminates TLS
 * and forwards every path; it allow-lists nothing.
 *
 *   hub.<domain>   app/dist          staff app (PWA, service worker at /)
 *   go.<domain>    public-app/dist   public site (no service worker)
 *
 * hostGuard (before the API routes) refuses a path on the wrong host:
 *
 *   on hub.  /api/public/...                 → 404
 *   on go.   /api/v1/..., /socket.io/...     → 404
 *   on any other host (an IP, a stray DNS name), on a server: everything but
 *   /api/health is a 404, so the app is only reachable under its own names
 *
 * staticSites (after the API routes) serves the build for the request's host:
 *
 *   /assets/*           Vite's content-hashed files: cached for a year, immutable
 *   other files         sw.js, manifest, icons: always revalidated (no-cache), so a
 *                       release reaches every browser on its next load
 *   anything else GET   index.html, no-cache (the app's router takes the path)
 *   /api, /socket.io, /media never fall back to index.html: a wrong API path is a
 *   JSON 404, not an HTML page the client tries to parse
 *
 * The hosts come from STAFF_ORIGIN and PUBLIC_ORIGIN. When both name the same
 * host (a laptop on plain localhost), there is no host to tell them apart by, so
 * nothing is refused and only the staff build is served. To run both builds
 * through Node locally, use http://hub.localhost:8080 and http://go.localhost:8080
 * as the two origins: browsers resolve *.localhost to this machine.
 *
 * A build directory that does not exist is reported by /api/health/ready
 * ("degraded" on a server, where both builds are part of the release) and its
 * host answers 404 for pages; the API is unaffected.
 */
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { config, isServer } = require("../config/env");
const { registerCheck } = require("./health");

const ROOT = path.resolve(__dirname, "../..");
const NEVER_HTML = /^\/(api|socket\.io|media)(\/|$)/;

const hostOf = (origin) => new URL(origin).hostname.toLowerCase();

function sites() {
  const staffHost = hostOf(config.STAFF_ORIGIN);
  const publicHost = hostOf(config.PUBLIC_ORIGIN);
  return {
    split: staffHost !== publicHost,
    staff: { host: staffHost, dir: path.resolve(ROOT, config.APP_DIST_DIR) },
    public: { host: publicHost, dir: path.resolve(ROOT, config.PUBLIC_APP_DIST_DIR) },
  };
}

/** "staff" | "public" | null (a host that is neither) */
function surfaceOfHost(req, s = sites()) {
  if (!s.split) return "staff";
  const host = String(req.hostname || "").toLowerCase();
  if (host === s.staff.host) return "staff";
  if (host === s.public.host) return "public";
  return null;
}

const notFound = (req, res) =>
  res.status(404).json({ error: { code: "NOT_FOUND", message: `Nothing at ${req.method} ${req.path}` }, request_id: req.request_id });

/** Refuse paths that belong to the other surface's host. */
function hostGuard() {
  const s = sites();
  return function guardHost(req, res, next) {
    if (!s.split) return next();
    if (/^\/api\/health(\/|$)/.test(req.path)) return next();
    const surface = surfaceOfHost(req, s);
    if (surface === null) return isServer ? notFound(req, res) : next();
    if (surface === "staff" && /^\/api\/public(\/|$)/.test(req.path)) return notFound(req, res);
    if (surface === "public" && /^\/(api\/v1|socket\.io)(\/|$)/.test(req.path)) return notFound(req, res);
    return next();
  };
}

function setCacheHeaders(res, filePath) {
  const rel = filePath.split(path.sep).join("/");
  if (/\/assets\//.test(rel)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  else res.setHeader("Cache-Control", "no-cache");
}

function siteHandler(site) {
  const exists = () => fs.existsSync(path.join(site.dir, "index.html"));
  const files = express.static(site.dir, { index: false, redirect: false, fallthrough: true, setHeaders: setCacheHeaders });
  return function serveSite(req, res, next) {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (!exists()) return next();
    return files(req, res, () => {
      if (NEVER_HTML.test(req.path)) return next();
      res.setHeader("Cache-Control", "no-cache");
      return res.sendFile(path.join(site.dir, "index.html"));
    });
  };
}

/** Serve the build that belongs to the request's host. */
function staticSites() {
  const s = sites();
  const handlers = { staff: siteHandler(s.staff), public: siteHandler(s.public) };
  return function serveForHost(req, res, next) {
    const surface = surfaceOfHost(req, s);
    if (!surface) return next();
    return handlers[surface](req, res, next);
  };
}

registerCheck("static", async () => {
  const s = sites();
  const built = (dir) => fs.existsSync(path.join(dir, "index.html"));
  const out = { staff: built(s.staff.dir), public: s.split ? built(s.public.dir) : "not served on one host" };
  const missing = out.staff === false || out.public === false;
  return { status: missing && isServer ? "degraded" : "up", ...out };
});

module.exports = { hostGuard, staticSites, surfaceOfHost, sites };
