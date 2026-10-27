"use strict";
/**
 * Queries: the one write path for a query, whoever raises it (docs/guides/queries.md
 * §3, §6.2 to §6.4).
 *
 *   raise()          a manager or People, from Raise a Query (POST /queries)
 *   raiseForRule()   a query rule's breach (query_rules.evaluator), with its counted days
 *                    as evidence and a dedup key, so a breach delivered twice is one query
 *   raiseFromBreach() an Attendance policy breach with Raise Query on (query_rules.events),
 *                    linked back on the breach through the attendance service
 *   remind()         Send Reminder, once a Lagos day, while the query waits for an answer
 *   decide()         Close With No Action, or propose a sanction (queries.escalate.js)
 *   respond()        the employee's answer, from ESS · My Queries (queries.response.js)
 *
 * Every query is numbered (QRY-0001) and gets its letter in the same transaction
 * (documents.generate, rendered and emailed after commit). Who sees a query is
 * queries.visibility.js; a query outside it is a 404.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const numbering = require("../../shared/numbering/numbering");
const documents = require("../../shared/documents/generate");
const vault = require("../../shared/documents/vault");
const lagos = require("../../shared/time/lagos");
const { scopeFor } = require("../../middleware/rbac");
const templates = require("../templates/templates.service");
const { QUERY_LETTER } = require("../templates/templates.events");
const md = require("../../shared/documents/markdown");
const repo = require("./queries.repo");
const visibility = require("./queries.visibility");
const { EVENTS, SIGNATURE_DOC_TYPE } = require("./queries.events");

/**
 * How long the employee has to answer (guide §6.2): MyCity's handbook (§4.7.1) and its query
 * letters give 24 hours. Until Settings · Queries (M9) holds it.
 */
const RESPONSE_HOURS = 24;

/** Who signs a letter a rule raised. */
const PEOPLE_SIGNER = Object.freeze({ name: "Operations & People", role: "Operations & People" });

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That query does not exist", 404);

/** The policies service, which alone reads policies (queries cite one, guide §6.2). */
const policies = () => require("../policies/policies.service");

/**
 * A row as readers get it: its response, kept as Markdown, also as the blocks a screen draws, and
 * the policy it cites named through the policies service.
 */
async function readable(db, row) {
  if (!row) return row;
  const { policy_version_id: versionId, ...rest } = row;
  const policy = versionId ? await policies().citationOfVersion(db, versionId) : null;
  return {
    ...rest,
    policy,
    ...(row.response && { response: { ...row.response, blocks: md.markdownToBlocks(row.response.body) } }),
  };
}

/** A citation as a letter quotes it (ConsequenceLetterVars.policy). */
const quoted = (citation, clause) =>
  citation ? { number: citation.number, title: citation.title, version: citation.version, clause: clause || null } : null;

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/** A Lagos day's first instant, and the next day's: a raised_from/raised_to filter as instants. */
const nextDay = (date) => lagos.addDays(date, 1);
const list = (query, reader) =>
  repo.list(
    pool,
    {
      ...query,
      raised_since: query.raised_from ? lagos.startOfDay(query.raised_from) : null,
      raised_before: query.raised_to ? lagos.startOfDay(nextDay(query.raised_to)) : null,
    },
    reader,
  );

const summary = (reader) => repo.summary(pool, reader, lagos.startOfDay(`${lagos.today().slice(0, 7)}-01`));

/** The row behind a query the reader may see, or 404. */
async function visibleRow(db, reader, id) {
  return visibility.assertVisible(reader, await repo.get(db, id));
}

/**
 * The rung a new offence is offered first (guide §6.5). Required when it is asked: the
 * sanctions service requires this one for its queries' settlement.
 */
const nextStepFor = (employeeId) => require("../sanctions/sanctions.service").nextStep(pool, employeeId);

/** Whether the reader may decide this query now (guide §6.4). */
function decidable(row, user, canEdit) {
  if (!canEdit || row.status === "resolved" || row.escalated) return false;
  if (user.employee_id && user.employee_id === row.employee_id) return false;
  const answered = Boolean(row.response);
  const overdue = row.response_due_at && new Date(row.response_due_at) <= new Date();
  return answered || Boolean(overdue);
}

/** Whether the reader may send a reminder now. */
function remindable(row, canCreate) {
  if (!canCreate || row.status !== "awaiting_response" || row.response) return false;
  return !row.reminded_at || lagos.dateOf(row.reminded_at) < lagos.today();
}

/** The Operations & People stage of queries.consequence: deciding it signs the letters (§6.4). */
const SIGNING_STAGE = "operations_people";

/**
 * A pending sanction's approval as this reader meets it (guide §6.4): the stage it waits on,
 * whether they may decide it, whether deciding signs. Read through the workflow service, which
 * alone says who may act; null when nothing waits or the reader may not read the approval.
 */
async function approvalFor(row, user) {
  if (!row.sanction || row.sanction.status !== "pending_approval" || !row.workflow_instance_id) return null;
  try {
    const flow = await require("../workflow/workflow.service").getInstance(user, row.workflow_instance_id);
    if (flow.state !== "pending" || !flow.current_stage) return null;
    return {
      stage: flow.current_stage,
      stage_name: flow.stage_name || flow.current_stage,
      can_decide: Boolean(flow.can_decide),
      signs: flow.current_stage === SIGNING_STAGE,
    };
  } catch (err) {
    if (err && err.status === 404) return null;
    throw err;
  }
}

/** One query as its card shows it, for this reader. */
async function get(id, user, scope) {
  const reader = visibility.readerOf(scope, user);
  const row = await visibleRow(pool, reader, id);
  const [canEdit, canCreate] = await Promise.all([
    scopeFor(user, "queries", "edit"),
    scopeFor(user, "queries", "create"),
  ]);
  const { employee_id: employeeId, ...rest } = await readable(pool, row);
  return {
    ...rest,
    next_step: row.status === "resolved" ? null : await nextStepFor(employeeId),
    can_decide: decidable(row, user, Boolean(canEdit)),
    can_remind: remindable(row, Boolean(canCreate)),
    approval: await approvalFor(row, user),
  };
}

/* ------------------------------------------------------------------ *
 * Raising
 * ------------------------------------------------------------------ */

/**
 * A drawn signature (the pad's PNG data URL) kept through the vault for the record it signs.
 * The sanctions service stores a proposer's the same way.
 * @returns {Promise<string>} the document_id
 */
async function storeSignature(client, png, entity, actor) {
  const buffer = Buffer.from(String(png).replace(/^data:image\/png;base64,/, ""), "base64");
  const doc = await vault.store(client, {
    file: { buffer, originalname: "signature.png" },
    purpose: "signature",
    doc_type: SIGNATURE_DOC_TYPE,
    entity,
    sensitivity: "normal",
    actor,
  });
  return doc.document_id;
}

/** What every query letter fills from (ConsequenceLetterVars). */
function letterData(person, row, signer, policy = null) {
  return {
    employee: {
      display_name: person.display_name,
      first_name: person.called,
      job_title: person.job_title,
      department: person.department,
    },
    query_number: row.number,
    subject: row.subject,
    details: row.details,
    raised_on: lagos.today(),
    response_due: row.response_due_at,
    policy,
    signer,
  };
}

/**
 * The insert, the letter and the event, on the caller's transaction. Returns the new id,
 * or null when `dedup_key` was already taken.
 */
async function insertQuery(client, { person, subject, details, evidence, rule, raisedBy, source, dedupKey, letterKey, signer, signature = null, citation = null, clause = null, actor }) {
  if (dedupKey && (await repo.dedupTaken(client, dedupKey))) return null;
  const number = (await numbering.allocate(client, "query")).number;
  const responseDue = new Date(Date.now() + RESPONSE_HOURS * 3600 * 1000).toISOString();
  const id = await repo.insert(client, {
    number,
    employee_id: person.employee_id,
    query_rule_id: rule ? rule.query_rule_id : null,
    raised_by: raisedBy,
    source,
    subject,
    details,
    evidence,
    response_due_at: responseDue,
    dedup_key: dedupKey,
    policy_version_id: citation ? citation.policy_version_id : null,
    policy_clause: citation ? clause : null,
  });
  if (!id) return null;
  if (signature) await repo.setSignature(client, id, await storeSignature(client, signature, { type: "query", id }, actor));
  const doc = await documents.generate(client, {
    doc_type: QUERY_LETTER,
    template: letterKey,
    entity: { type: "query", id },
    subject_employee_id: person.employee_id,
    data: letterData(person, { number, subject, details, response_due_at: responseDue }, signer, quoted(citation, clause)),
    actor,
  });
  await repo.setLetter(client, id, doc.document_id);
  await emit(client, {
    key: EVENTS.QUERY_RAISED,
    entity: { type: "query", id },
    actor,
    after: { number, employee_id: person.employee_id, subject, query_rule_id: rule ? rule.query_rule_id : null },
    payload: {
      employee_query_id: id,
      number,
      subject,
      employee_id: person.employee_id,
      subject_employee_id: person.employee_id,
      raised_by: raisedBy,
      query_rule_id: rule ? rule.query_rule_id : null,
    },
  });
  return id;
}

/** The person a query is about: someone who works here now. */
async function activePerson(db, employeeId) {
  const person = await repo.employeeOf(db, employeeId);
  if (!person || person.status !== "active")
    throw new AppError("EMPLOYEE_NOT_ACTIVE", "Pick someone who works here now", 422, {
      employee_id: ["Not active"],
    });
  return person;
}

/** A manager or People raise a query (POST /queries). */
async function raise(actor, scope, body) {
  if (actor.employee_id && actor.employee_id === body.employee_id)
    throw new AppError("QUERY_SELF", "You cannot raise a query on yourself", 422, {
      employee_id: ["Not yourself"],
    });
  const id = await tx(async (client) => {
    const person = await activePerson(client, body.employee_id);
    const letterKey = await templates.usable(client, body.letter_template, "query", { fallback: "query-letter" });
    const me = actor.employee_id ? await repo.employeeOf(client, actor.employee_id) : null;
    const citation = body.policy_id ? await policies().citation(client, body.policy_id) : null;
    if (body.policy_id && !citation)
      throw new AppError("POLICY_NOT_IN_FORCE", "That policy has no version in force", 422, { policy_id: ["Not in force"] });
    return insertQuery(client, {
      person,
      subject: body.subject,
      details: body.details,
      evidence: [],
      rule: null,
      raisedBy: actor.user_id,
      source: "person",
      dedupKey: null,
      letterKey,
      signer: me
        ? { name: me.display_name, role: me.job_title || "Manager", signature: body.signature }
        : { ...PEOPLE_SIGNER, signature: body.signature },
      signature: body.signature,
      citation,
      clause: body.policy_clause || null,
      actor,
    });
  });
  return get(id, actor, scope);
}

/**
 * A rule's breach raises one query (query_rules.evaluator). Returns the new query's id,
 * or null when this breach already raised one or the person no longer works here.
 * @param {{rule: object, employee_id: string, subject: string, details: string,
 *          evidence: object[], dedup_key: string}} breach
 */
async function raiseForRule(client, breach) {
  const person = await repo.employeeOf(client, breach.employee_id);
  if (!person || person.status !== "active") return null;
  const letterKey = (await templates.isReady(client, breach.rule.letter_template, "query"))
    ? breach.rule.letter_template
    : await templates.usable(client, "query-letter", "query");
  // The policy the rule enforces, as in force today; without a version in force, no citation.
  const citation = breach.rule.policy_id ? await policies().citation(client, breach.rule.policy_id) : null;
  return insertQuery(client, {
    person,
    subject: breach.subject,
    details: breach.details,
    evidence: breach.evidence,
    rule: breach.rule,
    raisedBy: null,
    source: "rule",
    dedupKey: breach.dedup_key,
    letterKey,
    signer: PEOPLE_SIGNER,
    citation,
    clause: breach.rule.policy_clause || null,
    actor: null,
  });
}

/**
 * An Attendance policy breach with Raise Query on raises one query (guide §6.2), its days as
 * evidence and the policy version in force when it was crossed cited, then the breach keeps it.
 * The attendance service reads the breach and links it back: this module never touches its table.
 * A breach already answered, not asking for a query, or about someone who has left raises nothing.
 * @returns {Promise<string|null>} the new query's id
 */
async function raiseFromBreach(breachId) {
  const attendance = require("../attendance/attendance.service");
  return tx(async (client) => {
    const breach = await attendance.breachForQuery(client, breachId);
    if (!breach) return null;
    const person = await repo.employeeOf(client, breach.employee_id);
    if (!person || person.status !== "active") return null;
    const citation = breach.policy_version_id ? await policies().citationOfVersion(client, breach.policy_version_id) : null;
    const id = await insertQuery(client, {
      person,
      subject: breach.subject,
      details: breach.details,
      evidence: breach.evidence,
      rule: null,
      raisedBy: null,
      source: "attendance",
      dedupKey: `attendance-breach:${breach.attendance_rule_breach_id}`,
      letterKey: await templates.usable(client, "query-letter", "query"),
      signer: PEOPLE_SIGNER,
      citation,
      clause: null,
      actor: null,
    });
    if (id) await attendance.attachQuery(client, breach.attendance_rule_breach_id, id);
    return id;
  });
}

/* ------------------------------------------------------------------ *
 * Reminding and deciding
 * ------------------------------------------------------------------ */

async function remind(actor, scope, id) {
  const reader = visibility.readerOf(scope, actor);
  await tx(async (client) => {
    await repo.lock(client, id);
    const row = await visibleRow(client, reader, id);
    if (!remindable(row, true))
      throw new AppError("QUERY_NOT_REMINDABLE", "A reminder cannot be sent now", 409);
    await repo.setReminded(client, id);
    await emit(client, {
      key: EVENTS.QUERY_REMINDED,
      entity: { type: "query", id },
      actor,
      payload: { employee_query_id: id, number: row.number, employee_id: row.employee_id, subject_employee_id: row.employee_id },
    });
  });
  return get(id, actor, scope);
}

/**
 * Record a decision (POST /queries/:id/decision). `no_action` resolves the query here;
 * `sanction` writes the proposal and opens its approval (queries.escalate.js).
 */
async function decide(actor, scope, id, body) {
  const reader = visibility.readerOf(scope, actor);
  await tx(async (client) => {
    await repo.lock(client, id);
    const row = await visibleRow(client, reader, id);
    if (!decidable(row, actor, true)) {
      if (actor.employee_id && actor.employee_id === row.employee_id) throw notFound();
      throw new AppError(
        "QUERY_NOT_DECIDABLE",
        row.status === "resolved" ? "This query is already closed" : "Wait for the response or the deadline",
        409,
      );
    }
    if (body.outcome === "no_action") {
      await repo.resolve(client, id, { outcome: "no_action", reviewed_by: actor.user_id });
      await emit(client, {
        key: EVENTS.QUERY_CLOSED,
        entity: { type: "query", id },
        actor,
        before: { status: row.status },
        after: { status: "resolved", outcome: "no_action", reason: body.reason },
        payload: { employee_query_id: id, number: row.number, employee_id: row.employee_id, subject_employee_id: row.employee_id },
      });
      return;
    }
    await require("./queries.escalate").propose(client, actor, row, body);
  });
  return get(id, actor, scope);
}

/* ------------------------------------------------------------------ *
 * For the sanctions module, after its approval
 * ------------------------------------------------------------------ */

/** The query a sanction follows, for its letter and checks; not filtered. */
const rowFor = (db, id) => repo.get(db, id);

/** The approval ended: the query is resolved (sanctioned) or back under review. */
async function settleEscalation(client, id, { issued, reviewedBy }) {
  if (issued) await repo.resolve(client, id, { outcome: "sanctioned", reviewed_by: reviewedBy });
  else await repo.setReview(client, id, null);
}

/* ------------------------------------------------------------------ *
 * ESS · My Queries
 * ------------------------------------------------------------------ */

async function listMine(employeeId, query) {
  const page = await repo.listMine(pool, employeeId, query);
  return { ...page, data: await Promise.all(page.data.map((row) => readable(pool, row))) };
}
const mineSummary = (employeeId) => repo.mineSummary(pool, employeeId);

async function getMine(employeeId, id) {
  const row = await repo.getMine(pool, employeeId, id);
  if (!row) throw notFound();
  return readable(pool, row);
}

const respond = (user, employeeId, id, body) => require("./queries.response").respond(user, employeeId, id, body);

/* ------------------------------------------------------------------ *
 * After commit
 * ------------------------------------------------------------------ */

/** document.generated for a query letter: email it to the employee, with the PDF. */
async function emailLetter(documentId) {
  const doc = await vault.get(pool, documentId);
  if (!doc || doc.doc_type !== QUERY_LETTER || doc.entity_type !== "query") return;
  const row = await repo.get(pool, doc.entity_id);
  if (!row || row.letter_document_id !== documentId) return;
  const person = await repo.employeeOf(pool, row.employee_id);
  if (!person || !person.work_email) return;
  const queues = require("../../jobs/queues");
  await queues.enqueue(
    "email-send",
    "query-raised",
    {
      to: { name: person.display_name, email: person.work_email },
      recipient: { first_name: person.called, last_name: null, email: person.work_email },
      template: "query-raised",
      data: { query_number: row.number, subject: row.subject, response_due: row.response_due_at },
      attachments: [{ document_id: documentId }],
    },
    { jobId: `query-letter-${documentId}` },
  );
}

module.exports = {
  RESPONSE_HOURS,
  list,
  summary,
  get,
  raise,
  raiseForRule,
  raiseFromBreach,
  remind,
  decide,
  rowFor,
  settleEscalation,
  listMine,
  mineSummary,
  getMine,
  respond,
  emailLetter,
  letterData,
  storeSignature,
  decidable,
  remindable,
};
