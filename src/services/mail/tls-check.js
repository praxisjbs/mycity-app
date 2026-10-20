"use strict";
/**
 * Is a mail server there, speaking TLS, with a certificate for its name? Settings ·
 * Integrations' test of the staff mail server (docs/guides/integrations.md §6.3): the IMAP
 * and SMTP hosts every mailbox uses, checked without anybody's password.
 *
 *   await tlsCheck.check({ host: "mycityapp.io", port: 993, protocol: "imap" });
 *   // → { greeting: "* OK ..." }    or throws, with err.code naming what failed
 *
 * TLS from the first byte on 993 (IMAP) and 465 (SMTP); on any other port the server is
 * asked to start TLS (STARTTLS) after its greeting. The certificate is checked against the
 * host, exactly as the mailbox's own connections check it. `tls: false` (a local test
 * server named in the server file only) reads the greeting in clear.
 *
 * The greeting is read and the connection closed: nothing is signed in to and nothing sent
 * beyond EHLO and STARTTLS. Never throws past `timeoutMs`.
 */
const net = require("node:net");
const tls = require("node:tls");

const IMPLICIT = { imap: 993, smtp: 465 };

class TlsCheckError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "TlsCheckError";
    this.code = code;
  }
}

/** The first complete reply line(s) the server sends, per protocol. */
function waitFor(socket, test, timeoutMs, what) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const done = (err, value) => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
      if (err) reject(err);
      else resolve(value);
    };
    const onData = (chunk) => {
      buf += chunk.toString("utf8");
      if (buf.length > 8192) return done(new TlsCheckError(`${what}: reply too long`, "UNAVAILABLE"));
      const verdict = test(buf);
      if (verdict === true) done(null, buf.trim().split(/\r?\n/)[0].slice(0, 200));
      else if (verdict === false) done(new TlsCheckError(`${what}: ${buf.trim().slice(0, 200)}`, "UNAVAILABLE"));
    };
    const onError = (err) => done(err);
    const onClose = () => done(new TlsCheckError(`${what}: the server closed the connection`, "UNAVAILABLE"));
    const timer = setTimeout(() => done(new TlsCheckError(`${what}: no answer in time`, "NO_ANSWER")), timeoutMs);
    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onClose);
  });
}

/** A whole reply: SMTP's last line is "NNN " (a space after the code); IMAP's ends in CRLF. */
const smtpReply = (ok) => (buf) => {
  const lines = buf.split(/\r?\n/).filter(Boolean);
  const last = lines[lines.length - 1] || "";
  if (!/^\d{3} /.test(last) || !/\r?\n$/.test(buf)) return undefined;
  return ok(Number(last.slice(0, 3)));
};
const imapLine = (pattern) => (buf) => {
  if (!/\r?\n/.test(buf)) return undefined;
  return pattern.test(buf) ? true : /^(\* BYE|\S+ (NO|BAD))/im.test(buf) ? false : undefined;
};

const greetingOf = (protocol) =>
  protocol === "imap" ? imapLine(/^\* (OK|PREAUTH)/im) : smtpReply((code) => code === 220);

function connectPlain(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new TlsCheckError("no answer on the port", "NO_ANSWER"));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function connectTls({ host, port, socket }, timeoutMs) {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host, port, socket, servername: host, rejectUnauthorized: true });
    const timer = setTimeout(() => {
      s.destroy();
      reject(new TlsCheckError("no answer on the port", "NO_ANSWER"));
    }, timeoutMs);
    s.once("secureConnect", () => {
      clearTimeout(timer);
      resolve(s);
    });
    s.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** What a failure means on screen (contract StepCode). */
function codeOf(err) {
  if (err instanceof TlsCheckError) return err.code;
  const code = String((err && err.code) || "");
  const message = String((err && err.message) || "");
  // nodemailer wraps a socket's error in its own code and keeps the cause in the message.
  if (/ENOTFOUND|EAI_AGAIN/.test(code) || /getaddrinfo|ENOTFOUND|EAI_AGAIN/.test(message)) return "SERVER_NOT_FOUND";
  const unanswered = /ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|ECONNRESET/;
  if (unanswered.test(code) || unanswered.test(message)) return "NO_ANSWER";
  if (code === "ERR_TLS_CERT_ALTNAME_INVALID" || /does not match certificate/i.test(message)) return "CERTIFICATE_MISMATCH";
  if (/CERT|SSL|TLS|EPROTO|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code) || /certificate|ssl|tls/i.test(message)) return "TLS_FAILED";
  return "UNAVAILABLE";
}

/**
 * @param {{host: string, port: number, protocol: "imap"|"smtp", tls?: boolean, timeoutMs?: number}} req
 * @returns {Promise<{greeting: string}>}
 */
async function check({ host, port, protocol, tls: secure = true, timeoutMs = 10_000 }) {
  if (protocol !== "imap" && protocol !== "smtp") throw new Error(`tls-check: protocol is imap or smtp, got ${protocol}`);
  const deadline = Date.now() + timeoutMs;
  const left = () => Math.max(500, deadline - Date.now());
  let socket = null;
  try {
    if (secure && Number(port) === IMPLICIT[protocol]) {
      socket = await connectTls({ host, port }, left());
      return { greeting: await waitFor(socket, greetingOf(protocol), left(), "greeting") };
    }
    socket = await connectPlain(host, port, left());
    const greeting = await waitFor(socket, greetingOf(protocol), left(), "greeting");
    if (!secure) return { greeting };
    if (protocol === "imap") {
      socket.write("a1 STARTTLS\r\n");
      await waitFor(socket, imapLine(/^a1 OK/im), left(), "STARTTLS");
    } else {
      socket.write("EHLO mycity-check\r\n");
      await waitFor(socket, smtpReply((code) => code === 250), left(), "EHLO");
      socket.write("STARTTLS\r\n");
      await waitFor(socket, smtpReply((code) => code === 220), left(), "STARTTLS");
    }
    socket = await connectTls({ host, port, socket }, left());
    return { greeting };
  } catch (err) {
    const e = err instanceof TlsCheckError ? err : new TlsCheckError(String((err && err.message) || err), codeOf(err));
    throw e;
  } finally {
    if (socket) socket.destroy();
  }
}

module.exports = { check, codeOf, TlsCheckError, IMPLICIT };
