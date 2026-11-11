"use strict";
/**
 * What the SOPs record, who they tell, and the files a step carries (docs/guides/knowledge.md §7).
 * Loaded by the API and the worker.
 *
 *   sop.created           a writer started an SOP for a department, with an empty draft
 *   sop.draft_saved,      a draft saved or discarded: the audit line with before and after;
 *   sop.draft_discarded   nobody is told
 *   sop.published         a draft became Version N: the department's members are told ("New SOP"
 *                         or "SOP updated"), as their Knowledge Hub preference allows; nobody when
 *                         it was published quietly (the staging seed, `quiet` in the payload)
 *   sop.archived          an SOP left the hub; its versions are kept
 *
 * Payloads carry ids, the number, the department, the title and the version: never a step's text.
 */
const { pool } = require("../../config/db");
const { defineEvents } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const { defineDocumentType } = require("../../shared/documents/types");
const vault = require("../../shared/documents/vault");

const EVENTS = defineEvents("knowledge", {
  "sop.created": { summary: "An SOP was started" },
  "sop.draft_saved": { summary: "An SOP's draft was saved" },
  "sop.draft_discarded": { summary: "An SOP's draft was discarded" },
  "sop.published": { summary: "An SOP version was published" },
  "sop.archived": { summary: "An SOP was archived" },
});

/** The record an SOP is, in notices, search, links and the vault. */
const SOP_ENTITY = "sop";
/** A file a step carries, claimed from the upload engine when the draft is saved. */
const STEP_FILE_DOC_TYPE = "sop_file";

defineDocumentType(STEP_FILE_DOC_TYPE, { label: "SOP file", module: "knowledge", sensitivity: "normal" });

/**
 * A step's file is read as its SOP is (§6.2, §8): by everyone who may open the Knowledge Hub. The
 * rbac module is required when the rule runs, as the vault requires it.
 */
vault.defineAccess(SOP_ENTITY, async (_client, user) => Boolean(await require("../../middleware/rbac").scopeFor(user, "knowledge", "view")));

/*
 * The department is told of a new version: its members at work with a login. The repo is required
 * when a notice is written: the worker loads this file first.
 */
defineNotification(EVENTS.SOP_PUBLISHED, {
  to: [{ users: (event, client) => (event.payload.quiet ? [] : require("./knowledge.repo").departmentUsers(client || pool, event.payload.department_id)) }],
  who: "The SOP's department",
  title: (e) => (e.payload.version > 1 ? "SOP updated" : "New SOP"),
  body: (e) => `${e.payload.title}, Version ${e.payload.version}.`,
});

module.exports = { EVENTS, SOP_ENTITY, STEP_FILE_DOC_TYPE };
