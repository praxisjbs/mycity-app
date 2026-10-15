"use strict";
/**
 * The file store: one directory per environment, MEDIA_ROOT (/srv/mycity/<env>/media).
 * Local disk only (A6: one server); every caller goes through these functions, so a
 * different store later changes this file and nothing else.
 *
 *   await storage.put("vault/2026/10/<uuid>.pdf", buffer);
 *   const bytes = await storage.get(key);
 *   const { stream, size } = await storage.open(key, { start, end });   // range downloads
 *
 * Rules, each closing a real hole:
 *  - A key is checked twice: a strict character allow-list (no "..", no "\\", no
 *    absolute paths, no NUL) and a resolved-path containment check, so a key built
 *    from request data can never write or read outside MEDIA_ROOT.
 *  - Only binary goes in. A string is refused (it would skip every size check
 *    upstream); a Uint8Array is copied to a Buffer of exactly its own bytes.
 *  - A write is atomic: bytes go to a temporary name in the same folder, then
 *    rename(), so a reader never sees half a file and a crash leaves no partial one.
 *  - Files and folders are created owner-only (0640 / 0750); the API and worker run
 *    as the environment's own user (SYSTEM_ARCHITECTURE §1).
 *  - Nothing here decides who may read a file. Every download route checks access
 *    first (shared/documents/vault.js); this file only moves bytes.
 *
 * A file written before its database row commits and then rolled back is an
 * orphan; services/media/reconcile.js finds those.
 */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { config } = require("../../config/env");
const { AppError } = require("../../shared/errors");

/** Generated reports can be larger than an upload; this is the floor for any one object. */
const MAX_BYTES = 200 * 1024 * 1024;
const KEY_RE = /^[a-z][a-z0-9_-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}){1,8}$/;

function root() {
  return path.resolve(config.MEDIA_ROOT);
}

function badKey() {
  return new AppError("BAD_STORAGE_KEY", "Invalid storage key", 400);
}

/** The key, checked. */
function assertKey(key) {
  const k = String(key ?? "");
  if (!KEY_RE.test(k) || k.includes("..") || k.includes("//")) throw badKey();
  return k;
}

/** Absolute path for a key, proven to sit inside MEDIA_ROOT. */
function absPath(key) {
  const base = root();
  const full = path.resolve(base, assertKey(key));
  if (!full.startsWith(base + path.sep)) throw badKey();
  return full;
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (ArrayBuffer.isView(value) && !(value instanceof DataView))
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

/**
 * Write bytes at `key`, atomically. Overwrites only with `overwrite: true` (an
 * on-demand image derivative); a document master is never overwritten.
 * @returns {Promise<{key: string, bytes: number}>}
 */
async function put(key, value, { overwrite = false } = {}) {
  const buffer = toBuffer(value);
  if (!buffer)
    throw new AppError(
      "BAD_STORAGE_BUFFER",
      "Only binary data can be stored",
      400,
    );
  if (buffer.length > MAX_BYTES)
    throw new AppError("STORAGE_LIMIT", "This file is too large to store", 413);
  const full = absPath(key);
  await fsp.mkdir(path.dirname(full), { recursive: true, mode: 0o750 });
  if (!overwrite && fs.existsSync(full))
    throw new Error(`storage.put: ${key} already exists`);
  const tmp = `${full}.${crypto.randomBytes(6).toString("hex")}.part`;
  try {
    await fsp.writeFile(tmp, buffer, { mode: 0o640 });
    await fsp.rename(tmp, full);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  return { key, bytes: buffer.length };
}

/** Copy a file already on disk (an ffmpeg output) into the store, then remove the source. */
async function putFile(key, sourceAbs, { overwrite = false } = {}) {
  const full = absPath(key);
  const { size } = await fsp.stat(sourceAbs);
  if (size > MAX_BYTES)
    throw new AppError("STORAGE_LIMIT", "This file is too large to store", 413);
  await fsp.mkdir(path.dirname(full), { recursive: true, mode: 0o750 });
  if (!overwrite && fs.existsSync(full))
    throw new Error(`storage.putFile: ${key} already exists`);
  try {
    await fsp.rename(sourceAbs, full);
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
    await fsp.copyFile(sourceAbs, full);
    await fsp.rm(sourceAbs, { force: true });
  }
  await fsp.chmod(full, 0o640).catch(() => {});
  return { key, bytes: size };
}

async function get(key) {
  return fsp.readFile(absPath(key));
}

async function exists(key) {
  try {
    await fsp.access(absPath(key));
    return true;
  } catch {
    return false;
  }
}

/** Size and modification time, or null when missing. */
async function stat(key) {
  try {
    const s = await fsp.stat(absPath(key));
    return { bytes: s.size, modified_at: s.mtime };
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * A read stream over the whole file or a byte range (inclusive end, as in HTTP).
 * @returns {Promise<{stream: import("stream").Readable, size: number}>}
 */
async function open(key, { start, end } = {}) {
  const full = absPath(key);
  const s = await fsp.stat(full).catch((err) => {
    if (err.code === "ENOENT")
      throw new AppError(
        "FILE_MISSING",
        "The file for this document is missing",
        410,
      );
    throw err;
  });
  const opts = start === undefined ? {} : { start, end };
  return { stream: fs.createReadStream(full, opts), size: s.size };
}

/** Move a file between keys (quarantine → vault once a scan is clean). */
async function move(fromKey, toKey) {
  const from = absPath(fromKey);
  const to = absPath(toKey);
  await fsp.mkdir(path.dirname(to), { recursive: true, mode: 0o750 });
  if (fs.existsSync(to))
    throw new Error(`storage.move: ${toKey} already exists`);
  await fsp.rename(from, to);
  return { key: toKey };
}

/** Remove a file. Missing is not an error. Only reconcile, quarantine and derivatives call this. */
async function remove(key) {
  await fsp.rm(absPath(key), { force: true });
}

/**
 * A scratch directory under MEDIA_ROOT/tmp for a tool that needs files on disk
 * (ffmpeg). Same filesystem as the store, so putFile() is a rename.
 * @returns {Promise<{dir: string, cleanup: () => Promise<void>}>}
 */
async function scratch() {
  const base = path.join(root(), "tmp");
  await fsp.mkdir(base, { recursive: true, mode: 0o750 });
  const dir = await fsp.mkdtemp(path.join(base, "job-"));
  return { dir, cleanup: () => fsp.rm(dir, { recursive: true, force: true }) };
}

/** Readiness: MEDIA_ROOT exists and this process can write to it. */
async function health() {
  try {
    await fsp.mkdir(root(), { recursive: true, mode: 0o750 });
    const probe = path.join(root(), `.probe-${process.pid}`);
    await fsp.writeFile(probe, "ok");
    await fsp.rm(probe, { force: true });
    return { status: "up" };
  } catch (err) {
    return { status: "down", error: err.code || "not writable" };
  }
}

module.exports = {
  put,
  putFile,
  get,
  exists,
  stat,
  open,
  move,
  remove,
  scratch,
  health,
  absPath,
  assertKey,
  root,
  MAX_BYTES,
};
