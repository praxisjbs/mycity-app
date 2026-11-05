"use strict";
/**
 * What the assistant may read about the Talent Pool (docs/guides/recruitment.md §9): the people kept
 * for later, as the asker may see them (the hiring manager of the vacancy each applied for), one page
 * of 25 at a time. It takes no action here: who is kept, invited back or let go is a person's
 * judgement of a person, made on the screen.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./talent_pool.service");

module.exports = defineManifest({
  module: "recruitment",
  actions: [],
  not_offered: {
    PoolAdd: "personal: keeping a person for later, with why, is decided on their sheet",
  },
  reads: [
    {
      key: "talent_pool.list",
      description: "List the Talent Pool: each person, the role they applied for, their score (and whether provisional), why they were kept, until when, and whether invited back",
      params: c.talent_pool.PoolListQuery,
      permission: ["recruitment", "view"],
      run: (_client, params, actor) => service.list(params, actor.scope),
      cite: (row) => ({ type: "talent_pool_entry", id: row.talent_pool_entry_id, label: row.name }),
    },
  ],
  routes: [{ intent: "invite someone from the Talent Pool to apply", screen: "recruitment.talent-pool" }],
});
