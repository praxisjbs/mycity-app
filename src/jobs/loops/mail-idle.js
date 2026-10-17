"use strict";
/**
 * IMAP IDLE: up to MAILBOX_IDLE_MAX connected mailboxes held open on their inbox, so new
 * mail is fetched when it arrives instead of at the next sync (mailbox.md §7). The host
 * allows 30 connections per IP for production and staging together, so production holds
 * at most 24 here and staging none (mailbox.md §6); every other mailbox waits for the
 * scheduled sync. A dropped connection is reopened after 15 seconds.
 */
const { pool } = require("../../config/db");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const queues = require("../queues");

const RETRY_MS = 15_000;
const RESCAN_MS = 5 * 60_000;

/**
 * @returns {{stop: () => Promise<void>, size: () => number}}
 */
function start({ max = config.MAILBOX_IDLE_MAX } = {}) {
  const open = new Map();
  let stopped = false;
  if (!max) return { stop: async () => undefined, size: () => 0 };

  const repo = require("../../modules/mailbox/mailbox.repo");
  const encryption = require("../../services/secrets/encryption.service");
  const { ImapSmtpProvider } = require("../../modules/mailbox/providers/imap-smtp.provider");

  async function watch(id) {
    if (stopped || open.has(id) || open.size >= max) return;
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
    open.set(id, client);
    const reopen = () => {
      open.delete(id);
      if (!stopped) setTimeout(() => watch(id).catch(() => undefined), RETRY_MS).unref();
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
      open.delete(id);
    }
  }

  async function scan() {
    if (stopped) return;
    try {
      for (const id of await repo.syncable(pool)) await watch(id);
    } catch (err) {
      logger.warn({ err: err.message }, "mail idle scan failed");
    }
  }
  scan();
  const timer = setInterval(scan, RESCAN_MS);
  timer.unref();

  return {
    size: () => open.size,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await Promise.allSettled([...open.values()].map((c) => c.logout()));
      open.clear();
    },
  };
}

module.exports = { start };
