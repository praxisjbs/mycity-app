"use strict";
/**
 * Can this server actually hand mail to the SMTP relay? The network half of
 * deliverability: the DNS can be perfect and mail still never leave, because the
 * provider blocks port 25/587 outbound, the relay refuses our login, or TLS fails.
 *
 *   const report = await routeCheck.check();
 *   // { ok, host, port, connected, tls, authenticated, ms, error }
 *
 * Connects, upgrades to TLS (STARTTLS on 587, TLS from the first byte on 465), logs in
 * when an account is configured, and disconnects. Sends nothing. Run from Settings,
 * Integrations and by ops after a server or provider change; the result also explains a
 * degraded "mail" line on /api/health/ready.
 */
const nodemailer = require("nodemailer");
const { config } = require("../../../config/env");
const dnsCheck = require("./dns-check");

/**
 * @param {{host?: string, port?: number, secure?: boolean, user?: string, password?: string}} [over]
 *   test another relay before saving it; defaults are this environment's settings
 */
async function check(over = {}) {
  const host = over.host || config.SMTP_HOST;
  const port = over.port || config.SMTP_PORT;
  const secure = over.secure === undefined ? config.SMTP_SECURE : over.secure;
  const user = over.user === undefined ? config.SMTP_USER : over.user;
  const pass = over.password === undefined ? config.SMTP_PASSWORD : over.password;
  if (!host) return { ok: false, host: null, port, error: "SMTP_HOST is not set" };

  const started = Date.now();
  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    auth: user ? { user, pass } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  try {
    await transport.verify();
    return { ok: true, host, port, connected: true, tls: true, authenticated: Boolean(user), ms: Date.now() - started, error: null };
  } catch (err) {
    const code = err.code || "";
    return {
      ok: false,
      host,
      port,
      connected: !["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS"].includes(code),
      tls: code !== "ETLS",
      authenticated: code === "EAUTH" ? false : null,
      ms: Date.now() - started,
      error: explain(code, err.message),
    };
  } finally {
    transport.close();
  }
}

function explain(code, message) {
  switch (code) {
    case "EAUTH":
      return "The relay refused the login. Check SMTP_USER and SMTP_PASSWORD.";
    case "ETLS":
      return "TLS failed. The relay must offer STARTTLS on 587, or use SMTP_SECURE on 465.";
    case "ETIMEDOUT":
    case "ECONNECTION":
    case "ESOCKET":
      return "Could not reach the relay. The hosting provider may block the port outbound.";
    case "EDNS":
      return "The relay's host name does not resolve.";
    default:
      return String(message || code).slice(0, 200);
  }
}

/** Both halves: the relay route and the From domain's DNS. */
async function fullReport() {
  const domain = dnsCheck.domainOf(config.MAIL_FROM);
  const [route, dnsReport] = await Promise.all([check(), domain ? dnsCheck.checkDomain(domain, { selector: config.DKIM_SELECTOR }) : null]);
  return { ok: Boolean(route.ok && dnsReport && dnsReport.ok), from: config.MAIL_FROM, route, dns: dnsReport };
}

module.exports = { check, fullReport, explain };
