"use strict";
/**
 * What the assistant may do with mail, and nothing it may read (docs/guides/mailbox.md §9;
 * docs/guides/praxis-ai.md §6.11, decision 19): mail is private correspondence, so this
 * manifest declares no read and no summary. The one action is a mail the person sends: the
 * assistant writes it from the person's words and the records read, the card shows it whole,
 * and the press saves it as a draft and queues it exactly as Send does, the person's signature
 * baked in, from their own connected mailbox. No mailbox connected is a refusal at the press.
 * A reply inside a conversation stays Write With AI in the composer (mailbox.assist.js).
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const service = require("./mailbox.service");

module.exports = defineManifest({
  module: "mailbox",
  actions: [
    {
      key: "mail.send",
      label: "Send Mail",
      description: "Send an email from my mailbox: to, cc, subject and the words, written from what I said",
      input: c.mailbox.MailCompose,
      permission: ["mailbox", "create"],
      risk: "standard",
      // The composer's form is the editor's own (addresses, a rich body, files); the card is the words alone.
      form: "none: the composer takes addresses, a rich body and files in its own editor; the card is the words alone",
      records: () => [],
      check: (client, _values, actor) => service.assertConnected(client, actor),
      run: (values, actor, ctx) => service.sendNew(values, actor, ctx && ctx.idempotency_key ? `ai:${ctx.idempotency_key}` : null),
      readback: (q) => [{ type: "mail_send_queue", id: q.mail_send_queue_id, label: "Mail queued", status: "queued", link: routeMap.screenPath("mailbox", "sent") }],
      labels: { to_addresses: "To", cc_addresses: "Cc", subject: "Subject", body: "Message" },
    },
  ],
});
