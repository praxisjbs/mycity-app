"use strict";
/**
 * Where agreements wait on Partnerships · Contracts & MOUs (docs/guides/notifications.md §6, Where it
 * waits; partnerships.md §7): under the chip of their status, as the list's status filter reads it. A
 * status with no chip of its own (viewed, signed, renewed) is shown by All alone.
 */
module.exports = [
  {
    module: "partnerships",
    tab: "contracts-and-mous",
    type: "agreement",
    place: async (db, ids) => {
      const { rows } = await db.query("SELECT partnership_agreement_id::text AS id, status FROM partnership_agreement WHERE partnership_agreement_id = ANY($1::uuid[])", [ids]);
      return new Map(rows.map((r) => [r.id, r.status]));
    },
  },
];
