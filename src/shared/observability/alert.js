#!/usr/bin/env node
"use strict";
/**
 * Tell a person: the one way every part of MyCity sends an alert (SYSTEM_ARCHITECTURE §11,
 * docs/runbooks/monitoring.md §2).
 *
 *   const { send } = require("./alert");
 *   await send("MyCity backup FAILED ...", { webhook, whatsapp });
 *
 * Two channels, either or both:
 *   webhook    ALERT_WEBHOOK_URL: a Slack or Google Chat incoming webhook, POSTed {"text": ...}
 *   whatsapp   ALERT_WHATSAPP_URLS: one link per person, separated by spaces, each a GET link of a
 *              WhatsApp gateway with {text} where the message goes, e.g. CallMeBot:
 *              https://api.callmebot.com/whatsapp.php?phone=+2348031234567&apikey=123456&text={text}
 *              Any gateway that sends with one GET link fits (TextMeBot and the like).
 *
 * Used by the API and the worker (observability/error-reporter.js), and with no other file of the
 * repository by the nightly backup and the restore drill on the server (provisioning installs this
 * file as /srv/mycity/bin/mycity-alert) and by the uptime probe in GitHub. So it requires nothing
 * outside Node itself.
 *
 *   mycity-alert --settings=/srv/mycity/prod/shared/.env "text"     the server's tools
 *   ALERT_WEBHOOK_URL=... ALERT_WHATSAPP_URLS=... mycity-alert "text"
 *
 * Rules:
 *  - it never throws and never prints a link: the links carry API keys;
 *  - a WhatsApp message is cut to 900 characters (a gateway's link has a length limit, and a
 *    phone screen is small) and at most 5 go to each person per 10 minutes from one process, so a
 *    burst of faults cannot get a free gateway to block the number; the webhook takes the full text;
 *  - a link without {text}, or not https, is skipped and reported, not guessed at.
 */
const fs = require("node:fs");

const WHATSAPP_MAX_CHARS = 900;
const WHATSAPP_PER_WINDOW = 5;
const WHATSAPP_WINDOW_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 10000;

const sentAt = new Map(); // link → recent send times, this process only

/** The WhatsApp links in a setting, with the ones that cannot work named (by position). */
function parseWhatsapp(value) {
  const links = [];
  const problems = [];
  String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .forEach((link, i) => {
      if (!/^https:\/\//.test(link))
        problems.push(`WhatsApp link ${i + 1} is not https`);
      else if (!link.includes("{text}"))
        problems.push(`WhatsApp link ${i + 1} has no {text}`);
      else links.push(link);
    });
  return { links, problems };
}

/** The message as WhatsApp will get it: at most 900 characters, then URL-encoded. */
function whatsappText(text) {
  const t = String(text);
  const cut =
    t.length > WHATSAPP_MAX_CHARS
      ? `${t.slice(0, WHATSAPP_MAX_CHARS - 1)}…`
      : t;
  return encodeURIComponent(cut);
}

function underCap(key, now) {
  const recent = (sentAt.get(key) || []).filter(
    (t) => now - t < WHATSAPP_WINDOW_MS,
  );
  if (recent.length >= WHATSAPP_PER_WINDOW) {
    sentAt.set(key, recent);
    return false;
  }
  recent.push(now);
  sentAt.set(key, recent);
  return true;
}

/**
 * Send one alert on every channel that is set.
 * @param {string} text
 * @param {{webhook?: string, whatsapp?: string, fetchImpl?: typeof fetch, now?: number}} [channels]
 * @returns {Promise<{sent: number, failed: string[], skipped: string[]}>} never rejects
 */
async function send(
  text,
  { webhook = "", whatsapp = "", fetchImpl = fetch, now = Date.now() } = {},
) {
  const out = { sent: 0, failed: [], skipped: [] };
  const jobs = [];
  if (webhook) {
    jobs.push(
      fetchImpl(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: String(text) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
        .then((r) =>
          r.ok
            ? (out.sent += 1)
            : out.failed.push(`webhook answered ${r.status}`),
        )
        .catch((e) =>
          out.failed.push(
            `webhook: ${e.name === "TimeoutError" ? "no answer" : "unreachable"}`,
          ),
        ),
    );
  }
  const { links, problems } = parseWhatsapp(whatsapp);
  out.skipped.push(...problems);
  links.forEach((link, i) => {
    if (!underCap(link, now)) {
      out.skipped.push(
        `WhatsApp ${i + 1}: more than ${WHATSAPP_PER_WINDOW} in 10 minutes`,
      );
      return;
    }
    jobs.push(
      fetchImpl(link.split("{text}").join(whatsappText(text)), {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
        .then((r) =>
          r.ok
            ? (out.sent += 1)
            : out.failed.push(`WhatsApp ${i + 1} answered ${r.status}`),
        )
        .catch((e) =>
          out.failed.push(
            `WhatsApp ${i + 1}: ${e.name === "TimeoutError" ? "no answer" : "unreachable"}`,
          ),
        ),
    );
  });
  await Promise.all(jobs);
  return out;
}

/** The two settings from a file of KEY=value lines (an environment's .env). */
function channelsFromFile(file) {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { webhook: "", whatsapp: "" };
  }
  const value = (key) => {
    const hit = text
      .split(/\r?\n/)
      .filter((l) => l.startsWith(`${key}=`))
      .pop();
    return hit ? hit.slice(key.length + 1).trim() : "";
  };
  return {
    webhook: value("ALERT_WEBHOOK_URL"),
    whatsapp: value("ALERT_WHATSAPP_URLS"),
  };
}

/** One line for a log saying what happened, without any link. */
function summary(r) {
  if (!r.sent && !r.failed.length && !r.skipped.length)
    return "no alert channel set: nobody was told";
  return [
    `alert sent to ${r.sent} channel(s)`,
    ...r.failed.map((f) => `failed: ${f}`),
    ...r.skipped.map((s) => `skipped: ${s}`),
  ].join("; ");
}

async function main(argv) {
  const fileArg = argv.find((a) => a.startsWith("--settings="));
  const text = argv
    .filter((a) => !a.startsWith("--settings="))
    .join(" ")
    .trim();
  if (!text) {
    console.error('usage: mycity-alert [--settings=<.env>] "text"');
    return 2;
  }
  const channels = fileArg
    ? channelsFromFile(fileArg.slice("--settings=".length))
    : {
        webhook: process.env.ALERT_WEBHOOK_URL || "",
        whatsapp: process.env.ALERT_WHATSAPP_URLS || "",
      };
  const r = await send(text, channels);
  console.log(summary(r));
  return r.sent > 0 && !r.failed.length ? 0 : 1;
}

if (require.main === module)
  main(process.argv.slice(2)).then((code) => process.exit(code));

function __reset() {
  sentAt.clear();
}

module.exports = {
  send,
  parseWhatsapp,
  whatsappText,
  channelsFromFile,
  summary,
  WHATSAPP_MAX_CHARS,
  __reset,
};
