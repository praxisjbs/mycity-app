"use strict";
/**
 * Where agreements wait on Partnerships · Contracts & MOUs (docs/guides/notifications.md §6, Where it
 * waits; partnerships.md §7): under the chip of their status, as the list's status filter reads it. One
 * waiting on an approver at any stage (Review or Approval, its approval pending) is under In Approval
 * (QA F07c). A status with no chip of its own (viewed, signed, renewed, an approved one) is shown by All alone.
 */
module.exports = [
  {
    module: "partnerships",
    tab: "contracts-and-mous",
    type: "agreement",
    place: async (db, ids) => {
      const { rows } = await db.query(
        `SELECT a.partnership_agreement_id::text AS id,
                CASE WHEN a.status IN ('review', 'approval') AND wi.state = 'pending' THEN 'in_approval' ELSE a.status END AS status
           FROM partnership_agreement a
           LEFT JOIN workflow_instance wi ON wi.workflow_instance_id = a.workflow_instance_id
          WHERE a.partnership_agreement_id = ANY($1::uuid[])`,
        [ids],
      );
      return new Map(rows.map((r) => [r.id, r.status]));
    },
  },
];
