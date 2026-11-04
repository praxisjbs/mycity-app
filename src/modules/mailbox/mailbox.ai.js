"use strict";
/**
 * What the assistant may do with mail, and nothing it may read (docs/guides/mailbox.md §9;
 * docs/guides/praxis-ai.md §6.11, decision 19): mail is private correspondence, so this
 * manifest declares no read and no summary. The one action is a mail the person sends: the
 * assistant writes it from the person's words and the records read, the card shows it whole,
 * and the press saves it as a draft and queues it exactly as Send does, the person's signature
 * baked in, from their own connected mailbox. No mailbox connected is a refusal at the press.
 * A reply inside a conversation stays Write With AI in the composer (mailbox.assist.js). The
 * signatures are cards too (decision 40): the person's own numbers and switches, the mobile written
 * to their employee record as the Signature tab writes it, and for holders of `mailbox.signature`
 * the company's links and switches, only what changes.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const service = require("./mailbox.service");
const signatures = require("./signature/signature.service");

const signatureLink = () => routeMap.screenPath("mailbox", "signature");

module.exports = defineManifest({
  module: "mailbox",
  // A create or edit form not drafted here, and why (gate 23 rule 6, praxis-ai.md decision 33).
  not_offered: {
    MailDraftSave: "via mail.send: a draft is the composer's own; the card sends the words (MailCompose)",
    SignatureConfigSave: "via signatures.configure: Configure's wizard saves every link and switch at once; the card changes only what it names, SignatureConfigChange",
  },
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
      // Who, the subject and the words, asked first when not said (praxis-ai.md decision 34).
      asks: [
        { field: "to_addresses", question: "Who is it to?" },
        { field: "subject", question: "What is the subject?" },
        { field: "body", question: "What should it say?" },
      ],
      records: () => [],
      check: (client, _values, actor) => service.assertConnected(client, actor),
      run: (values, actor, ctx) => service.sendNew(values, actor, ctx && ctx.idempotency_key ? `ai:${ctx.idempotency_key}` : null),
      readback: (q) => [{ type: "mail_send_queue", id: q.mail_send_queue_id, label: "Mail queued", status: "queued", link: routeMap.screenPath("mailbox", "sent") }],
      labels: { to_addresses: "To", cc_addresses: "Cc", subject: "Subject", body: "Message" },
    },
    {
      key: "signatures.save",
      label: "Save My Signature",
      description: "Change my email signature: my mobile (my employee record's own), my office line, and whether my mobile and the WhatsApp link show",
      input: c.mailbox.MySignatureSave,
      permission: ["mailbox", "edit"],
      risk: "standard",
      // Edit Numbers' own form with the tab's two switches; the mobile goes to the employee record (saveMine).
      run: (values, actor) => signatures.saveMine(values, actor),
      readback: (sig) => [{ type: "mail_signature", id: "signature", label: sig.name, status: "saved", link: signatureLink() }],
      labels: { mobile: "Mobile", office_line: "Office Line", show_mobile: "Show Mobile", show_whatsapp: "Show WhatsApp" },
    },
    {
      key: "signatures.configure",
      label: "Configure Signature",
      description: "Change the company's signature: its app and social links, its confidentiality note, and whether WhatsApp, app, social links and the legal line show",
      input: c.mailbox.SignatureConfigChange,
      // The route asks `mailbox` view and the capability; an action's grant is never view.
      permission: ["mailbox", "edit"],
      capability: "mailbox.signature",
      risk: "standard",
      form: "none: Configure's wizard saves every link and switch at once; the card changes only what it names",
      run: (values, actor) => signatures.saveConfigChange(values, actor),
      readback: () => [{ type: "mail_signature_config", id: "signature_config", label: "Company signature", status: "saved", link: signatureLink() }],
      labels: {
        app_store_url: "App Store",
        google_play_url: "Google Play",
        instagram_url: "Instagram",
        tiktok_url: "TikTok",
        linkedin_url: "LinkedIn",
        x_url: "X",
        facebook_url: "Facebook",
        youtube_url: "YouTube",
        confidentiality_note: "Confidentiality Note",
        show_whatsapp: "WhatsApp Links",
        show_app_links: "App Links",
        show_social_links: "Social Links",
        show_legal: "Legal Line",
      },
    },
  ],
});
