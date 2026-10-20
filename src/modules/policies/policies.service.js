"use strict";
/**
 * Policies: the one write path for every policy, its drafts, submissions, versions, signatures and
 * acknowledgements, and the reads behind Knowledge Hub · Policies and ESS · Policy Updates
 * (docs/guides/policies.md §6).
 *
 *   saveDraft      People save a draft: a written policy's text as Markdown, a rules policy's rules
 *                  checked by its type. Nobody is told
 *   publish        Needs Approval off: the draft becomes `Version N` from a first day, signed by the
 *                  publisher; everyone it applies to is told
 *   submit         Needs Approval on: the draft waits on policy.approval, signed by the submitter;
 *                  each approver approves and signs (approve) or rejects (reject); the last approval
 *                  publishes it (settleApproval, after commit)
 *   withdraw       a version waiting to start never applies; with no draft its content becomes one
 *   acknowledge    a person acknowledges the newest version of a policy that applies to them
 *   rulesFor       the port a module reads its rules policy through (§6.8)
 *
 * Every change to one policy runs under its lock. Events carry ids, the number, the version, the
 * title and the first day, never the text.
 */
const crypto = require("node:crypto");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const numbering = require("../../shared/numbering/numbering");
const lagos = require("../../shared/time/lagos");
const workflow = require("../../shared/workflow/engine");
const vault = require("../../shared/documents/vault");
const documents = require("../../shared/documents/generate");
const exportFiles = require("../../shared/documents/exports");
const canonical = require("../../shared/documents/canonical");
const md = require("../../shared/documents/markdown");
const grantsCache = require("../../shared/rbac/grants-cache");
const storage = require("../../services/storage/storage.service");
const notifications = require("../notifications/notifications.service");
const identity = require("../identity/identity.service");
const types = require("./policies.types");
const repo = require("./policies.repo");
const { EVENTS, APPROVAL_KEY, VERSION_ENTITY, SIGNATURE_DOC_TYPE, PDF_DOC_TYPE } = require("./policies.events");

/** How far ahead a version may start, in days. */
const AHEAD_DAYS = 90;
/** How long after a version is published the people who have not acknowledged it are reminded. */
const REMIND_AFTER_DAYS = 3;
/** The most change lines a person is shown for one version. */
const MAX_CHANGE_LINES = 5;
const WORK_PATTERN_LABEL = Object.freeze({ on_site: "On-site staff", hybrid: "Hybrid staff", remote: "Remote staff" });

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That policy does not exist", 404);
const versionNotFound = () => new AppError("NOT_FOUND", "That policy version does not exist", 404);
const iso = (t) => (t ? new Date(t).toISOString() : null);
const day = (d) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : null);

/* ------------------------------------------------------------------ *
 * Pure
 * ------------------------------------------------------------------ */

/** A version's Applies To from its row and its audience rows. */
function appliesToOf(row, audience) {
  const own = audience.filter((a) => a.policy_version_id === row.policy_version_id);
  return {
    everyone: Boolean(row.applies_to_everyone),
    department_ids: own.filter((a) => a.department_id).map((a) => a.department_id),
    work_patterns: own.filter((a) => a.work_pattern).map((a) => a.work_pattern),
    employee_ids: own.filter((a) => a.employee_id).map((a) => a.employee_id),
  };
}

/** Applies To in words: "Everyone", or "Operations, Remote staff and 2 people". */
function appliesToText(row, audience) {
  if (row.applies_to_everyone) return "Everyone";
  const own = audience.filter((a) => a.policy_version_id === row.policy_version_id);
  const people = own.filter((a) => a.employee_id);
  const parts = [
    ...own.filter((a) => a.department_id).map((a) => a.department_name || "A department"),
    ...own.filter((a) => a.work_pattern).map((a) => WORK_PATTERN_LABEL[a.work_pattern]),
  ];
  if (people.length === 1) parts.push(people[0].employee_name || "1 person");
  else if (people.length > 1) parts.push(`${people.length} people`);
  if (!parts.length) return "Nobody yet";
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** A rules version's rules, parsed with its type's defaults. */
function rulesOf(kind, raw) {
  const spec = types.typeOf(kind);
  return spec ? spec.read.parse(raw || {}) : null;
}

const sameSet = (a, b) => [...a].sort().join() === [...b].sort().join();
const sameAudience = (a, b) =>
  a.everyone === b.everyone &&
  sameSet(a.department_ids, b.department_ids) &&
  sameSet(a.work_patterns, b.work_patterns) &&
  sameSet(a.employee_ids, b.employee_ids);

/**
 * What `next` changes against `prev` (the version before it), as keys and as lines a person reads.
 * @param {string} kind
 * @param {{title: string, body_markdown: string|null, rules: object|null, applies_to: object, applies_to_text: string}|null} prev
 * @param {typeof prev} next
 */
function changesOf(kind, prev, next) {
  if (!prev) return { changed: [], change_lines: [] };
  const keys = [];
  const lines = [];
  if (prev.title !== next.title) {
    keys.push("title");
    lines.push(`Title: ${prev.title} to ${next.title}`);
  }
  if (!sameAudience(prev.applies_to, next.applies_to)) {
    keys.push("applies_to");
    lines.push(`Applies To: ${prev.applies_to_text} to ${next.applies_to_text}`);
  }
  const spec = types.typeOf(kind);
  if (spec) {
    keys.push(...spec.changed(prev.rules, next.rules));
    lines.push(...spec.changeLines(prev.rules, next.rules));
  } else if ((prev.body_markdown || "") !== (next.body_markdown || "")) {
    keys.push("text");
    lines.push("The text changed");
  }
  return { changed: keys, change_lines: lines.slice(0, MAX_CHANGE_LINES) };
}

/** What a version says, for the hash, the screens and the PDF. */
function contentOf(row, audience) {
  return {
    title: row.title,
    body_markdown: row.body_markdown,
    rules: rulesOf(row.kind, row.rules),
    raw_rules: row.rules || null,
    applies_to: appliesToOf(row, audience),
    applies_to_text: appliesToText(row, audience),
  };
}

/** The canonical hash of what staff read in a version (shared/documents/canonical.js). */
function hashOf(policy, content, { versionNo = 0, effectiveFrom = "" } = {}) {
  return canonical.hash("POLICY_VERSION", {
    number: policy.number,
    version: versionNo,
    title: content.title,
    effective_from: effectiveFrom,
    applies_to: content.applies_to,
    body_markdown: content.body_markdown,
    rules: content.raw_rules,
  });
}

/** A version's state on `today`, given the one in force. */
function stateOf(row, today, inForceId) {
  if (row.status === "submitted") return "awaiting_approval";
  if (row.status === "withdrawn") return "withdrawn";
  if (day(row.effective_from) > today) return "waiting";
  return row.policy_version_id === inForceId ? "in_force" : "past";
}

/** A policy's state: archived, awaiting approval, in force, waiting, or a draft only. */
function policyState(policy, { inForce, waiting, submission }) {
  if (policy.status === "archived") return "archived";
  if (submission) return "awaiting_approval";
  if (inForce) return "in_force";
  if (waiting) return "waiting";
  return "draft";
}

/* ------------------------------------------------------------------ *
 * Reading versions
 * ------------------------------------------------------------------ */

/** Everything a page of version rows needs: their audiences, signatures and the versions before them. */
async function decorate(db, rows, today) {
  const ids = rows.map((r) => r.policy_version_id);
  const prevRows = await Promise.all(
    rows.map((r) => (r.version ? repo.previousPublished(db, r.policy_id, r.version) : repo.newestPublished(db, r.policy_id))),
  );
  const prevIds = prevRows.filter(Boolean).map((r) => r.policy_version_id);
  const [audience, signatures, counts] = await Promise.all([
    repo.audienceOf(db, [...new Set([...ids, ...prevIds])]),
    repo.signaturesOf(db, ids),
    repo.counts(db, ids, today),
  ]);
  return rows.map((row, i) => {
    const content = contentOf(row, audience);
    const prevRow = prevRows[i] && prevRows[i].policy_version_id !== row.policy_version_id ? prevRows[i] : null;
    const prev = prevRow ? contentOf(prevRow, audience) : null;
    const change = changesOf(row.kind, prev, content);
    const spec = types.typeOf(row.kind);
    return {
      row,
      content,
      change,
      body: spec ? null : md.markdownToBlocks(row.body_markdown || ""),
      sections: spec ? spec.sections(content.rules, change.changed) : null,
      signatures: signatures
        .filter((s) => s.policy_version_id === row.policy_version_id)
        .map((s) => ({
          role: s.role,
          stage_name: s.stage_name || null,
          signer_name: s.signer_name,
          signer_title: s.signer_title || null,
          signed_at: iso(s.signed_at),
          signature_document_id: s.signature_document_id,
        })),
      counts: counts.get(row.policy_version_id) || { asked: 0, acknowledged: 0, overdue: 0 },
    };
  });
}

const publicSignature = ({ signature_document_id: _doc, ...s }) => s;

/** A decorated version as People read it (PolicyVersion). */
function asVersion(d, today, inForceId) {
  const { row, content } = d;
  return {
    policy_version_id: row.policy_version_id,
    policy_id: row.policy_id,
    number: row.number,
    kind: row.kind,
    version: row.version === null ? null : Number(row.version),
    state: stateOf(row, today, inForceId),
    effective_from: day(row.effective_from),
    note: row.note || "",
    title: content.title,
    applies_to: content.applies_to,
    applies_to_text: content.applies_to_text,
    needs_acknowledgement: row.needs_acknowledgement,
    acknowledge_within_days: Number(row.acknowledge_within_days),
    body: d.body,
    rules: content.rules,
    sections: d.sections,
    changed: d.change.changed,
    change_lines: d.change.change_lines,
    published_at: iso(row.published_at),
    published_by_name: row.published_by_name || null,
    withdrawn_at: iso(row.withdrawn_at),
    withdraw_reason: row.withdraw_reason || null,
    signatures: d.signatures.map(publicSignature),
    content_hash: row.content_hash || "",
    asked: d.counts.asked,
    acknowledged: d.counts.acknowledged,
    overdue: d.counts.overdue,
  };
}

/** The version in force, the newest waiting, the draft and the submission of one policy. */
async function landscape(db, policy, today) {
  const [inForce, newest, draft, submission] = await Promise.all([
    repo.versionInForce(db, policy.policy_id, today),
    repo.newestPublished(db, policy.policy_id),
    repo.workingVersion(db, policy.policy_id, "draft"),
    repo.workingVersion(db, policy.policy_id, "submitted"),
  ]);
  const waiting = newest && day(newest.effective_from) > today ? newest : null;
  return { inForce, waiting, newest, draft, submission, inForceId: inForce ? inForce.policy_version_id : null };
}

/** The policy an id names. */
async function policyOf(db, id) {
  const policy = await repo.getPolicy(db, id);
  if (!policy) throw notFound();
  return policy;
}

/** The name of the stage an approval waits at, or null. */
async function stageName(db, instanceId) {
  if (!instanceId) return null;
  const instance = await workflow.getInstance(db, instanceId);
  if (!instance || instance.state !== "pending") return null;
  const def = await require("../../shared/workflow/definitions").findById(db, instance.workflow_definition_id);
  const stage = def && (def.stages || []).find((s) => s.key === instance.current_stage);
  return stage ? stage.name : null;
}

/* ------------------------------------------------------------------ *
 * Reads for People (Knowledge Hub · Policies)
 * ------------------------------------------------------------------ */

/** GET /policies/:id */
async function get(user, id, { db = pool } = {}) {
  const today = lagos.today();
  const policy = await policyOf(db, id);
  const land = await landscape(db, policy, today);
  const shown = [land.inForce, land.waiting].filter(Boolean);
  const decorated = await decorate(db, shown, today);
  const byId = new Map(decorated.map((d) => [d.row.policy_version_id, d]));
  const draftRow = land.draft;
  let draft = null;
  if (draftRow) {
    const [audience, baseAudience] = await Promise.all([
      repo.audienceOf(db, [draftRow.policy_version_id]),
      land.newest ? repo.audienceOf(db, [land.newest.policy_version_id]) : [],
    ]);
    const content = contentOf(draftRow, audience);
    const base = land.newest ? contentOf(land.newest, baseAudience) : null;
    const change = changesOf(policy.kind, base, content);
    draft = {
      policy_version_id: draftRow.policy_version_id,
      title: content.title,
      applies_to: content.applies_to,
      needs_acknowledgement: draftRow.needs_acknowledgement,
      acknowledge_within_days: Number(draftRow.acknowledge_within_days),
      needs_approval: draftRow.needs_approval,
      body_html: types.typeOf(policy.kind) ? null : md.markdownToHtml(draftRow.body_markdown || ""),
      rules: content.rules,
      changed: change.changed,
      change_lines: change.change_lines,
      updated_at: iso(draftRow.updated_at),
      updated_by_name: draftRow.updated_by_name || null,
    };
  }
  const submission = land.submission
    ? {
        policy_version_id: land.submission.policy_version_id,
        effective_from: day(land.submission.effective_from),
        note: land.submission.note || "",
        submitted_at: iso(land.submission.submitted_at),
        submitted_by_name: land.submission.submitted_by_name || null,
        stage_name: await stageName(db, land.submission.workflow_instance_id),
        workflow_instance_id: land.submission.workflow_instance_id || null,
      }
    : null;
  const spec = types.typeOf(policy.kind);
  return {
    policy_id: policy.policy_id,
    number: policy.number,
    kind: policy.kind,
    title: policy.title,
    state: policyState(policy, land),
    today,
    current_rules: spec ? rulesOf(policy.kind, land.inForce ? land.inForce.rules : null) : null,
    in_force: land.inForce ? asVersion(byId.get(land.inForce.policy_version_id), today, land.inForceId) : null,
    waiting: land.waiting ? asVersion(byId.get(land.waiting.policy_version_id), today, land.inForceId) : null,
    draft,
    submission,
    can_edit: policy.status === "active" && Boolean(user),
    can_archive: policy.status === "active" && policy.kind === "document",
  };
}

/** GET /policies */
async function list(query, { db = pool } = {}) {
  const today = lagos.today();
  const page = await repo.listPolicies(db, query, today);
  const ids = page.data.map((r) => r.newest_version_id || r.working_version_id).filter(Boolean);
  const [audience, counts] = await Promise.all([
    repo.audienceOf(db, ids),
    repo.counts(db, page.data.map((r) => r.newest_version_id).filter(Boolean), today),
  ]);
  const byId = new Map(
    (await Promise.all(ids.map((id) => repo.getVersion(db, id)))).filter(Boolean).map((v) => [v.policy_version_id, v]),
  );
  return {
    ...page,
    data: page.data.map((r) => {
      const v = byId.get(r.newest_version_id || r.working_version_id);
      const n = counts.get(r.newest_version_id) || { asked: 0, acknowledged: 0 };
      return {
        policy_id: r.policy_id,
        number: r.number,
        kind: r.kind,
        title: r.title,
        state: r.state,
        applies_to_text: v ? appliesToText(v, audience) : "Everyone",
        version_in_force: r.version_in_force === null ? null : Number(r.version_in_force),
        asked: n.asked,
        acknowledged: n.acknowledged,
        updated_at: iso(r.updated_at),
      };
    }),
  };
}

/** GET /policies/:id/versions */
async function versions(id, query, { db = pool } = {}) {
  const today = lagos.today();
  const policy = await policyOf(db, id);
  const inForce = await repo.versionInForce(db, policy.policy_id, today);
  const inForceId = inForce ? inForce.policy_version_id : null;
  const page = await repo.listVersions(db, policy.policy_id, query, { today, inForceId });
  const decorated = await decorate(db, page.data, today);
  return { ...page, data: decorated.map((d) => asVersion(d, today, inForceId)) };
}

/** GET /policies/versions/:id */
async function version(id, { db = pool } = {}) {
  const today = lagos.today();
  const row = await repo.getVersion(db, id);
  if (!row || row.status === "draft") throw versionNotFound();
  const inForce = await repo.versionInForce(db, row.policy_id, today);
  const [d] = await decorate(db, [row], today);
  return asVersion(d, today, inForce ? inForce.policy_version_id : null);
}

/** GET /policies/versions/:id/acknowledgements: everyone asked, within the reader's scope. */
async function acknowledgements(id, query, scope, { db = pool } = {}) {
  const row = await repo.getVersion(db, id);
  if (!row || !["published", "withdrawn"].includes(row.status)) throw versionNotFound();
  const page = await repo.listAcknowledgements(db, id, query, scope, lagos.today());
  return {
    ...page,
    data: page.data.map((r) => ({
      employee: r.employee,
      status: r.status,
      due_on: day(r.due_on),
      acknowledged_at: iso(r.acknowledged_at),
      reminded_at: iso(r.reminded_at),
    })),
  };
}

/* ------------------------------------------------------------------ *
 * Writes for People
 * ------------------------------------------------------------------ */

/** The fields a draft keeps, from what People sent, for a policy of `kind`. */
function draftFields(kind, body) {
  const spec = types.typeOf(kind);
  if (spec) {
    if (!body.rules)
      throw new AppError("RULES_REQUIRED", "Set the rules", 422, { rules: ["Set the rules"] });
    if (body.body_html)
      throw new AppError("NO_TEXT_ON_RULES", "A rules policy has no text of its own", 422, { body_html: ["Not here"] });
    // The type's own draft schema: the contract checked AttendanceRulesDraft, which is the only one today.
    spec.draft.parse(body.rules);
  } else if (body.rules) {
    throw new AppError("NO_RULES_ON_TEXT", "A written policy has no rules", 422, { rules: ["Not here"] });
  }
  return {
    title: body.title,
    body_markdown: spec ? null : md.htmlToMarkdown(body.body_html || ""),
    rules: spec ? body.rules : null,
    applies_to_everyone: body.applies_to.everyone,
    needs_acknowledgement: body.needs_acknowledgement,
    acknowledge_within_days: body.acknowledge_within_days,
    needs_approval: body.needs_approval,
  };
}

/**
 * POST /policies: a written policy, numbered, with an empty draft.
 * @param {{user_id: string}} user
 */
async function create(user, body) {
  const id = await tx(async (client) => {
    const { number } = await numbering.allocate(client, "policy");
    const policy = await repo.insertPolicy(client, { number, kind: "document", title: body.title, userId: user.user_id });
    const draft = await repo.insertDraft(
      client,
      policy.policy_id,
      { ...draftFields("document", { ...body, body_html: "" }) },
      user.user_id,
    );
    await repo.replaceAudience(client, draft.policy_version_id, body.applies_to);
    await emit(client, {
      key: EVENTS.POLICY_CREATED,
      entity: { type: "policy", id: policy.policy_id },
      actor: user,
      after: { number, title: body.title },
      payload: { policy_id: policy.policy_id, number },
    });
    return policy.policy_id;
  });
  return get(user, id);
}

/** PUT /policies/:id/draft */
async function saveDraft(user, id, body) {
  const policyId = await tx(async (client) => {
    const policy = await policyOf(client, id);
    await repo.lock(client, policy.policy_id);
    if (policy.status !== "active") throw new AppError("POLICY_ARCHIVED", "This policy is archived", 409);
    if (await repo.workingVersion(client, policy.policy_id, "submitted"))
      throw new AppError("POLICY_SUBMITTED", "Recall the version waiting for approval first", 409);
    const fields = draftFields(policy.kind, body);
    const existing = await repo.workingVersion(client, policy.policy_id, "draft");
    const row = existing
      ? await repo.updateDraft(client, existing.policy_version_id, fields, user.user_id)
      : await repo.insertDraft(client, policy.policy_id, fields, user.user_id);
    await repo.replaceAudience(client, row.policy_version_id, body.applies_to);
    await emit(client, {
      key: EVENTS.POLICY_DRAFT_SAVED,
      entity: { type: "policy", id: policy.policy_id },
      actor: user,
      before: existing ? { title: existing.title, rules: existing.rules, body_markdown: existing.body_markdown } : null,
      after: { title: fields.title, rules: fields.rules, body_markdown: fields.body_markdown },
      payload: { policy_id: policy.policy_id, policy_version_id: row.policy_version_id, created: !existing },
    });
    return policy.policy_id;
  });
  return get(user, policyId);
}

/** POST /policies/:id/draft/discard */
async function discardDraft(user, id) {
  const policyId = await tx(async (client) => {
    const policy = await policyOf(client, id);
    await repo.lock(client, policy.policy_id);
    const draft = await repo.workingVersion(client, policy.policy_id, "draft");
    if (!draft || !(await repo.deleteDraft(client, draft.policy_version_id)))
      throw new AppError("NO_DRAFT", "There is no draft", 409);
    await emit(client, {
      key: EVENTS.POLICY_DRAFT_DISCARDED,
      entity: { type: "policy", id: policy.policy_id },
      actor: user,
      before: { title: draft.title, rules: draft.rules, body_markdown: draft.body_markdown },
      payload: { policy_id: policy.policy_id, policy_version_id: draft.policy_version_id },
    });
    return policy.policy_id;
  });
  return get(user, policyId);
}

/** The first day's checks (§6.3), against today and any version still waiting. */
async function checkFirstDay(client, policyId, from, today) {
  if (from < today)
    throw new AppError("POLICY_IN_THE_PAST", "The first day is today or later.", 422, { effective_from: ["Today or later"] });
  if (from > lagos.addDays(today, AHEAD_DAYS))
    throw new AppError("POLICY_TOO_FAR", `The first day is within ${AHEAD_DAYS} days.`, 422, {
      effective_from: [`Within ${AHEAD_DAYS} days`],
    });
  const waitingStart = await repo.lastWaitingStart(client, policyId, today);
  if (waitingStart && from <= day(waitingStart))
    throw new AppError("POLICY_BEFORE_WAITING", "Start it after the version waiting to start.", 422, {
      effective_from: ["After the waiting version"],
    });
}

/** A draft ready to go: it says something, and it changes something once a version exists. */
async function readyDraft(client, policy) {
  const draft = await repo.workingVersion(client, policy.policy_id, "draft");
  if (!draft) throw new AppError("NO_DRAFT", "Save the changes as a draft first", 409);
  if (policy.kind === "document" && !(draft.body_markdown || "").trim())
    throw new AppError("POLICY_EMPTY", "Write the policy first", 422, { body_html: ["Write the policy"] });
  const newest = await repo.newestPublished(client, policy.policy_id);
  const audience = await repo.audienceOf(client, [draft.policy_version_id, ...(newest ? [newest.policy_version_id] : [])]);
  const content = contentOf(draft, audience);
  if (newest) {
    const base = contentOf(newest, audience);
    if (changesOf(policy.kind, base, content).changed.length === 0 && content.body_markdown === base.body_markdown)
      throw new AppError("NO_CHANGES", "The draft changes nothing", 409);
  }
  if (!content.applies_to.everyone && !audience.some((a) => a.policy_version_id === draft.policy_version_id))
    throw new AppError("NOBODY_ASKED", "Pick who it applies to", 422, { applies_to: ["Pick who it applies to"] });
  return { draft, content, newest };
}

/** A drawn signature stored in the vault and named on the version. */
async function sign(client, { target, role, stage, user, png, contentHash }) {
  const buffer = Buffer.from(String(png).replace(/^data:image\/png;base64,/, ""), "base64");
  const doc = await vault.store(client, {
    file: { buffer, originalname: "signature.png" },
    purpose: "signature",
    doc_type: SIGNATURE_DOC_TYPE,
    entity: { type: VERSION_ENTITY, id: target.policy_version_id },
    sensitivity: "normal",
    actor: user,
  });
  await repo.insertSignature(client, {
    policy_version_id: target.policy_version_id,
    role,
    stage_key: stage ? stage.key : null,
    stage_name: stage ? stage.name : null,
    user_id: user.user_id,
    document_id: doc.document_id,
    content_hash: contentHash,
  });
}

/** The published version's event, for a direct publication or the last approval. */
function publishedEvent(policy, versionId, { number, from, needsAck, title }) {
  return {
    key: EVENTS.POLICY_PUBLISHED,
    entity: { type: VERSION_ENTITY, id: versionId },
    payload: {
      policy_id: policy.policy_id,
      policy_version_id: versionId,
      number: policy.number,
      kind: policy.kind,
      title,
      version: number,
      effective_from: from,
      needs_acknowledgement: needsAck,
    },
  };
}

/** POST /policies/:id/publish: Needs Approval off. */
async function publish(user, id, body) {
  const today = lagos.today();
  const policyId = await tx(async (client) => {
    const policy = await policyOf(client, id);
    await repo.lock(client, policy.policy_id);
    if (policy.status !== "active") throw new AppError("POLICY_ARCHIVED", "This policy is archived", 409);
    const { draft, content, newest } = await readyDraft(client, policy);
    if (draft.needs_approval)
      throw new AppError("POLICY_NEEDS_APPROVAL", "This policy needs approval: submit it", 409);
    await checkFirstDay(client, policy.policy_id, body.effective_from, today);
    const number = await repo.nextVersion(client, policy.policy_id);
    const contentHash = hashOf(policy, content, { versionNo: number, effectiveFrom: body.effective_from });
    await sign(client, { target: draft, role: "publisher", user, png: body.signature, contentHash });
    await repo.publish(client, draft.policy_version_id, {
      version: number,
      effective_from: body.effective_from,
      note: body.note,
      contentHash,
      userId: user.user_id,
    });
    await repo.renamePolicy(client, policy.policy_id, content.title, user.user_id);
    await emit(client, {
      ...publishedEvent(policy, draft.policy_version_id, {
        number,
        from: body.effective_from,
        needsAck: draft.needs_acknowledgement,
        title: content.title,
      }),
      actor: user,
      before: newest ? { version: Number(newest.version) } : null,
      after: { version: number, effective_from: body.effective_from, content_hash: contentHash },
    });
    return policy.policy_id;
  });
  return get(user, policyId);
}

/** POST /policies/:id/submit: Needs Approval on. */
async function submit(user, id, body) {
  const today = lagos.today();
  const policyId = await tx(async (client) => {
    const policy = await policyOf(client, id);
    await repo.lock(client, policy.policy_id);
    if (policy.status !== "active") throw new AppError("POLICY_ARCHIVED", "This policy is archived", 409);
    if (await repo.workingVersion(client, policy.policy_id, "submitted"))
      throw new AppError("POLICY_SUBMITTED", "A version is already waiting for approval", 409);
    const { draft, content } = await readyDraft(client, policy);
    if (!draft.needs_approval)
      throw new AppError("POLICY_NO_APPROVAL", "This policy needs no approval: publish it", 409);
    await checkFirstDay(client, policy.policy_id, body.effective_from, today);
    const contentHash = hashOf(policy, content, { effectiveFrom: body.effective_from });
    await sign(client, { target: draft, role: "publisher", user, png: body.signature, contentHash });
    await repo.submit(client, draft.policy_version_id, {
      effective_from: body.effective_from,
      note: body.note,
      contentHash,
      userId: user.user_id,
    });
    await emit(client, {
      key: EVENTS.POLICY_SUBMITTED,
      entity: { type: VERSION_ENTITY, id: draft.policy_version_id },
      actor: user,
      after: { effective_from: body.effective_from, content_hash: contentHash },
      payload: { policy_id: policy.policy_id, policy_version_id: draft.policy_version_id, title: content.title },
    });
    const instance = await workflow.openInstance(client, {
      definition_key: APPROVAL_KEY,
      entity: { type: VERSION_ENTITY, id: draft.policy_version_id },
      subject_employee_id: user.employee_id || null,
      context: {},
      actor: user,
    });
    await repo.setWorkflowInstance(client, draft.policy_version_id, instance.workflow_instance_id);
    return policy.policy_id;
  });
  return get(user, policyId);
}

/** POST /policies/:id/recall: the submitter (or the CEO) takes a submission back to the draft. */
async function recall(user, id, body) {
  const policyId = await tx(async (client) => {
    const policy = await policyOf(client, id);
    await repo.lock(client, policy.policy_id);
    const submission = await repo.workingVersion(client, policy.policy_id, "submitted");
    if (!submission) throw new AppError("NOT_SUBMITTED", "Nothing is waiting for approval", 409);
    if (submission.workflow_instance_id)
      await workflow.cancel(client, { instance_id: submission.workflow_instance_id, actor: user, reason: body.reason });
    await repo.backToDraft(client, submission.policy_version_id);
    await emit(client, {
      key: EVENTS.POLICY_RECALLED,
      entity: { type: VERSION_ENTITY, id: submission.policy_version_id },
      actor: user,
      after: { status: "draft", reason: body.reason },
      payload: { policy_id: policy.policy_id, policy_version_id: submission.policy_version_id },
    });
    return policy.policy_id;
  });
  return get(user, policyId);
}

/** POST /policies/versions/:id/withdraw: a version waiting to start never applies. */
async function withdraw(user, versionId, body) {
  const today = lagos.today();
  const policyId = await tx(async (client) => {
    const row = await repo.getVersion(client, versionId);
    if (!row) throw versionNotFound();
    await repo.lock(client, row.policy_id);
    if (!(await repo.withdraw(client, versionId, { reason: body.reason, userId: user.user_id, today })))
      throw new AppError("POLICY_NOT_WAITING", "Only a version waiting to start can be withdrawn", 409);
    // Nothing People prepared is lost: with no draft and nothing submitted, its content becomes the draft.
    let draftId = null;
    const working =
      (await repo.workingVersion(client, row.policy_id, "draft")) ||
      (await repo.workingVersion(client, row.policy_id, "submitted"));
    if (!working) {
      const draft = await repo.insertDraft(
        client,
        row.policy_id,
        {
          title: row.title,
          body_markdown: row.body_markdown,
          rules: row.rules,
          applies_to_everyone: row.applies_to_everyone,
          needs_acknowledgement: row.needs_acknowledgement,
          acknowledge_within_days: row.acknowledge_within_days,
          needs_approval: row.needs_approval,
        },
        user.user_id,
      );
      await repo.copyAudience(client, versionId, draft.policy_version_id);
      draftId = draft.policy_version_id;
    }
    await emit(client, {
      key: EVENTS.POLICY_WITHDRAWN,
      entity: { type: VERSION_ENTITY, id: versionId },
      actor: user,
      before: { status: "published" },
      after: { status: "withdrawn", withdraw_reason: body.reason, draft_id: draftId },
      payload: {
        policy_id: row.policy_id,
        policy_version_id: versionId,
        title: row.title,
        version: Number(row.version),
        effective_from: day(row.effective_from),
      },
    });
    return row.policy_id;
  });
  return get(user, policyId);
}

/** POST /policies/:id/archive: a written policy stops applying. */
async function archive(user, id, body) {
  const policyId = await tx(async (client) => {
    const policy = await policyOf(client, id);
    await repo.lock(client, policy.policy_id);
    if (policy.kind !== "document")
      throw new AppError("CANNOT_ARCHIVE", "A rules policy always applies; change its rules instead", 422);
    if (!(await repo.archivePolicy(client, policy.policy_id, { reason: body.reason, userId: user.user_id })))
      throw new AppError("POLICY_ARCHIVED", "This policy is already archived", 409);
    await emit(client, {
      key: EVENTS.POLICY_ARCHIVED,
      entity: { type: "policy", id: policy.policy_id },
      actor: user,
      before: { status: "active" },
      after: { status: "archived", reason: body.reason },
      payload: { policy_id: policy.policy_id, number: policy.number },
    });
    return policy.policy_id;
  });
  return get(user, policyId);
}

/* ------------------------------------------------------------------ *
 * Approving
 * ------------------------------------------------------------------ */

/** A submission the reader is an approver of, now. */
async function waitingSubmission(client, user, versionId) {
  const row = await repo.getVersion(client, versionId);
  if (!row || row.status !== "submitted" || !row.workflow_instance_id) throw versionNotFound();
  if (!(await repo.waitsOn(client, versionId, user)))
    throw new AppError("PERMISSION_DENIED", "This version is not waiting on you", 403);
  return row;
}

/** POST /policies/me/versions/:id/approve: the stage approved, with the approver's signature (204). */
async function approve(user, versionId, body) {
  await tx(async (client) => {
    const row = await waitingSubmission(client, user, versionId);
    await repo.lock(client, row.policy_id);
    const instance = await workflow.getInstance(client, row.workflow_instance_id);
    const def = await require("../../shared/workflow/definitions").findById(client, instance.workflow_definition_id);
    const stage = (def.stages || []).find((s) => s.key === instance.current_stage) || null;
    await sign(client, { target: row, role: "approver", stage, user, png: body.signature, contentHash: row.content_hash });
    await workflow.act(client, { instance_id: row.workflow_instance_id, actor: user, decision: "approve" });
  });
}

/** POST /policies/me/versions/:id/reject: back to the draft, with the reason the submitter reads (204). */
async function reject(user, versionId, body) {
  await tx(async (client) => {
    const row = await waitingSubmission(client, user, versionId);
    await repo.lock(client, row.policy_id);
    await workflow.act(client, {
      instance_id: row.workflow_instance_id,
      actor: user,
      decision: "reject",
      reason: body.reason,
    });
  });
}

/**
 * After an approval ends (policies.events.js): approved publishes the submission from the later of
 * its first day and today; rejected, timed out or cancelled returns it to the draft. Once only:
 * a submission no longer waiting is left as it is.
 */
async function settleApproval(event) {
  const versionId = event.entity.id;
  const state = event.payload.state;
  const today = lagos.today();
  await tx(async (client) => {
    const row = await repo.getVersion(client, versionId);
    if (!row || row.status !== "submitted") return;
    await repo.lock(client, row.policy_id);
    const policy = await repo.getPolicy(client, row.policy_id);
    if (state === "approved" || state === "timeout_approved") {
      const number = await repo.nextVersion(client, row.policy_id);
      const from = day(row.effective_from) < today ? today : day(row.effective_from);
      await repo.publish(client, versionId, {
        version: number,
        effective_from: from,
        note: row.note,
        contentHash: row.content_hash,
        userId: row.submitted_by || null,
      });
      await repo.renamePolicy(client, row.policy_id, row.title, row.submitted_by || null);
      await emit(client, {
        ...publishedEvent(policy, versionId, { number, from, needsAck: row.needs_acknowledgement, title: row.title }),
        actor: event.actor_user_id || null,
        after: { version: number, effective_from: from, approved: true },
      });
      return;
    }
    await repo.backToDraft(client, versionId);
    if (state === "cancelled") return;
    const reason = event.payload.reason || "No reason given";
    await emit(client, {
      key: EVENTS.POLICY_REJECTED,
      entity: { type: VERSION_ENTITY, id: versionId },
      actor: event.actor_user_id || null,
      after: { status: "draft", state, reason },
      payload: {
        policy_id: row.policy_id,
        policy_version_id: versionId,
        title: row.title,
        reason,
        submitted_by: row.submitted_by || null,
      },
    });
  });
}

/* ------------------------------------------------------------------ *
 * Staff (ESS · Policy Updates)
 * ------------------------------------------------------------------ */

/** GET /policies/me */
async function mine(user, query, { db = pool } = {}) {
  const today = lagos.today();
  const page = await repo.myPolicies(db, user, query, today);
  return {
    ...page,
    data: page.data.map((r) => ({
      policy_version_id: r.policy_version_id,
      policy_id: r.policy_id,
      number: r.number,
      kind: r.kind,
      title: r.title,
      version: r.version === null ? null : Number(r.version),
      state: r.state,
      effective_from: day(r.effective_from),
      needs_acknowledgement: r.needs_acknowledgement,
      due_on: day(r.due_on),
      acknowledged_at: iso(r.acknowledged_at),
      to_acknowledge: Boolean(r.to_acknowledge),
      overdue: Boolean(r.overdue),
      waiting_on_me: Boolean(r.waiting_on_me),
    })),
  };
}

/** GET /policies/me/due: what the acknowledge sheet shows now. Put off today, it waits until tomorrow. */
async function due(user, { db = pool } = {}) {
  if (!user.employee_id) return { items: [] };
  const today = lagos.today();
  const rows = await repo.owed(db, user.employee_id, today);
  const items = [];
  for (const r of rows) {
    const overdue = day(r.due_on) < today;
    if (!overdue && day(r.deferred_on) === today) continue;
    const [d] = await decorate(db, [await repo.getVersion(db, r.policy_version_id)], today);
    items.push({
      policy_version_id: r.policy_version_id,
      title: r.title,
      version: Number(r.version),
      first: Number(r.version) === 1,
      change_lines: d.change.change_lines,
      due_on: day(r.due_on),
      overdue,
      can_later: !overdue,
    });
  }
  return { items };
}

/** Whether the reader may read a version: it applies to them, it is an earlier one of a policy that does, or it waits on them. */
async function mayRead(db, user, row, today) {
  if (row.status === "submitted") return repo.waitsOn(db, row.policy_version_id, user);
  if (row.policy_status !== "active" || !user.employee_id) return false;
  const newest = await repo.newestPublished(db, row.policy_id);
  return Boolean(newest) && repo.isAsked(db, newest.policy_version_id, user.employee_id, today);
}

/** GET /policies/me/versions/:id */
async function myVersion(user, versionId, { db = pool } = {}) {
  const today = lagos.today();
  const row = await repo.getVersion(db, versionId);
  if (!row || row.status === "draft" || !(await mayRead(db, user, row, today))) throw versionNotFound();
  const [inForce, newest, ack, decorated] = await Promise.all([
    repo.versionInForce(db, row.policy_id, today),
    repo.newestPublished(db, row.policy_id),
    user.employee_id ? repo.acknowledgementOf(db, versionId, user.employee_id) : null,
    decorate(db, [row], today),
  ]);
  const d = decorated[0];
  const inForceId = inForce ? inForce.policy_version_id : null;
  const isNewest = Boolean(newest) && newest.policy_version_id === versionId;
  const owedRow = isNewest && user.employee_id ? (await repo.owed(db, user.employee_id, today)).find((o) => o.policy_version_id === versionId) : null;
  const waitingOnMe = row.status === "submitted";
  const earlier = (await repo.listVersions(db, row.policy_id, { page: 1 }, { today, inForceId })).data
    .filter((v) => v.policy_version_id !== versionId)
    .map((v) => ({
      policy_version_id: v.policy_version_id,
      version: Number(v.version),
      effective_from: day(v.effective_from),
      state: stateOf(v, today, inForceId),
    }));
  const dueOn = owedRow ? day(owedRow.due_on) : null;
  // What People see of a version (who published it, the hash, the counts) is not the reader's.
  const {
    published_by_name: _by,
    withdrawn_at: _withdrawnAt,
    withdraw_reason: _reason,
    content_hash: _hash,
    asked: _asked,
    acknowledged: _acknowledged,
    overdue: _overdue,
    ...shown
  } = asVersion(d, today, inForceId);
  return {
    ...shown,
    due_on: dueOn,
    acknowledged_at: ack ? iso(ack.acknowledged_at) : null,
    can_acknowledge: Boolean(owedRow),
    can_later: Boolean(owedRow) && dueOn >= today,
    approval: waitingOnMe ? { stage_name: (await stageName(db, row.workflow_instance_id)) || "Approval", waiting_on_me: true } : null,
    earlier,
  };
}

/** POST /policies/me/versions/:id/acknowledge */
async function acknowledge(user, versionId) {
  const employeeId = user.employee_id;
  const today = lagos.today();
  await tx(async (client) => {
    if (!employeeId) throw new AppError("NOT_EMPLOYED", "Only people who work here acknowledge policies.", 422);
    const row = await repo.getVersion(client, versionId);
    if (!row || row.status !== "published" || !(await repo.isAsked(client, versionId, employeeId, today)))
      throw versionNotFound();
    const newest = await repo.newestPublished(client, row.policy_id);
    if (!newest || newest.policy_version_id !== versionId)
      throw new AppError("POLICY_NOT_LATEST", "Acknowledge the newest version of the policy", 409);
    if (!row.needs_acknowledgement)
      throw new AppError("NOTHING_TO_ACKNOWLEDGE", "This policy needs no acknowledgement", 409);
    const knownDeviceId = await identity.sessionDevice(client, user);
    const done = await repo.acknowledge(client, versionId, employeeId, { contentHash: row.content_hash, knownDeviceId });
    await notifications.markReadForRecord(client, user, VERSION_ENTITY, versionId);
    if (!done) return;
    await emit(client, {
      key: EVENTS.POLICY_ACKNOWLEDGED,
      entity: { type: VERSION_ENTITY, id: versionId },
      actor: user,
      after: { acknowledged_at: iso(done.acknowledged_at), content_hash: row.content_hash },
      payload: { policy_id: row.policy_id, policy_version_id: versionId, version: Number(row.version), employee_id: employeeId },
    });
  });
  return myVersion(user, versionId);
}

/** POST /policies/me/versions/:id/later: put off until tomorrow, before the due date only. */
async function later(user, versionId) {
  const today = lagos.today();
  await tx(async (client) => {
    if (!user.employee_id) throw versionNotFound();
    const owed = (await repo.owed(client, user.employee_id, today)).find((o) => o.policy_version_id === versionId);
    if (!owed) throw versionNotFound();
    if (day(owed.due_on) < today)
      throw new AppError("ACKNOWLEDGEMENT_OVERDUE", "This policy is past its due date: acknowledge it now", 409);
    await repo.defer(client, versionId, user.employee_id, today);
  });
  return due(user);
}

/* ------------------------------------------------------------------ *
 * The PDF
 * ------------------------------------------------------------------ */

/** A version on the letterhead, queued through documents.generate and downloaded where it was asked for. */
async function requestPdf(user, versionId, { mine: asStaff = false } = {}) {
  const today = lagos.today();
  const row = await repo.getVersion(pool, versionId);
  if (!row || !["published", "withdrawn"].includes(row.status)) throw versionNotFound();
  if (asStaff && !(await mayRead(pool, user, row, today))) throw versionNotFound();
  const [d] = await decorate(pool, [row], today);
  const signatures = await Promise.all(
    d.signatures.map(async (s) => {
      const doc = await vault.get(pool, s.signature_document_id);
      const bytes = doc ? await storage.get(doc.storage_key).catch(() => null) : null;
      return {
        role: s.role === "publisher" ? "Published" : `Approved${s.stage_name ? `, ${s.stage_name}` : ""}`,
        signer_name: s.signer_name,
        signer_title: s.signer_title,
        signed_at: s.signed_at,
        image: bytes ? `data:image/png;base64,${bytes.toString("base64")}` : null,
      };
    }),
  );
  return tx(async (client) => {
    const doc = await documents.generate(client, {
      doc_type: PDF_DOC_TYPE,
      entity: { type: "policy_pdf_request", id: crypto.randomUUID() },
      data: {
        policy_number: row.number,
        title: d.content.title,
        version: Number(row.version),
        effective_from: day(row.effective_from),
        applies_to_text: d.content.applies_to_text,
        note: row.note || "",
        body_markdown: row.body_markdown || null,
        sections: (d.sections || []).map((s) => ({ title: s.title, sentences: s.sentences.map((x) => x.text) })),
        signatures,
        content_hash: row.content_hash || "",
      },
      actor: user,
    });
    await emit(client, {
      key: EVENTS.POLICY_PDF_REQUESTED,
      entity: { type: VERSION_ENTITY, id: versionId },
      actor: user,
      payload: { policy_version_id: versionId, document_id: doc.document_id, requested_by: user.user_id },
    });
    return exportFiles.present(doc);
  });
}

/* ------------------------------------------------------------------ *
 * The port, and the reminder
 * ------------------------------------------------------------------ */

/**
 * The rules of a rules policy on a date (§6.8): the version in force then, parsed with the type's
 * defaults; before any version, the defaults and no version.
 * @param {{query: Function}} db
 * @param {string} kind  a rules type ("attendance")
 * @param {string} date  YYYY-MM-DD
 * @returns {Promise<{policy_version_id: string|null, version: number|null, rules: object}>}
 */
async function rulesFor(db, kind, date) {
  const row = await repo.rulesInForce(db, kind, date);
  return {
    policy_version_id: row ? row.policy_version_id : null,
    version: row ? Number(row.version) : null,
    rules: rulesOf(kind, row ? row.rules : null),
  };
}

/**
 * The reminder's `find` (policies.events.js): for each newest version published REMIND_AFTER_DAYS
 * days ago or more that needs acknowledging, one occurrence for each person asked who has neither
 * acknowledged nor been reminded. Fired in the working day; the engine adds each once.
 */
async function remindersDue(db, { now }) {
  const before = new Date(now.getTime() - REMIND_AFTER_DAYS * 86_400_000);
  const today = lagos.today(now);
  const out = [];
  for (const v of await repo.versionsToRemind(db, before)) {
    const dueAt = new Date(new Date(v.published_at).getTime() + REMIND_AFTER_DAYS * 86_400_000);
    for (const p of await repo.dueForReminder(db, v.policy_version_id, today))
      out.push({ entity_type: VERSION_ENTITY, entity_id: v.policy_version_id, occurrence: p.employee_id, due_at: dueAt, work_hours: true });
  }
  return out;
}

/** The reminder's `check`, in the firing's transaction: still the newest, still asked, not acknowledged. */
async function reminderCheck(client, row, { now }) {
  const current = await repo.getVersion(client, row.entity_id);
  if (!current || current.status !== "published" || current.policy_status !== "active") return null;
  const newest = await repo.newestPublished(client, current.policy_id);
  if (!newest || newest.policy_version_id !== row.entity_id) return null;
  const employeeId = row.occurrence;
  if (!(await repo.isAsked(client, row.entity_id, employeeId, lagos.today(now)))) return null;
  if (!(await repo.recordReminder(client, row.entity_id, employeeId))) return null;
  return {
    entity: { type: VERSION_ENTITY, id: row.entity_id },
    payload: {
      policy_version_id: row.entity_id,
      title: current.title,
      version: Number(current.version),
      employee_id: employeeId,
      subject_employee_id: employeeId,
    },
  };
}

/** Whether a user holds policies.manage (the CEO holds every capability). */
async function canManage(db, user) {
  if (user && user.is_ceo === true) return true;
  return (await grantsCache.getCapabilities(db, user && user.user_id)).includes("policies.manage");
}

module.exports = {
  AHEAD_DAYS,
  REMIND_AFTER_DAYS,
  appliesToText,
  changesOf,
  stateOf,
  get,
  list,
  versions,
  version,
  acknowledgements,
  create,
  saveDraft,
  discardDraft,
  publish,
  submit,
  recall,
  withdraw,
  archive,
  approve,
  reject,
  settleApproval,
  mine,
  due,
  myVersion,
  acknowledge,
  later,
  requestPdf,
  rulesFor,
  remindersDue,
  reminderCheck,
  canManage,
};
