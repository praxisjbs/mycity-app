"use strict";
/**
 * Will mail from our domain be delivered, or land in spam? The DNS half of the answer
 * (MILESTONES §5: SPF, DKIM and DMARC for the mail domain are an M0 server task).
 *
 *   const report = await dnsCheck.checkDomain("mycityapp.io", { selector: "default" });
 *   // { domain, ok, mx, spf, dkim, dmarc }, each { ok, record, problems: [...] }
 *
 * Checks, each a reason real mail goes to spam:
 *  - MX: the domain receives mail (bounces and replies have somewhere to go).
 *  - SPF: exactly one "v=spf1" record (two is a permanent error), ending in -all or ~all
 *    (not +all, which authorises the whole internet), within the 10-lookup limit.
 *  - DKIM: a key published at <selector>._domainkey.<domain>, with a public key (p=).
 *  - DMARC: a "v=DMARC1" record at _dmarc.<domain>, with a policy; p=none is reported as
 *    a warning (monitoring only, protects nothing).
 *
 * Settings, Integrations shows this report; ops runs it after DNS changes.
 */
const dns = require("node:dns").promises;

const LOOKUP_MECHS = /\b(include:|a\b|a:|mx\b|mx:|ptr\b|ptr:|exists:|redirect=)/gi;

async function txt(name) {
  try {
    return (await dns.resolveTxt(name)).map((parts) => parts.join(""));
  } catch (err) {
    if (["ENOTFOUND", "ENODATA", "ENOTIMP"].includes(err.code)) return [];
    throw err;
  }
}

function result(record, problems, warnings = []) {
  return { ok: problems.length === 0, record, problems, warnings };
}

/** SPF from the TXT records of a domain. Pure, for tests. */
function judgeSpf(records) {
  const spf = records.filter((r) => /^v=spf1(\s|$)/i.test(r.trim()));
  if (spf.length === 0) return result(null, ["No SPF record: receivers cannot tell our mail from forgeries"]);
  if (spf.length > 1) return result(spf.join(" | "), ["More than one SPF record: receivers treat that as a permanent error"]);
  const r = spf[0].trim();
  const problems = [];
  const warnings = [];
  if (/\s\+all\b/i.test(r) || /\sall\b/i.test(r.replace(/[-~?]all/i, ""))) problems.push("SPF ends in +all, which lets anyone send as us");
  else if (/\s\?all\b/i.test(r)) warnings.push("SPF ends in ?all (neutral); prefer ~all or -all");
  else if (!/\s[-~]all\b/i.test(r) && !/redirect=/i.test(r)) problems.push("SPF does not end in -all or ~all");
  const lookups = (r.match(LOOKUP_MECHS) || []).length;
  if (lookups > 10) problems.push(`SPF needs ${lookups} DNS lookups; the limit is 10`);
  return result(r, problems, warnings);
}

/** DKIM from the TXT records at the selector. Pure. */
function judgeDkim(records) {
  const r = records.find((x) => /\bp=/.test(x));
  if (!r) return result(null, ["No DKIM key at the selector: mail cannot be signed verifiably"]);
  const p = /\bp=([^;\s]*)/.exec(r);
  if (!p || !p[1]) return result(r, ["The DKIM key is empty (revoked)"]);
  return result(r, []);
}

/** DMARC from the TXT records at _dmarc. Pure. */
function judgeDmarc(records) {
  const d = records.filter((r) => /^v=DMARC1/i.test(r.trim()));
  if (d.length === 0) return result(null, ["No DMARC record: big mail providers increasingly reject or junk such mail"]);
  if (d.length > 1) return result(d.join(" | "), ["More than one DMARC record: receivers ignore them all"]);
  const p = /\bp=(none|quarantine|reject)\b/i.exec(d[0]);
  if (!p) return result(d[0], ["DMARC has no valid policy (p=)"]);
  return result(d[0], [], p[1].toLowerCase() === "none" ? ["DMARC p=none only monitors; move to quarantine once reports are clean"] : []);
}

/**
 * @param {string} domain
 * @param {{selector?: string}} [opts]
 */
async function checkDomain(domain, { selector = "default" } = {}) {
  const d = String(domain || "").trim().toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) throw new Error(`"${domain}" is not a domain`);
  if (!/^[a-z0-9_-]+$/i.test(selector)) throw new Error(`"${selector}" is not a DKIM selector`);
  let mx = [];
  try {
    mx = (await dns.resolveMx(d)).sort((a, b) => a.priority - b.priority);
  } catch (err) {
    if (!["ENOTFOUND", "ENODATA"].includes(err.code)) throw err;
  }
  const [rootTxt, dkimTxt, dmarcTxt] = await Promise.all([txt(d), txt(`${selector}._domainkey.${d}`), txt(`_dmarc.${d}`)]);
  const out = {
    domain: d,
    mx: result(mx.map((m) => `${m.priority} ${m.exchange}`).join(", ") || null, mx.length ? [] : ["No MX record: replies and bounces have nowhere to go"]),
    spf: judgeSpf(rootTxt),
    dkim: judgeDkim(dkimTxt),
    dmarc: judgeDmarc(dmarcTxt),
  };
  out.ok = out.mx.ok && out.spf.ok && out.dkim.ok && out.dmarc.ok;
  return out;
}

/** The domain of an address or "Name <address>". */
function domainOf(from) {
  const m = /@([^>\s]+)>?\s*$/.exec(String(from || ""));
  return m ? m[1].toLowerCase() : null;
}

module.exports = { checkDomain, judgeSpf, judgeDkim, judgeDmarc, domainOf };
