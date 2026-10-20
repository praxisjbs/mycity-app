"use strict";
/**
 * The connections on Settings · Integrations, each defined once
 * (docs/guides/integrations.md §3 step 1, §6.3). Settings · Integrations lists what this
 * holds, in this order; a connection gets its database row the first time it is saved,
 * checked or used, so adding one here needs no migration.
 *
 * A definition says:
 *
 *   code, provider   the connection (integration_connection.code) and its kind
 *   name, group      what the page calls it and where it groups it
 *   secrets          its secret fields: `hint` is what a person may see of a saved one
 *                    ("last4" of a key, "none" of a password, "key_id" of a key pair)
 *   destination      fields that say where a secret is sent: changing one needs the secret
 *                    typed again, so a saved password is never handed to a new server
 *   keptHere         secrets read from the database even when nothing is saved (a key
 *                    pair the app makes for itself)
 *   watched          the worker tests it every 15 minutes, because its test costs nothing
 *   units            what one call of each kind counts toward the daily limit
 *   limited          whether a daily limit applies (it counts the units above)
 *   fromFile(config) the server file's values and secrets, or null when the file has none
 *   fromSaved(conf)  a saved configuration as the values the code uses, defaults filled
 *   toConfiguration(body) what a save keeps in integration_connection.configuration
 *
 * How each connection is tested is the integrations module's (integrations.testers.js);
 * what a value means to its consumer stays with the consumer.
 */

/** Lagos's own address search bias and map centre, for Geoapify's test. */
const LAGOS = Object.freeze({ lat: 6.4281, lon: 3.4216, address: "Admiralty Way, Lekki, Lagos" });

const nul = (v) => (v === undefined || v === "" ? null : v);

const PROVIDERS = Object.freeze([
  Object.freeze({
    code: "mail_sender",
    provider: "smtp",
    name: "System Sender",
    group: "mail",
    secrets: Object.freeze([{ key: "password", hint: "none" }]),
    destination: Object.freeze(["host", "port", "username"]),
    keptHere: Object.freeze([]),
    watched: true,
    units: Object.freeze({ send: 1 }),
    limited: false,
    fromFile: (c) =>
      c.SMTP_HOST
        ? {
            values: {
              host: c.SMTP_HOST,
              port: c.SMTP_PORT,
              security: c.SMTP_SECURE ? "tls" : "starttls",
              username: nul(c.SMTP_USER),
              from: c.MAIL_FROM,
              reply_to: nul(c.MAIL_REPLY_TO),
              // 0 sends unpaced: a laptop's file only (config/env.js).
              per_hour: c.MAIL_SEND_PER_HOUR || null,
              local_domains: nul(c.SMTP_LOCAL_DOMAINS),
            },
            secrets: { password: nul(c.SMTP_PASSWORD) },
          }
        : null,
    fromSaved: (s) => ({
      host: s.host,
      port: s.port,
      security: s.security === "starttls" ? "starttls" : "tls",
      username: nul(s.username),
      from: s.from,
      reply_to: nul(s.reply_to),
      per_hour: s.per_hour,
      // The domains whose mailboxes are on this server, behind its spam-filter MX: delivered
      // there without the route check (services/mail/deliverability/route-check.js).
      local_domains: nul(s.local_domains),
    }),
    toConfiguration: (b) => ({
      host: b.host,
      port: b.port,
      security: b.security,
      username: b.username ?? null,
      from: b.from,
      reply_to: b.reply_to ?? null,
      per_hour: b.per_hour,
      local_domains: b.local_domains ?? null,
    }),
  }),

  Object.freeze({
    code: "mailbox_server",
    provider: "imap_smtp",
    name: "Staff Mail Server",
    group: "mail",
    secrets: Object.freeze([]),
    destination: Object.freeze([]),
    keptHere: Object.freeze([]),
    watched: true,
    units: Object.freeze({ sync: 1, send: 1 }),
    limited: false,
    // Always has values: the file's defaults are each address's own domain on 993 and 465.
    fromFile: (c) => ({
      values: {
        imap_host: nul(c.MAILBOX_IMAP_HOST),
        imap_port: c.MAILBOX_IMAP_PORT,
        smtp_host: nul(c.MAILBOX_SMTP_HOST),
        smtp_port: c.MAILBOX_SMTP_PORT,
        per_person_per_hour: c.MAILBOX_SEND_PER_HOUR,
        sync_every_min: c.MAILBOX_SYNC_EVERY_MIN,
        live_connections: c.MAILBOX_IDLE_MAX,
        // Off only for a local test server, and only in the file (guide §1.1).
        tls: c.MAILBOX_TLS !== false,
      },
      secrets: {},
    }),
    fromSaved: (s) => ({
      imap_host: nul(s.imap_host),
      imap_port: s.imap_port,
      smtp_host: nul(s.smtp_host),
      smtp_port: s.smtp_port,
      per_person_per_hour: s.per_person_per_hour,
      sync_every_min: s.sync_every_min,
      live_connections: s.live_connections,
      tls: true,
    }),
    toConfiguration: (b) => ({
      imap_host: b.imap_host ?? null,
      imap_port: b.imap_port,
      smtp_host: b.smtp_host ?? null,
      smtp_port: b.smtp_port,
      per_person_per_hour: b.per_person_per_hour,
      sync_every_min: b.sync_every_min,
      live_connections: b.live_connections,
    }),
  }),

  Object.freeze({
    code: "geoapify",
    provider: "geoapify",
    name: "Geoapify",
    group: "maps",
    secrets: Object.freeze([{ key: "api_key", hint: "last4" }]),
    destination: Object.freeze([]),
    keptHere: Object.freeze([]),
    watched: false,
    // Geoapify's credits: a search or a lookup is one, four map tiles are one.
    units: Object.freeze({ search: 1, reverse: 1, tile: 0.25 }),
    limited: true,
    fromFile: (c) => (c.GEOAPIFY_API_KEY ? { values: {}, secrets: { api_key: c.GEOAPIFY_API_KEY } } : null),
    fromSaved: () => ({}),
    toConfiguration: () => ({}),
  }),

  Object.freeze({
    code: "gemini",
    provider: "gemini",
    name: "Gemini",
    group: "ai",
    secrets: Object.freeze([{ key: "api_key", hint: "last4" }]),
    destination: Object.freeze([]),
    keptHere: Object.freeze([]),
    watched: false,
    units: Object.freeze({ call: 1 }),
    limited: true,
    fromFile: (c) => (c.GEMINI_API_KEY ? { values: {}, secrets: { api_key: c.GEMINI_API_KEY } } : null),
    fromSaved: () => ({}),
    toConfiguration: () => ({}),
  }),

  Object.freeze({
    code: "web_push",
    provider: "web_push",
    name: "Web Push",
    group: "notifications",
    // The pair the app made, or Replace Keys made: JSON { publicKey, privateKey }.
    secrets: Object.freeze([{ key: "vapid", hint: "key_id" }]),
    destination: Object.freeze([]),
    keptHere: Object.freeze(["vapid"]),
    watched: false,
    units: Object.freeze({ push: 1 }),
    limited: false,
    fromFile: (c) => ({
      values: { subject: c.VAPID_SUBJECT },
      secrets: {
        vapid:
          c.VAPID_PUBLIC_KEY && c.VAPID_PRIVATE_KEY
            ? JSON.stringify({ publicKey: c.VAPID_PUBLIC_KEY, privateKey: c.VAPID_PRIVATE_KEY })
            : null,
      },
    }),
    fromSaved: (s) => ({ subject: s.subject }),
    toConfiguration: (b) => ({ subject: b.subject }),
  }),
]);

const BY_CODE = new Map(PROVIDERS.map((p) => [p.code, p]));

/** The definition of one connection; throws for a code the registry does not hold. */
function get(code) {
  const def = BY_CODE.get(code);
  if (!def) throw new Error(`integrations: no connection "${code}"`);
  return def;
}

const has = (code) => BY_CODE.has(code);

/** What integration_secret's AAD says for one secret (encryption.service `aad`). */
const aadOf = (code, key) => `integration_secret:${code}:${key}`;

module.exports = { PROVIDERS, get, has, aadOf, LAGOS };
