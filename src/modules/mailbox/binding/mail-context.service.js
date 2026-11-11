"use strict";
/**
 * The Partner context on a mail thread (docs/guides/partnerships.md §6.15, docs/guides/mailbox.md
 * §3): Link to Partner ties one of the caller's own conversations to one lead or partner they may see
 * in Partnerships (optionally one of its deals); Unlink stops it. A thread is its mailbox owner's, so
 * only they link it, and only they open it whole; the record's readers see each message's excerpt
 * (context-tabs.js) as an interaction on its Activity.
 *
 *   GET    /mailbox/threads/:id/partner    the context: the record and deal it is linked to, or none
 *   POST   /mailbox/threads/:id/partner    Link to Partner (ThreadPartnerBind); logs what the thread holds
 *   DELETE /mailbox/threads/:id/partner    Unlink; what was logged stays
 *
 * `mailbox` view on the route; `partnerships` view checked here, the record within its scope (§6.1).
 */
const { pool } = require("../../../config/db");
const { atomically } = require("../../../shared/db/tx");
const { emit } = require("../../../shared/events/emit");
const { AppError } = require("../../../shared/errors");
const { scopeFor } = require("../../../middleware/rbac");
const records = require("../../partner_pipeline/partner_pipeline.repo");
const intake = require("./intake.service");

const invalid = (field, message) => new AppError("VALIDATION_FAILED", "Check the highlighted fields", 422, { [field]: [message] });

/** The caller's `partnerships` view scope, or 403: linking mail to a record is for its readers. */
async function partnershipScope(user) {
  const scope = await scopeFor(user, "partnerships", "view");
  if (!scope) throw new AppError("FORBIDDEN", "You cannot see Partnerships", 403);
  return scope;
}

/** The caller's own thread, or 404 (another person's mail is never named). */
async function ownThread(db, threadId, user) {
  const { rows } = await db.query(
    `SELECT mt.mail_thread_id, mt.mail_account_id FROM mail_thread mt
       JOIN mail_account ma ON ma.mail_account_id = mt.mail_account_id
      WHERE mt.mail_thread_id = $1 AND ma.user_id = $2`,
    [threadId, user.user_id],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", "There is no such message", 404);
  return rows[0];
}

/** The context as the contract's ThreadContext; the record named only when the reader may see it. */
async function contextOf(db, threadId, scope) {
  const params = [threadId];
  const p = records.recordSeen(scope, { alias: "p", kind: "partner" }, params);
  const l = p ? records.recordSeen(scope, { alias: "l", kind: "lead" }, params) : "";
  const { rows } = await db.query(
    `SELECT pmt.mail_thread_id, pmt.bound_at,
            NULLIF(btrim(COALESCE(be.first_name, '') || ' ' || COALESCE(be.last_name, '')), '') AS bound_by,
            CASE WHEN p.partner_id IS NOT NULL THEN json_build_object('type', 'partner', 'id', p.partner_id, 'number', p.number, 'name', p.name)
                 WHEN l.lead_id IS NOT NULL THEN json_build_object('type', 'lead', 'id', l.lead_id, 'number', l.number::text, 'name', l.name) END AS record,
            CASE WHEN po.partnership_opportunity_id IS NULL THEN NULL
                 ELSE json_build_object('deal_id', po.partnership_opportunity_id, 'number', po.number, 'title', po.title) END AS deal
       FROM partner_mail_thread pmt
       LEFT JOIN partner p ON p.partner_id = pmt.partner_id ${p}
       LEFT JOIN lead l ON l.lead_id = pmt.lead_id ${l}
       LEFT JOIN partnership_opportunity po ON po.partnership_opportunity_id = pmt.deal_id
       LEFT JOIN app_user bu ON bu.user_id = pmt.bound_by
       LEFT JOIN employee be ON be.employee_id = bu.employee_id
      WHERE pmt.mail_thread_id = $1 AND pmt.unbound_at IS NULL`,
    params,
  );
  const r = rows[0];
  if (!r) return { mail_thread_id: threadId, record: null, deal: null, bound_at: null, bound_by: null };
  return { mail_thread_id: threadId, record: r.record, deal: r.record ? r.deal : null, bound_at: new Date(r.bound_at).toISOString(), bound_by: r.bound_by };
}

/** GET: the thread's Partner context. */
async function get(threadId, user) {
  const scope = await partnershipScope(user);
  await ownThread(pool, threadId, user);
  return contextOf(pool, threadId, scope);
}

/** POST: Link to Partner, or move the link to another record; logs the thread's messages there. */
async function bind(threadId, body, user) {
  const scope = await partnershipScope(user);
  const kind = body.partner_id ? "partner" : "lead";
  const recordId = body.partner_id || body.lead_id;
  const client = await pool.connect();
  try {
    await atomically(client, async () => {
      await ownThread(client, threadId, user);
      const alias = kind === "partner" ? "p" : "l";
      const params = [recordId];
      const seen = records.recordSeen(scope, { alias, kind }, params);
      const { rows } = await client.query(`SELECT ${alias}.status FROM ${kind} ${alias} WHERE ${alias}.${kind}_id = $1 ${seen}`, params);
      if (!rows[0]) throw invalid(`${kind}_id`, `No such ${kind}`);
      if (kind === "lead" && rows[0].status === "converted") throw invalid("lead_id", "Now a partner");
      if (body.deal_id) {
        const { rows: d } = await client.query(`SELECT 1 FROM partnership_opportunity WHERE partnership_opportunity_id = $1 AND ${kind}_id = $2`, [body.deal_id, recordId]);
        if (!d.length) throw invalid("deal_id", "Not this record's deal");
      }
      const { rows: was } = await client.query("SELECT partner_id, lead_id, deal_id, unbound_at FROM partner_mail_thread WHERE mail_thread_id = $1 FOR UPDATE", [threadId]);
      await client.query(
        `INSERT INTO partner_mail_thread (mail_thread_id, partner_id, lead_id, deal_id, bound_by, bound_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (mail_thread_id) DO UPDATE SET partner_id = EXCLUDED.partner_id, lead_id = EXCLUDED.lead_id, deal_id = EXCLUDED.deal_id,
           bound_by = EXCLUDED.bound_by, bound_at = now(), unbound_at = NULL, updated_at = now()`,
        [threadId, body.partner_id || null, body.lead_id || null, body.deal_id || null, user.user_id],
      );
      const logged = await intake.logThreadIn(client, threadId);
      const { EVENTS } = require("../mailbox.events");
      await emit(client, {
        key: EVENTS.MAILBOX_THREAD_BOUND,
        entity: { type: "mail_thread", id: threadId },
        actor: user,
        before: was[0] && !was[0].unbound_at ? { partner_id: was[0].partner_id, lead_id: was[0].lead_id, deal_id: was[0].deal_id } : null,
        after: { partner_id: body.partner_id || null, lead_id: body.lead_id || null, deal_id: body.deal_id || null },
        payload: { mail_thread_id: threadId, user_id: user.user_id, [`${kind}_id`]: recordId, deal_id: body.deal_id || null, logged },
      });
    });
  } finally {
    client.release();
  }
  return contextOf(pool, threadId, scope);
}

/** DELETE: Unlink. New messages stop being logged; those logged stay on the record. */
async function unbind(threadId, user) {
  const scope = await partnershipScope(user);
  const client = await pool.connect();
  try {
    await atomically(client, async () => {
      await ownThread(client, threadId, user);
      const { rows } = await client.query(
        "UPDATE partner_mail_thread SET unbound_at = now(), updated_at = now() WHERE mail_thread_id = $1 AND unbound_at IS NULL RETURNING partner_id, lead_id, deal_id",
        [threadId],
      );
      if (!rows[0]) return;
      const { EVENTS } = require("../mailbox.events");
      await emit(client, {
        key: EVENTS.MAILBOX_THREAD_UNBOUND,
        entity: { type: "mail_thread", id: threadId },
        actor: user,
        before: rows[0],
        payload: { mail_thread_id: threadId, user_id: user.user_id, partner_id: rows[0].partner_id, lead_id: rows[0].lead_id },
      });
    });
  } finally {
    client.release();
  }
  return contextOf(pool, threadId, scope);
}

module.exports = { get, bind, unbind, contextOf };
