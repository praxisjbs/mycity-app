/**
 * The whole deliverability picture for one sending domain, as the rows the
 * Settings screen shows and stores: MX, SPF, DKIM, DMARC for the domain, and PTR
 * and RBL standing for the IP our relay sends from.
 *
 *   const { rows } = await check.checkOne("mycityapp.io", { smtpHost: config.SMTP_HOST });
 *
 * Storing the rows, and telling the CEO when a record that passed now fails
 * (evaluate.regression), is the Settings module's job (M9): this file only looks.
 */
"use strict";

const dns = require("dns/promises");
const { config } = require("../../../config/env");
const dnsCheck = require("./dns-check");
const { checkRbl, hostsFrom } = require("./rbl");
const { checkPtr } = require("./ptr");
const { toRow } = require("./evaluate");

async function resolveIpv4(host) {
  if (!host) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  try {
    const addrs = await dns.resolve4(host);
    return addrs[0] || null;
  } catch {
    return null;
  }
}

/**
 * @param {string} domain
 * @param {{smtpHost?: string|null, ip?: string|null}} [opts]
 * @returns {Promise<{domain: string, rows: object[], checked_at: string}>}
 */
async function checkOne(domain, { smtpHost = config.SMTP_HOST || null, ip = null } = {}) {
  const base = await dnsCheck.checkDomain(domain, { smtpHost });
  const sendingIp = ip || (await resolveIpv4(smtpHost));
  const ptr = sendingIp ? await checkPtr(sendingIp) : { ok: null, hint: "No sending IP to check PTR against." };
  const rbl = sendingIp
    ? await checkRbl(sendingIp, { hosts: hostsFrom(config.MAIL_RBL_HOSTS) })
    : { ok: null, hint: "No sending IP to check RBLs against." };

  const rows = [
    toRow(base.domain, "MX", base.mx),
    toRow(base.domain, "SPF", base.spf),
    toRow(base.domain, "DKIM", base.dkim, { selector: base.dkim && base.dkim.selector }),
    toRow(base.domain, "DMARC", base.dmarc),
    toRow(base.domain, "PTR", ptr),
    toRow(base.domain, "RBL", rbl),
  ];
  return { domain: base.domain, rows, checked_at: base.checked_at };
}

/** The domain system mail is sent as (MAIL_FROM), checked. */
function checkSender() {
  const domain = dnsCheck.senderDomain(config.MAIL_FROM);
  if (!domain) throw new Error("MAIL_FROM has no domain");
  return checkOne(domain);
}

module.exports = { checkOne, checkSender };
