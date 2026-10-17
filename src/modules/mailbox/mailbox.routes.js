"use strict";
/**
 * Mailbox routes (docs/guides/mailbox.md §5), under /api/v1/mailbox. Every route is the
 * caller's own mailbox: the service starts from their account, so there is no id of
 * another person's mail to try.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const upload = require("../../middleware/upload");
const controller = require("./mailbox.controller");

const router = express.Router();
const mb = c.mailbox;
const view = () => requirePermission("mailbox", "view");
const create = () => requirePermission("mailbox", "create");

route(router, "get", "/connection", { response: mb.MailConnection, summary: "My mailbox connection" }, view(), controller.connection);
route(router, "post", "/connection", { body: mb.MailConnect, response: mb.MailConnection, summary: "Connect my mailbox with its address and password" }, create(), controller.connect);
route(router, "post", "/connection/sync", { body: c.common.EmptyBody, response: mb.MailConnection, summary: "Fetch new mail now" }, view(), controller.sync);
route(router, "post", "/connection/disconnect", { body: c.common.EmptyBody, response: mb.MailConnection, summary: "Disconnect my mailbox" }, view(), controller.disconnect);
route(router, "get", "/threads", { query: mb.ThreadListQuery, response: mb.ThreadPage, summary: "A folder of my mail" }, view(), controller.threads);
route(router, "get", "/threads/:id", { response: mb.Thread, summary: "One conversation" }, view(), controller.thread);
route(router, "post", "/threads/:id/read", { body: c.common.EmptyBody, no_content: true, summary: "Mark a conversation read" }, view(), controller.read);
route(router, "post", "/threads/:id/move", { body: mb.ThreadMove, no_content: true, summary: "Move a conversation to another folder" }, view(), controller.move);
route(router, "post", "/folders/:kind/empty", { params: mb.FolderParams, body: c.common.EmptyBody, response: mb.EmptyResult, summary: "Empty Spam or Trash" }, requirePermission("mailbox", "delete"), controller.empty);
route(router, "get", "/drafts/:id", { response: mb.MailDraft, summary: "One of my drafts" }, view(), controller.draft);
route(router, "put", "/drafts/:id", { body: mb.MailDraftSave, response: mb.MailDraft, summary: "Save a draft as it is typed" }, create(), controller.saveDraft);
route(router, "delete", "/drafts/:id", { no_content: true, summary: "Discard a draft" }, create(), controller.deleteDraft);
route(router, "post", "/attachments", { body: c.documents.DocumentUpload, response: c.documents.DocumentRef, summary: "Attach a file to a message being written" }, create(), upload.single("file", { purpose: "attachment" }), controller.attach);
route(router, "post", "/messages", { body: mb.MailSend, response: mb.QueuedMail, summary: "Send a message, now or at a time" }, create(), controller.send);
route(router, "post", "/queue/:id/cancel", { body: c.common.EmptyBody, response: mb.QueuedMail, summary: "Cancel a scheduled message" }, create(), controller.cancel);

module.exports = { basePath: "/mailbox", surface: "staff", router };
