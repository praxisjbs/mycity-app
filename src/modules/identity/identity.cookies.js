"use strict";
/**
 * The two cookies identity sets, and nothing else sets.
 *
 * REFRESH (`__Secure-mycity_rt` on servers). The session's refresh token. HttpOnly,
 * so no script, injected or not, can read it; Secure; SameSite=Strict, so no other
 * site can make a request carry it; sent only to /api/v1/auth, so it travels with
 * nothing else; host-only (no Domain), so hub.staging never sees hub's. It lives
 * exactly as long as the session it belongs to, and rotates on every refresh.
 *
 * DEVICE (`__Host-mycity_device` on servers). 32 random bytes that name this browser,
 * so the server can remember who signs in on it: the sign-in screen greets them,
 * and a sign-in from a browser never seen before tells the person. It is NOT a
 * credential: it opens no session and skips no step. Only its SHA-256 is stored.
 * `__Host-` means Secure, Path=/ and no Domain, so a page on another subdomain can
 * neither plant nor overwrite it. Browsers cap a cookie's life at 400 days; every
 * sign-in rolls it forward.
 *
 * Plain names without the prefixes on a laptop, where there is no https.
 */
const crypto = require("node:crypto");
const { isServer } = require("../../config/env");

const REFRESH_COOKIE = isServer ? "__Secure-mycity_rt" : "mycity_rt";
const REFRESH_PATH = "/api/v1/auth";
const DEVICE_COOKIE = isServer ? "__Host-mycity_device" : "mycity_device";
const DEVICE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
const DEVICE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Set the refresh cookie for a session with `seconds` left. */
function setRefresh(res, token, seconds) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isServer,
    sameSite: "strict",
    path: REFRESH_PATH,
    maxAge: Math.max(1, Math.floor(seconds)) * 1000,
  });
}

function clearRefresh(res) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: isServer,
    sameSite: "strict",
    path: REFRESH_PATH,
  });
}

/** The refresh token the browser sent, or null. */
function readRefresh(req) {
  const v = req.cookies ? req.cookies[REFRESH_COOKIE] : null;
  return typeof v === "string" && v.length > 0 && v.length < 4096 ? v : null;
}

/** This browser's device token, or null. Anything malformed is ignored. */
function readDevice(req) {
  const v = req.cookies ? req.cookies[DEVICE_COOKIE] : null;
  return typeof v === "string" && DEVICE_TOKEN.test(v) ? v : null;
}

function newDeviceToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function setDevice(res, token) {
  res.cookie(DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: isServer,
    sameSite: "strict",
    path: "/",
    maxAge: DEVICE_MAX_AGE_MS,
  });
}

const hashToken = (token) =>
  crypto.createHash("sha256").update(String(token), "utf8").digest("hex");

module.exports = {
  REFRESH_COOKIE,
  REFRESH_PATH,
  DEVICE_COOKIE,
  setRefresh,
  clearRefresh,
  readRefresh,
  readDevice,
  newDeviceToken,
  setDevice,
  hashToken,
};
