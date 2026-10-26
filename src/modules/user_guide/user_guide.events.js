"use strict";
/**
 * What the User Guide records (docs/guides/user-guide.md §7). Its one event is the meaning index
 * changing, audit only, and it names counts, never a passage's words or anyone's search: nothing
 * anyone types into the guide is kept (§6.1 decision 12).
 *
 * A spoken search is held in the vault only until its words come back (§6.10), under its own
 * document type, and only the person who spoke it may read it.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const { defineDocumentType } = require("../../shared/documents/types");
const vault = require("../../shared/documents/vault");

/** The document type and record type a spoken search is stored under (its id: the speaker's login). */
const GUIDE_VOICE = "guide_voice_search";

const EVENTS = defineEvents("knowledge", {
  "user_guide.indexed": { summary: "The User Guide's passages were indexed for search by meaning" },
});

/** A spoken search (user-guide.md §6.10): kept only while it is transcribed, never played. */
defineDocumentType(GUIDE_VOICE, {
  label: "Guide voice search",
  module: "knowledge",
  sensitivity: "personal",
  transient: true,
});

vault.defineAccess(GUIDE_VOICE, async (_client, user, doc) => doc.entity_id === user.user_id);

module.exports = { EVENTS, GUIDE_VOICE };
