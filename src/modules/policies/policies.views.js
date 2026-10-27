"use strict";
/**
 * Where policies wait (docs/guides/notifications.md §6, Where it waits). Their versions on ESS ·
 * Policy Updates, for the reader: To Acknowledge while they owe an acknowledgement, Waiting On You while
 * its approval waits on them, else among All Policies (`published`, which only All shows). A
 * version that is no longer theirs to read there (withdrawn, replaced) counts on the tab alone.
 * The attendance policy's old notices name the same versions (migration 1405). A policy on
 * Knowledge Hub · Policies, under its State chip.
 */
const lagos = require("../../shared/time/lagos");
const repo = require("./policies.repo");

async function place(db, ids, { user }) {
  const rows = await repo.myViewsOf(db, user, ids, lagos.today());
  return new Map(rows.map((r) => [r.id, r.waiting_on_me ? "waiting_on_me" : r.to_acknowledge ? "to_acknowledge" : "published"]));
}

module.exports = [
  { module: "ess", tab: "policy-updates", type: "policy_version", place },
  { module: "ess", tab: "policy-updates", type: "attendance_policy", place },
  // Knowledge Hub · Policies, for those who write them: a policy under its State chip.
  {
    module: "knowledge",
    tab: "policies",
    type: "policy",
    place: async (db, ids) => new Map((await repo.statesOf(db, ids, lagos.today())).map((r) => [r.id, r.state])),
  },
];
