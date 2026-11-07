"use strict";
/**
 * Work (docs/guides/partnerships.md §6.16; docs/guides/workspace.md §6 Connect to Partner): the
 * projects, tasks and events connected to a lead or a partner, and the link itself.
 *
 *   checkLink()      what a Workspace service asks before it writes a link: a record the person sees
 *                    in Partnerships and that still takes work (a partner not closed, a lead neither
 *                    converted nor lost), and one of its open or live deals they see
 *   merged()         the link an edit leaves: only what changes, a new record clearing the deal
 *   viewOf(), named()  the link on the way out; named() fills its names for a reader who sees the
 *                    record (and the deal), so connecting never shows a partner to someone who could
 *                    not open it (A24)
 *   records(), deals()  Connect to Partner's Partner and Deal, 25 a page
 *   list()           the 360's Work tab: the work its reader may already see, by Workspace's own rules,
 *                    and how many items of each kind they may not ("3 more tasks you cannot see")
 *   nextEvents()     the 360's Overview: the next three connected events the reader may see
 *   cardNames(), idOf()  a Praxis AI card's partner, lead and deal, by name, and a record or deal
 *                    named in words, among those the person sees
 *
 * Nothing here writes: the Workspace services write the links, Partnerships decides what may be
 * linked. Connecting gives nobody sight of a task, project or event they could not see before.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { AppError } = require("../../shared/errors");
const { oneNamed } = require("../../shared/ai/named");
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { personJson } = require("../../shared/db/person");
const { scopeClause } = require("../../shared/rbac/scope");
const deals = require("../partner_pipeline/partner_pipeline.repo");

const invalid = (field, message) => new AppError("VALIDATION_FAILED", message, 422, { [field]: [message] });
const KEYS = ["partner_id", "lead_id", "deal_id"];
const isId = (v) => c.common.uuid.safeParse(v).success;

/** The reader's Partnerships scope, or null without the grant (middleware/rbac's own answer). */
const partnershipsScope = (user) => require("../../middleware/rbac").scopeFor(user, "partnerships", "view");
const workspaceScope = (user) => require("../../middleware/rbac").scopeFor(user, "workspace", "view");

/* ------------------------------------------------------------------ *
 * The link
 * ------------------------------------------------------------------ */

/** A row's link as the contract's PartnerLinkView, its names left for named(); null when it has none. */
function viewOf(row) {
  if (!row || (!row.partner_id && !row.lead_id)) return null;
  return { partner_id: row.partner_id || null, lead_id: row.lead_id || null, deal_id: row.deal_id || null, name: null, number: null, deal_number: null, deal_title: null };
}

/** Does the body name the link at all. */
const touches = (body) => KEYS.some((k) => body[k] !== undefined);

/**
 * The link an edit leaves on the work as it stands: a new partner or lead clears the other and,
 * unless one is given, the deal; `null` on both disconnects.
 * @param {{partner_id?: string|null, lead_id?: string|null, deal_id?: string|null}} current
 * @param {object} body  the edit's fields
 * @returns {{link: {partner_id: string|null, lead_id: string|null, deal_id: string|null}, changed: boolean}}
 */
function merged(current, body) {
  const has = (k) => body[k] !== undefined;
  const was = { partner_id: current.partner_id || null, lead_id: current.lead_id || null, deal_id: current.deal_id || null };
  const link = { ...was };
  if (has("partner_id") || has("lead_id")) {
    const partner = has("partner_id") ? body.partner_id || null : body.lead_id ? null : was.partner_id;
    const lead = has("lead_id") ? body.lead_id || null : body.partner_id ? null : was.lead_id;
    if (partner !== was.partner_id || lead !== was.lead_id) {
      link.partner_id = partner;
      link.lead_id = lead;
      if (!has("deal_id")) link.deal_id = null;
    }
  }
  if (has("deal_id")) link.deal_id = body.deal_id || null;
  if (!link.partner_id && !link.lead_id) {
    if (has("deal_id") && link.deal_id) throw invalid("partner_id", "Pick the partner first");
    link.deal_id = null;
  }
  return { link, changed: KEYS.some((k) => link[k] !== was[k]) };
}

/**
 * May this person connect work to this record and deal (§6.16)? 422 on the field otherwise.
 * `trusted`: Partnerships itself is setting the work (a deliverable, a follow-up, a deal's event
 * days), for a record and deal it has just read, so who sees them is not asked.
 * @param {{query: Function}} db
 * @param {object} user  the person: req.user, or an actor with role_ids
 * @param {{partner_id?: string|null, lead_id?: string|null, deal_id?: string|null}} link
 */
async function checkLink(db, user, link, { trusted = false } = {}) {
  const partnerId = link.partner_id || null;
  const leadId = link.lead_id || null;
  const dealId = link.deal_id || null;
  if (!partnerId && !leadId) {
    if (dealId) throw invalid("partner_id", "Pick the partner first");
    return;
  }
  if (partnerId && leadId) throw invalid("lead_id", "A partner or a lead, not both");
  const kind = partnerId ? "partner" : "lead";
  const field = `${kind}_id`;
  const refused = kind === "partner" ? "Not a partner you can see" : "Not a lead you can see";
  const scope = trusted ? { scope: "all", scope_ids: null } : await partnershipsScope(user);
  if (!scope) throw invalid(field, refused);
  const alias = kind === "partner" ? "p" : "l";
  const takesWork = kind === "partner" ? "p.status <> 'closed'" : "l.status NOT IN ('converted', 'lost')";
  const params = [partnerId || leadId];
  const seen = deals.recordSeen(scope, { alias, kind }, params);
  const { rows } = await db.query(`SELECT 1 AS x FROM ${kind} ${alias} WHERE ${alias}.${kind}_id = $1 AND ${takesWork} ${seen}`, params);
  if (!rows.length) throw invalid(field, refused);
  if (!dealId) return;
  const dp = [dealId, partnerId || leadId];
  const dealOn = kind === "partner" ? "po.partner_id = $2" : "po.lead_id = $2 AND po.partner_id IS NULL";
  const dSeen = deals.dealSeen(scope, "po", dp);
  const { rows: found } = await db.query(
    `SELECT 1 AS x FROM partnership_opportunity po
      WHERE po.partnership_opportunity_id = $1 AND ${dealOn} AND po.status IN ('open', 'live') ${dSeen}`,
    dp,
  );
  if (!found.length) throw invalid("deal_id", "Not one of its open deals");
}

/** The items of a value that carry a link: a page's rows, an array, or one record. */
function itemsOf(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.data)) return value.data;
  return [value];
}

/**
 * Fill each link's names for the reader: the record's number and name when they see it in
 * Partnerships, the deal's when they see the deal. Returns the value it was given.
 * @template T
 * @param {object|null} user
 * @param {T} value  a page, an array, or one task, project or event
 * @returns {Promise<T>}
 */
async function named(user, value, db = pool) {
  const links = itemsOf(value)
    .map((i) => i && i.partner_link)
    .filter(Boolean);
  if (!links.length || !user) return value;
  const scope = await partnershipsScope(user);
  if (!scope) return value;
  const ids = (k) => [...new Set(links.map((l) => l[k]).filter(Boolean))];
  const found = new Map();
  for (const kind of ["partner", "lead"]) {
    const wanted = ids(`${kind}_id`);
    if (!wanted.length) continue;
    const alias = kind === "partner" ? "p" : "l";
    const params = [wanted];
    const seen = deals.recordSeen(scope, { alias, kind }, params);
    const { rows } = await db.query(`SELECT ${alias}.${kind}_id AS id, ${alias}.number::text AS number, ${alias}.name FROM ${kind} ${alias} WHERE ${alias}.${kind}_id = ANY($1::uuid[]) ${seen}`, params);
    for (const r of rows) found.set(r.id, r);
  }
  const dealIds = ids("deal_id");
  if (dealIds.length) {
    const params = [dealIds];
    const seen = deals.dealSeen(scope, "po", params);
    const { rows } = await db.query(`SELECT po.partnership_opportunity_id AS id, po.number::text AS number, po.title FROM partnership_opportunity po WHERE po.partnership_opportunity_id = ANY($1::uuid[]) ${seen}`, params);
    for (const r of rows) found.set(r.id, r);
  }
  for (const l of links) {
    const r = found.get(l.partner_id || l.lead_id);
    if (!r) continue;
    l.name = r.name;
    l.number = r.number;
    const d = l.deal_id ? found.get(l.deal_id) : null;
    if (d) {
      l.deal_number = d.number;
      l.deal_title = d.title;
    }
  }
  return value;
}

/* ------------------------------------------------------------------ *
 * Connect to Partner's pickers
 * ------------------------------------------------------------------ */

/** Partners not closed and leads still open that the reader sees, by name (GET /work/records). */
function records(query, scope, db = pool) {
  const params = [query.q || null, query.kind || null];
  const p = deals.recordSeen(scope, { alias: "p", kind: "partner" }, params);
  const l = deals.recordSeen(scope, { alias: "l", kind: "lead" }, params);
  return pageQuery(
    db,
    `SELECT r.kind, r.id, r.number, r.name, r.category, ${TOTAL_COL}
       FROM (SELECT 'partner' AS kind, p.partner_id AS id, p.number::text AS number, p.name, pc.name::text AS category
               FROM partner p LEFT JOIN partner_category pc ON pc.partner_category_id = p.partner_category_id
              WHERE p.status <> 'closed' ${p}
             UNION ALL
             SELECT 'lead', l.lead_id, l.number::text, l.name, lc.name::text
               FROM lead l LEFT JOIN partner_category lc ON lc.partner_category_id = l.partner_category_id
              WHERE l.status NOT IN ('converted', 'lost') ${l}) r
      WHERE ($1::text IS NULL OR search_fold(r.name || ' ' || r.number) LIKE '%' || search_fold($1) || '%')
        AND ($2::text IS NULL OR r.kind = $2)
      ORDER BY ${orderBy(query, { name: "r.name" }, "r.id")}`,
    params,
    query,
  );
}

/** A record's open and live deals the reader sees, newest first; every one they see with no record (GET /work/deals). */
function dealsOf(query, scope, db = pool) {
  if (query.partner_id && query.lead_id) throw invalid("lead_id", "A partner or a lead, not both");
  const params = [query.partner_id || query.lead_id || null, query.q || null];
  const seen = deals.dealSeen(scope, "po", params);
  const on = query.partner_id ? "po.partner_id = $1" : query.lead_id ? "po.lead_id = $1 AND po.partner_id IS NULL" : "($1::uuid IS NULL)";
  return pageQuery(
    db,
    `SELECT po.partnership_opportunity_id AS deal_id, po.number::text AS number, po.title, po.status,
            COALESCE(rp.name, rl.name) AS record_name, ${TOTAL_COL}
       FROM partnership_opportunity po
       LEFT JOIN partner rp ON rp.partner_id = po.partner_id
       LEFT JOIN lead rl ON rl.lead_id = po.lead_id
      WHERE ${on} AND po.status IN ('open', 'live')
        AND ($2::text IS NULL OR search_fold(po.title || ' ' || po.number::text) LIKE '%' || search_fold($2) || '%')
        ${seen}
      ORDER BY po.created_at DESC, po.partnership_opportunity_id`,
    params,
    query,
  );
}

/* ------------------------------------------------------------------ *
 * The 360's Work tab and Overview
 * ------------------------------------------------------------------ */

/**
 * What the Workspace reader may see of each kind, as SQL over `p` (project), `t` (task) and `e`
 * (event): every project to a holder of `workspace` view; a task led by someone in their scope, or
 * set, shared or watched by them; an event they own or are invited to, or shared with everyone.
 * Pushes what it names. With no `workspace` grant, nothing.
 */
function visibleOf(kind, wscope, params) {
  if (!wscope) return "false";
  if (kind === "project") return "true";
  params.push(wscope.employee_id || null);
  const me = `$${params.length}::uuid`;
  if (kind === "event") {
    return `(e.owner_employee_id = ${me} OR e.visibility = 'everyone'
      OR EXISTS (SELECT 1 FROM calendar_event_attendee ea WHERE ea.calendar_event_id = e.calendar_event_id AND ea.employee_id = ${me}))`;
  }
  const mine = `(t.primary_assignee_id = ${me} OR t.set_by_employee_id = ${me}
    OR EXISTS (SELECT 1 FROM task_assignee ta WHERE ta.task_id = t.task_id AND ta.employee_id = ${me})
    OR EXISTS (SELECT 1 FROM task_watcher tw WHERE tw.task_id = t.task_id AND tw.employee_id = ${me}))`;
  const s = scopeClause(wscope, { column: "t.primary_assignee_id" }, params);
  return s.and ? `(${s.and.slice(4)} OR ${mine})` : "true";
}

/** Each kind's rows: what counts as the work, and the item as the Work tab shows it. */
const KINDS = {
  project: {
    from: `FROM project p LEFT JOIN employee oe ON oe.employee_id = p.owner_employee_id LEFT JOIN department od ON od.department_id = oe.department_id`,
    alias: "p",
    live: "TRUE",
    select: `'project' AS kind, p.project_id AS id, p.number::text AS number, p.name AS title, p.status, to_char(p.due_on, 'YYYY-MM-DD') AS due_on,
             NULL::timestamptz AS starts_at, p.deal_id, ${personJson("oe", "od")} AS owner, p.created_at`,
    sorts: { due_on: "p.due_on", created_at: "p.created_at" },
    key: "p.project_id",
  },
  task: {
    from: `FROM task t LEFT JOIN employee ae ON ae.employee_id = t.primary_assignee_id LEFT JOIN department ad ON ad.department_id = ae.department_id`,
    alias: "t",
    live: "t.archived_at IS NULL AND t.status <> 'cancelled'",
    select: `'task' AS kind, t.task_id AS id, t.number::text AS number, t.title, t.status, to_char(t.due_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD') AS due_on,
             NULL::timestamptz AS starts_at, t.deal_id, ${personJson("ae", "ad")} AS owner, t.created_at`,
    sorts: { due_on: "t.due_at", created_at: "t.created_at" },
    key: "t.task_id",
  },
  event: {
    from: `FROM calendar_event e LEFT JOIN employee ee ON ee.employee_id = e.owner_employee_id LEFT JOIN department ed ON ed.department_id = ee.department_id`,
    alias: "e",
    live: "e.cancelled_at IS NULL",
    select: `'event' AS kind, e.calendar_event_id AS id, NULL::text AS number, e.title, CASE WHEN e.ends_at < now() THEN 'past' ELSE 'upcoming' END AS status,
             to_char(e.starts_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD') AS due_on, e.starts_at, e.deal_id, ${personJson("ee", "ed")} AS owner, e.created_at`,
    sorts: { due_on: "e.starts_at", created_at: "e.created_at" },
    key: "e.calendar_event_id",
  },
};

/** The record a query names, and the deal it narrows to, as SQL over the kind's alias. */
function ofRecord(alias, query, params) {
  params.push(query.partner_id || query.lead_id);
  const where = [`${alias}.${query.partner_id ? "partner_id" : "lead_id"} = $${params.length}`];
  if (query.deal_id) {
    params.push(query.deal_id);
    where.push(`${alias}.deal_id = $${params.length}`);
  }
  return where.join(" AND ");
}

/**
 * The Work tab (GET /work): a page of one kind of the record's work the reader may already see, and
 * how many of each kind they may not. The record must be one they see in Partnerships.
 * @param {object} query  PartnerWorkQuery
 * @param {object} scope  scopeOf(req) under `partnerships` view
 * @param {object} user   req.user, for Workspace's own grant
 */
async function list(query, scope, user, db = pool) {
  if (!query.partner_id === !query.lead_id) throw invalid("partner_id", "Pick the partner first");
  const kind = query.partner_id ? "partner" : "lead";
  const rp = [query.partner_id || query.lead_id];
  const alias = kind === "partner" ? "p" : "l";
  const seen = deals.recordSeen(scope, { alias, kind }, rp);
  const { rows: rec } = await db.query(`SELECT 1 AS x FROM ${kind} ${alias} WHERE ${alias}.${kind}_id = $1 ${seen}`, rp);
  if (!rec.length) throw new AppError("NOT_FOUND", "That record does not exist, or you cannot see it.", 404);
  const wscope = await workspaceScope(user);
  const k = KINDS[query.kind];
  const params = [];
  const on = ofRecord(k.alias, query, params);
  const visible = visibleOf(query.kind, wscope, params);
  const page = await pageQuery(
    db,
    `SELECT ${k.select}, ${TOTAL_COL} ${k.from}
      WHERE ${on} AND ${k.live} AND ${visible}
      ORDER BY ${orderBy(query, k.sorts, k.key)}`,
    params,
    query,
  );
  const hidden = {};
  for (const [name, plural] of [["project", "projects"], ["task", "tasks"], ["event", "events"]]) {
    const kk = KINDS[name];
    const hp = [];
    const hOn = ofRecord(kk.alias, query, hp);
    const hVisible = visibleOf(name, wscope, hp);
    const { rows } = await db.query(`SELECT count(*)::int AS n ${kk.from} WHERE ${hOn} AND ${kk.live} AND NOT ${hVisible}`, hp);
    hidden[plural] = rows[0].n;
  }
  return {
    ...page,
    data: page.data.map((r) => ({
      kind: r.kind,
      id: r.id,
      number: r.number,
      title: r.title,
      status: r.status,
      due_on: r.due_on,
      starts_at: r.starts_at ? new Date(r.starts_at).toISOString() : null,
      deal_id: r.deal_id,
      owner: r.owner,
    })),
    hidden,
  };
}

/**
 * The next three connected events still to come that the reader may see (the 360's Overview).
 * @param {{kind: "partner"|"lead", id: string}} record
 */
async function nextEvents(db, user, record) {
  const wscope = user ? await workspaceScope(user) : null;
  if (!wscope) return [];
  const params = [record.id];
  const visible = visibleOf("event", wscope, params);
  const page = await pageQuery(
    db,
    `SELECT e.calendar_event_id, e.title, e.starts_at, e.ends_at, e.event_type, ${TOTAL_COL}
       FROM calendar_event e
      WHERE e.${record.kind}_id = $1 AND e.cancelled_at IS NULL AND e.ends_at >= now() AND ${visible}
      ORDER BY e.starts_at, e.calendar_event_id`,
    params,
    { page: 1 },
  );
  return page.data.slice(0, 3).map((r) => ({
    calendar_event_id: r.calendar_event_id,
    title: r.title,
    starts_at: new Date(r.starts_at).toISOString(),
    ends_at: new Date(r.ends_at).toISOString(),
    event_type: r.event_type,
  }));
}

/* ------------------------------------------------------------------ *
 * Praxis AI's cards
 * ------------------------------------------------------------------ */

/**
 * A card's partner, lead and deal by number and name, for the person who sees them; one they do not
 * see names nothing, and the press refuses it (checkLink).
 * @returns {Promise<Array<{type: string, id: string, label: string}>>}
 */
async function cardNames(db, user, values = {}) {
  const pick = (k) => (isId(values[k]) ? values[k] : null);
  const link = { partner_id: pick("partner_id"), lead_id: pick("lead_id"), deal_id: pick("deal_id") };
  if (!link.partner_id && !link.lead_id) return [];
  const view = { partner_link: viewOf(link) };
  await named(user, view, db);
  const l = view.partner_link;
  const out = [];
  if (l.name) out.push({ type: l.partner_id ? "partner" : "lead", id: l.partner_id || l.lead_id, label: `${l.number} ${l.name}` });
  if (l.deal_id && l.deal_title) out.push({ type: "partner_deal", id: l.deal_id, label: `${l.deal_number} ${l.deal_title}` });
  return out;
}

/**
 * A partner, lead or deal a card names in words, among those the person may connect work to: the
 * one whose name (or number) the words name, else null and the card asks. `kind` is the field.
 * @param {"partner"|"lead"|"deal"} kind
 */
async function idOf(user, kind, words, values = {}, db = pool) {
  if (isId(words)) return words;
  const scope = user ? await partnershipsScope(user) : null;
  if (!scope || !words) return null;
  if (kind === "deal") {
    const record = values.partner_id ? { partner_id: values.partner_id } : values.lead_id ? { lead_id: values.lead_id } : null;
    if (!record || !isId(record.partner_id || record.lead_id)) return null;
    const page = await dealsOf({ page: 1, q: words, ...record }, scope, db);
    const found = oneNamed(page.data, words, (d) => [d.title, d.number]);
    return found ? found.deal_id : null;
  }
  const page = await records({ page: 1, q: words, kind }, scope, db);
  const found = oneNamed(page.data, words, (r) => [r.name, r.number]);
  return found ? found.id : null;
}

/**
 * What a Workspace card (a task, project or event) carries of Connect to Partner (§9): the three
 * fields, picked on Edit, named by number and name, and a partner, lead or deal named in words found
 * among those the person sees. The press checks the link as the form's own save does (checkLink).
 */
const card = {
  fields: KEYS,
  picks: { partner_id: "partner", lead_id: "lead", deal_id: "partner_deal" },
  labels: { partner_id: "Partner", lead_id: "Lead", deal_id: "Deal" },
  resolve: {
    partner_id: (value, actor, db, values) => idOf(actor, "partner", value, values, db || pool),
    lead_id: (value, actor, db, values) => idOf(actor, "lead", value, values, db || pool),
    deal_id: (value, actor, db, values) => idOf(actor, "deal", value, values, db || pool),
  },
  names: (values, actor, db) => (db ? cardNames(db, actor, values) : []),
};

module.exports = { viewOf, touches, merged, checkLink, named, records, deals: dealsOf, list, nextEvents, cardNames, idOf, card };
