"use strict";
/**
 * Where a company address's mail server is (mailbox.md §3 step 1). MyCity's mail is on a
 * cPanel host reached at the address's own domain for IMAP on 993 and SMTP on 465, both over
 * TLS, signed in with the full address: its certificate is issued to `mycityapp.io`, so
 * `mail.mycityapp.io` fails the check (docs/runbooks/dns-and-mail.md §4). Consumer mail (Google,
 * Microsoft) no longer takes a password over IMAP, so those addresses are refused rather
 * than tried. MAIL_IMAP_HOST and MAIL_SMTP_HOST, when set, name the host for every
 * address, for a host whose certificate is issued to another name.
 */
const { AppError } = require("../../shared/errors");

const CONSUMER =
  /^(gmail\.com|googlemail\.com|outlook\.com|hotmail\.com|live\.com|msn\.com|yahoo\.com|icloud\.com)$/i;

function domainOf(address) {
  return String(address || "")
    .split("@")
    .pop()
    .trim()
    .toLowerCase();
}

/**
 * @param {string} address
 * @param {{MAIL_IMAP_HOST?: string, MAIL_SMTP_HOST?: string, MAIL_IMAP_PORT?: number, MAIL_SMTP_PORT?: number}} [env]
 */
function settingsFor(address, env = {}) {
  const domain = domainOf(address);
  if (!domain || !domain.includes(".")) {
    throw new AppError("NOT_AN_EMAIL", "That is not an email address", 422, {
      email: ["Not an email address"],
    });
  }
  if (CONSUMER.test(domain)) {
    throw new AppError(
      "PROVIDER_NOT_SUPPORTED",
      "Use your company address",
      422,
      { email: ["Use your company address"] },
    );
  }
  return {
    incoming_protocol: "imap",
    incoming_host: env.MAIL_IMAP_HOST || domain,
    incoming_port: Number(env.MAIL_IMAP_PORT) || 993,
    outgoing_host: env.MAIL_SMTP_HOST || domain,
    outgoing_port: Number(env.MAIL_SMTP_PORT) || 465,
    username: String(address).trim().toLowerCase(),
    tls: true,
  };
}

module.exports = { domainOf, settingsFor };
