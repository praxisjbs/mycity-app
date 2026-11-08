"use strict";
/**
 * Where leads wait on Partnerships · Leads (docs/guides/notifications.md §6, Where it waits;
 * partnerships.md §7): under the chip of their status, as the list's own filter reads it. A contacted
 * lead shows only under Open, which shows every lead neither converted nor lost.
 */
module.exports = [
  {
    module: "partnerships",
    tab: "leads",
    type: "lead",
    place: async (db, ids) => {
      const { rows } = await db.query("SELECT lead_id::text AS id, status FROM lead WHERE lead_id = ANY($1::uuid[])", [ids]);
      return new Map(rows.map((r) => [r.id, ["new", "qualified", "converted", "lost"].includes(r.status) ? r.status : "open"]));
    },
  },
];
