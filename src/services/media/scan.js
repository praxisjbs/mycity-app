"use strict";
/**
 * Virus scanning for files strangers send: CVs, candidate documents, signed offers
 * (M4, M5). Staff never open a stranger's file before it has been scanned clean
 * (BACKEND_STRUCTURE §5.2).
 *
 *   const result = await scan.scanFile(storage.absPath(key));
 *   // { clean: true } | { clean: false, signature: "Eicar-Test-Signature" }
 *
 * Talks to clamd (installed by ops/provision) with its INSTREAM command: the bytes
 * are streamed in chunks over the socket, so clamd needs no access to our files.
 * CLAMD_SOCKET when set, otherwise CLAMD_HOST:CLAMD_PORT.
 *
 * clamd being down, slow or confused is an ERROR, never a pass: the scan job throws,
 * the outbox retries, and the file stays in quarantine meanwhile. A scanner that
 * fails open is the same as no scanner.
 */
const fs = require("node:fs");
const net = require("node:net");
const { config } = require("../../config/env");

const CHUNK = 64 * 1024;
const TIMEOUT_MS = 60_000;

function connect() {
  return config.CLAMD_SOCKET ? net.createConnection({ path: config.CLAMD_SOCKET }) : net.createConnection({ host: config.CLAMD_HOST, port: config.CLAMD_PORT });
}

/** Parse clamd's one-line answer: "stream: OK" or "stream: <name> FOUND". */
function parseReply(reply) {
  const text = String(reply).replace(/\0/g, "").trim();
  if (/:\s*OK$/.test(text)) return { clean: true };
  const found = /:\s*(.+)\s+FOUND$/.exec(text);
  if (found) return { clean: false, signature: found[1].trim() };
  throw new Error(`clamd answered "${text.slice(0, 200)}"`);
}

/**
 * Stream a readable to clamd and return its verdict.
 * @param {import("stream").Readable} input
 * @returns {Promise<{clean: boolean, signature?: string}>}
 */
function scanStream(input) {
  return new Promise((resolve, reject) => {
    const sock = connect();
    let reply = "";
    let settled = false;
    const done = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      input.destroy();
      fn(v);
    };
    const timer = setTimeout(() => done(reject, new Error("clamd did not answer in time")), TIMEOUT_MS);

    sock.on("error", (err) => done(reject, new Error(`clamd is not reachable: ${err.message}`)));
    sock.on("data", (d) => {
      reply += d;
    });
    sock.on("end", () => {
      try {
        done(resolve, parseReply(reply));
      } catch (err) {
        done(reject, err);
      }
    });
    sock.on("connect", () => {
      sock.write("zINSTREAM\0");
      input.on("data", (chunk) => {
        for (let i = 0; i < chunk.length; i += CHUNK) {
          const part = chunk.subarray(i, i + CHUNK);
          const size = Buffer.alloc(4);
          size.writeUInt32BE(part.length, 0);
          sock.write(size);
          sock.write(part);
        }
      });
      input.on("error", (err) => done(reject, err));
      input.on("end", () => sock.write(Buffer.alloc(4)));
    });
  });
}

/** Scan a file on disk. */
function scanFile(absPath) {
  return scanStream(fs.createReadStream(absPath, { highWaterMark: CHUNK }));
}

/** Scan bytes in memory. */
function scanBuffer(buffer) {
  const { Readable } = require("node:stream");
  return scanStream(Readable.from([buffer]));
}

/** Readiness: clamd answers PING. Degraded, not down: only public uploads wait on it. */
function health() {
  return new Promise((resolve) => {
    const sock = connect();
    const timer = setTimeout(() => {
      sock.destroy();
      resolve({ status: "degraded", error: "clamd did not answer" });
    }, 3000);
    let reply = "";
    sock.on("connect", () => sock.write("zPING\0"));
    sock.on("data", (d) => {
      reply += d;
    });
    sock.on("error", (err) => {
      clearTimeout(timer);
      resolve({ status: "degraded", error: err.code || "unreachable" });
    });
    sock.on("end", () => {
      clearTimeout(timer);
      resolve(reply.replace(/\0/g, "").trim() === "PONG" ? { status: "up" } : { status: "degraded", error: "unexpected reply" });
    });
  });
}

module.exports = { scanFile, scanBuffer, scanStream, parseReply, health };
