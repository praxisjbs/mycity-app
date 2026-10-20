"use strict";
/**
 * IMAP IDLE: connected mailboxes held open on their inbox, so new mail is fetched when it
 * arrives instead of at the next sync (mailbox.md §7). The host allows 30 connections per IP
 * for production and staging together, so each holds at most its live connections (24 and 4
 * by default, mailbox.md §6); every other mailbox waits for the scheduled sync. A dropped
 * connection is reopened after 15 seconds.
 *
 * The limit is the staff mail server's (Settings · Integrations, else MAILBOX_IDLE_MAX;
 * docs/guides/integrations.md §6.7), read every 30 seconds with the hosts the accounts are
 * on. So a change applies without restarting the worker: a lower limit closes connections
 * at once, a higher one opens more, and a mailbox moved to another server (§3 step 8) is
 * closed and opened again there.
 */
const { pool } = require("../../config/db");
const { logger } = require("../../config/logger");
const queues = require("../queues");

const RETRY_MS = 15_000;
const SCAN_MS = 30_000;

/**
 * @param {{max?: number}} [opts]  max: a fixed limit (tests); otherwise the staff mail server's
 * @returns {{stop: () => Promise<void>, size: () => number, scan: () => Promise<void>}}
 */
function start({ max } = {}) {
  /** mail_account_id -> { client, at: "host|port|tls" the connection was opened on } */
  const open = new Map();
  let stopped = false;
  let limit = 0;

  const repo = require("../../modules/mailbox/mailbox.repo");
  const encryption = require("../../services/secrets/encryption.service");
  const integrations = require("../../shared/integrations/settings");
  const { ImapSmtpProvider } = require("../../modules/mailbox/providers/imap-smtp.provider");

  const placeOf = (a) => `${a.incoming_host}|${a.incoming_port}|${a.tls !== false}`;

  async function close(id) {
    const held = open.get(id);
    if (!held) return;
    open.delete(id);
    held.closing = true;
    await held.client.logout().catch(() => held.client.close && held.client.close());
  }

  async function watch(id) {
    if (stopped || open.has(id) || open.size >= limit) return;
    const a = await repo.accountById(pool, id);
    if (!a || a.status !== "connected") return;
    const secret = await repo.secretOf(pool, a.integration_secret_id);
    if (!secret || !secret.ciphertext) return;
    const inbox = await repo.folderOfKind(pool, id, "inbox");
    const client = new ImapSmtpProvider({
      email: String(a.email),
      username: a.username,
      password: encryption.decrypt(secret.ciphertext),
      incoming_host: a.incoming_host,
      incoming_port: a.incoming_port,
      tls: a.tls,
    }).imap();
    const held = { client, at: placeOf(a), closing: false };
    open.set(id, held);
    const reopen = () => {
      if (open.get(id) === held) open.delete(id);
      if (!stopped && !held.closing) setTimeout(() => watch(id).catch(() => undefined), RETRY_MS).unref();
    };
    client.on("exists", () => {
      queues.enqueue("mail-sync", "sync", { mail_account_id: id }, { jobId: `mail-sync-idle-${id}-${Date.now()}` }).catch(() => undefined);
    });
    client.on("close", reopen);
    client.on("error", (err) => logger.warn({ err: err.message, mail_account_id: id }, "mail idle connection error"));
    try {
      await client.connect();
      await client.mailboxOpen(inbox ? inbox.remote_key : "INBOX");
    } catch (err) {
      logger.warn({ err: err.message, mail_account_id: id }, "mail idle could not open the inbox");
      if (open.get(id) === held) open.delete(id);
    }
  }

  /** Bring the open connections in line with the limit and the accounts' current hosts. */
  async function scan() {
    if (stopped) return;
    try {
      const n = Number((await integrations.of("mailbox_server")).values.live_connections);
      limit = max ?? (Number.isFinite(n) ? n : 0);
      if (limit === 0 && open.size === 0) return; // laptops and CI hold none
      const accounts = (await repo.movable(pool)).filter((a) => a.status === "connected");
      const now = new Map(accounts.map((a) => [a.mail_account_id, placeOf(a)]));
      for (const [id, held] of [...open]) {
        if (now.get(id) !== held.at) await close(id); // disconnected, refused, or moved server
      }
      while (open.size > limit) await close([...open.keys()].pop());
      for (const a of accounts) await watch(a.mail_account_id);
    } catch (err) {
      logger.warn({ err: err.message }, "mail idle scan failed");
    }
  }
  scan();
  const timer = setInterval(scan, SCAN_MS);
  timer.unref();

  return {
    size: () => open.size,
    scan,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await Promise.allSettled([...open.keys()].map((id) => close(id)));
      open.clear();
    },
  };
}

module.exports = { start };
