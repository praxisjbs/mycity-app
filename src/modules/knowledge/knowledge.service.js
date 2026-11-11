"use strict";
/**
 * SOPs: the one write path for every SOP, its draft and its versions, and the reads behind
 * Knowledge Hub · SOPs, a screen's Procedures and Praxis AI (docs/guides/knowledge.md §6.2, §6.3).
 *
 *   create        a writer starts an SOP for a department: numbered, with an empty draft
 *   saveDraft     every field and the steps in order; a step's screen is one the route map knows
 *                 and its file is claimed from the upload engine. Nobody is told
 *   publish       the draft becomes Version N, in force at once; the department is told
 *   archive       the SOP leaves the list, search, the AI and the screens' Procedures
 *
 * Who writes (§6.2): a department's head at the moment of the request (`head_employee_id`, or
 * whoever fills its head seat), or anyone holding `sops.manage`; the CEO holds every capability.
 * The headship is the authority, checked here, so a head needs no `knowledge` create or edit
 * grant. Archiving is the head's, or `sops.manage` with `knowledge` delete. Everyone with
 * `knowledge` view reads every published SOP.
 *
 * Every change to one SOP runs under its lock.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const numbering = require("../../shared/numbering/numbering");
const grantsCache = require("../../shared/rbac/grants-cache");
const vault = require("../../shared/documents/vault");
const repo = require("./knowledge.repo");
const v = require("./knowledge.versions");
const { EVENTS, SOP_ENTITY, STEP_FILE_DOC_TYPE } = require("./knowledge.events");

const MANAGE = "sops.manage";

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That SOP does not exist", 404);
const versionNotFound = () => new AppError("NOT_FOUND", "That SOP version does not exist", 404);
const notWriter = () => new AppError("NOT_SOP_WRITER", "You may not write this department's SOPs", 403);
const archived = () => new AppError("SOP_ARCHIVED", "This SOP is archived", 409);

/* ------------------------------------------------------------------ *
 * Who may write
 * ------------------------------------------------------------------ */

/**
 * What a person may write: every department (`sops.manage`, or the CEO), or the ones they head.
 * @returns {Promise<{all: boolean, departments: string[]}>}
 */
async function reachOf(db, user) {
  if (!user) return { all: false, departments: [] };
  if (user.is_ceo === true) return { all: true, departments: [] };
  if ((await grantsCache.getCapabilities(db, user.user_id)).includes(MANAGE)) return { all: true, departments: [] };
  return { all: false, departments: await repo.headedBy(db, user.employee_id) };
}

const mayWrite = (reach, departmentId) => reach.all || reach.departments.includes(departmentId);

/** Archive SOP (§6.2): the department's head, or `sops.manage` with `knowledge` delete. */
async function mayArchive(db, user, departmentId) {
  if (!user) return false;
  if (user.is_ceo === true) return true;
  if ((await repo.headedBy(db, user.employee_id)).includes(departmentId)) return true;
  if (!(await grantsCache.getCapabilities(db, user.user_id)).includes(MANAGE)) return false;
  // The grant as the routes read it; required here, as the vault does, to keep the service off the HTTP layer at load.
  return Boolean(await require("../../middleware/rbac").scopeFor(user, "knowledge", "delete"));
}

async function assertWriter(db, user, departmentId) {
  if (!mayWrite(await reachOf(db, user), departmentId)) throw notWriter();
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

async function sopOf(db, id) {
  const sop = await repo.getSop(db, id);
  if (!sop) throw notFound();
  return sop;
}

/** A version row with its steps, read on the same connection. */
async function withSteps(db, row) {
  if (!row) return { row: null, steps: [] };
  return { row, steps: await repo.stepsOf(db, [row.sop_version_id]) };
}

/**
 * GET /knowledge/sops/:id: the version in force for everyone; the draft, `can_edit` and
 * `can_archive` for a writer. A draft-only or archived SOP is a writer's alone (404 for the rest).
 */
async function get(user, id, db = pool) {
  const sop = await sopOf(db, id);
  const reach = await reachOf(db, user);
  const writer = mayWrite(reach, sop.department_id);
  const current = await withSteps(db, await repo.inForceOf(db, sop.sop_id));
  if (!writer && (sop.status !== "active" || !current.row)) throw notFound();
  const draft = writer ? await withSteps(db, await repo.draftOf(db, sop.sop_id)) : { row: null, steps: [] };
  const active = sop.status === "active";
  const base = current.row ? v.contentOf(current.row, current.steps) : null;
  return {
    sop_id: sop.sop_id,
    number: sop.number,
    department_id: sop.department_id,
    department_name: sop.department_name,
    title: sop.title,
    state: v.stateOf(sop.status, current.row && current.row.version),
    in_force: current.row ? v.versionOut(sop, current.row, current.steps) : null,
    draft: draft.row ? v.draftOut(draft.row, draft.steps, base) : null,
    archived_at: v.iso(sop.archived_at),
    archive_reason: sop.archive_reason || null,
    can_edit: active && writer,
    can_archive: active && (await mayArchive(db, user, sop.department_id)),
  };
}

/** GET /knowledge/sops: published SOPs; a writer's drafts and archived SOPs under their chips. */
async function list(user, query, db = pool) {
  const page = await repo.list(db, query, await reachOf(db, user));
  return { ...page, data: page.data.map(v.rowOut) };
}

/** GET /knowledge/sops/for-screen: the Procedures under a screen's guide section (§3 step 3). */
async function forScreen(query, db = pool) {
  const page = await repo.forScreen(db, query);
  return { ...page, data: page.data.map(v.rowOut) };
}

/** GET /knowledge/sops/departments: the chips, or with `writable` New SOP's Department. */
async function departments(user, query, db = pool) {
  const page = await repo.departments(db, query, await reachOf(db, user));
  return { ...page, data: page.data.map((r) => ({ department_id: r.department_id, name: r.name })) };
}

/** GET /knowledge/sops/:id/versions: as the SOP is visible. */
async function versions(user, id, query, db = pool) {
  await get(user, id, db);
  const page = await repo.versions(db, id, query);
  return {
    ...page,
    data: page.data.map((r) => ({
      sop_version_id: r.sop_version_id,
      version: Number(r.version),
      title: r.title,
      note: r.note || null,
      published_at: v.iso(r.published_at),
      published_by_name: r.published_by_name || null,
    })),
  };
}

/** GET /knowledge/sops/versions/:id: a published version, as its SOP is visible. */
async function version(user, versionId, db = pool) {
  const row = await repo.publishedVersion(db, versionId);
  if (!row) throw versionNotFound();
  if (row.sop_status !== "active" && !mayWrite(await reachOf(db, user), row.department_id)) throw versionNotFound();
  const steps = await repo.stepsOf(db, [row.sop_version_id]);
  return v.versionOut({ number: row.number, department_id: row.department_id, department_name: row.department_name }, row, steps);
}

/** The version in force of an SOP the reader may read (Praxis AI's sops.read): 404 when there is none. */
async function inForce(user, id, db = pool) {
  const sop = await get(user, id, db);
  if (!sop.in_force) throw notFound();
  return sop.in_force;
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

/** POST /knowledge/sops: numbered, with an empty draft; the department is fixed for good. */
async function create(user, body) {
  const id = await tx(async (client) => {
    const department = await repo.department(client, body.department_id);
    if (!department || !department.active)
      throw new AppError("VALIDATION", "Pick a department", 422, { department_id: ["Pick a department"] });
    await assertWriter(client, user, department.department_id);
    const { number } = await numbering.allocate(client, "sop");
    const { sop_id: sopId } = await repo.insertSop(client, { number, department_id: department.department_id, title: body.title, userId: user.user_id });
    const draft = await repo.insertDraft(client, sopId, { title: body.title, purpose: null, scope: null, roles: [] }, user.user_id);
    await emit(client, {
      key: EVENTS.SOP_CREATED,
      entity: { type: SOP_ENTITY, id: sopId },
      actor: user,
      after: { number, department_id: department.department_id, title: body.title },
      payload: { sop_id: sopId, sop_version_id: draft.sop_version_id, number, department_id: department.department_id },
    });
    return sopId;
  });
  return get(user, id);
}

/**
 * The steps as saved: each screen one the route map knows (422 UNKNOWN_SCREEN on the step), each
 * file claimed for this SOP from the upload engine (a file it already holds is answered as it is).
 */
async function checkSteps(client, user, sopId, steps) {
  const fields = {};
  steps.forEach((s, i) => {
    if (s.screen_key && !v.screenOf(s.screen_key)) fields[`steps.${i}.screen_key`] = ["Pick a screen"];
  });
  if (Object.keys(fields).length) throw new AppError("UNKNOWN_SCREEN", "Pick a screen the hub has", 422, fields);
  for (const [i, s] of steps.entries()) {
    if (!s.document_id) continue;
    await vault.claim(client, {
      document_id: s.document_id,
      doc_type: STEP_FILE_DOC_TYPE,
      entity: { type: SOP_ENTITY, id: sopId },
      actor: user,
      field: `steps.${i}.document_id`,
    });
  }
  return steps.map((s) => ({ text: s.text, who: s.who ?? null, screen_key: s.screen_key ?? null, document_id: s.document_id ?? null }));
}

/** What the audit keeps of a draft: its fields and steps. */
const auditOf = (row, steps) => (row ? v.contentOf(row, steps) : null);

/** PUT /knowledge/sops/:id/draft: creates the draft when there is none. */
async function saveDraft(user, id, body) {
  const sopId = await tx(async (client) => {
    const sop = await sopOf(client, id);
    await repo.lock(client, sop.sop_id);
    if (sop.status !== "active") throw archived();
    await assertWriter(client, user, sop.department_id);
    const steps = await checkSteps(client, user, sop.sop_id, body.steps);
    const fields = { title: body.title, purpose: body.purpose ?? null, scope: body.scope ?? null, roles: body.roles };
    const existing = await repo.draftOf(client, sop.sop_id);
    const before = existing ? auditOf(existing, await repo.stepsOf(client, [existing.sop_version_id])) : null;
    const row = existing
      ? await repo.updateDraft(client, existing.sop_version_id, fields, user.user_id)
      : await repo.insertDraft(client, sop.sop_id, fields, user.user_id);
    await repo.replaceSteps(client, row.sop_version_id, steps);
    // Before its first version the list shows the draft's title.
    if (!(await repo.inForceOf(client, sop.sop_id))) await repo.renameSop(client, sop.sop_id, fields.title, user.user_id);
    await emit(client, {
      key: EVENTS.SOP_DRAFT_SAVED,
      entity: { type: SOP_ENTITY, id: sop.sop_id },
      actor: user,
      before,
      after: v.contentOf(fields, steps),
      payload: { sop_id: sop.sop_id, sop_version_id: row.sop_version_id, created: !existing },
    });
    return sop.sop_id;
  });
  return get(user, sopId);
}

/** POST /knowledge/sops/:id/draft/discard: the version in force is untouched. */
async function discardDraft(user, id) {
  const sopId = await tx(async (client) => {
    const sop = await sopOf(client, id);
    await repo.lock(client, sop.sop_id);
    if (sop.status !== "active") throw archived();
    await assertWriter(client, user, sop.department_id);
    const draft = await repo.draftOf(client, sop.sop_id);
    if (!draft) throw new AppError("NO_DRAFT", "There is no draft", 409);
    const before = auditOf(draft, await repo.stepsOf(client, [draft.sop_version_id]));
    if (!(await repo.deleteDraft(client, draft.sop_version_id))) throw new AppError("NO_DRAFT", "There is no draft", 409);
    await emit(client, {
      key: EVENTS.SOP_DRAFT_DISCARDED,
      entity: { type: SOP_ENTITY, id: sop.sop_id },
      actor: user,
      before,
      payload: { sop_id: sop.sop_id, sop_version_id: draft.sop_version_id },
    });
    return sop.sop_id;
  });
  return get(user, sopId);
}

/**
 * POST /knowledge/sops/:id/publish (§6.3): a draft that says something (a purpose, a step) and
 * differs from the version in force, with a note from Version 2. It becomes the next number, in
 * force at once, its content hash over what staff read.
 */
async function publish(user, id, body) {
  const sopId = await tx(async (client) => {
    const sop = await sopOf(client, id);
    await repo.lock(client, sop.sop_id);
    if (sop.status !== "active") throw archived();
    await assertWriter(client, user, sop.department_id);
    const draft = await withSteps(client, await repo.draftOf(client, sop.sop_id));
    if (!draft.row) throw new AppError("NO_DRAFT", "Save the changes as a draft first", 409);
    if (!draft.row.purpose || draft.row.purpose.trim().length < 10)
      throw new AppError("SOP_NO_PURPOSE", "Write the purpose first", 422, { purpose: ["Write the purpose"] });
    if (!draft.steps.length) throw new AppError("SOP_NO_STEPS", "Add a step first", 422, { steps: ["Add a step"] });
    // A screen dropped from the route map since the draft was saved (§11) is refused here too.
    const stale = draft.steps.findIndex((s) => s.screen_key && !v.screenOf(s.screen_key));
    if (stale >= 0) throw new AppError("UNKNOWN_SCREEN", "Pick a screen the hub has", 422, { [`steps.${stale}.screen_key`]: ["Pick a screen"] });
    const content = v.contentOf(draft.row, draft.steps);
    const current = await withSteps(client, await repo.inForceOf(client, sop.sop_id));
    if (current.row && v.sameContent(v.contentOf(current.row, current.steps), content))
      throw new AppError("NO_CHANGES", "The draft changes nothing", 409);
    if (current.row && !body.note) throw new AppError("VALIDATION", "Say what changed", 422, { note: ["Required"] });
    const number = await repo.nextVersion(client, sop.sop_id);
    const contentHash = v.hashOf(sop, content, number);
    await repo.publish(client, draft.row.sop_version_id, { version: number, note: body.note ?? null, contentHash, userId: user.user_id });
    await repo.touchSop(client, sop.sop_id, content.title, user.user_id);
    await emit(client, {
      key: EVENTS.SOP_PUBLISHED,
      entity: { type: SOP_ENTITY, id: sop.sop_id },
      actor: user,
      before: current.row ? { version: Number(current.row.version) } : null,
      after: { version: number, content_hash: contentHash },
      payload: {
        sop_id: sop.sop_id,
        sop_version_id: draft.row.sop_version_id,
        number: sop.number,
        department_id: sop.department_id,
        title: content.title,
        version: number,
      },
    });
    return sop.sop_id;
  });
  return get(user, sopId);
}

/** POST /knowledge/sops/:id/archive: its versions are kept; it is gone from search, the AI and Procedures. */
async function archive(user, id, body) {
  const sopId = await tx(async (client) => {
    const sop = await sopOf(client, id);
    await repo.lock(client, sop.sop_id);
    if (sop.status !== "active") throw new AppError("SOP_ARCHIVED", "This SOP is already archived", 409);
    if (!(await mayArchive(client, user, sop.department_id))) throw notWriter();
    await repo.archiveSop(client, sop.sop_id, { reason: body.reason, userId: user.user_id });
    await emit(client, {
      key: EVENTS.SOP_ARCHIVED,
      entity: { type: SOP_ENTITY, id: sop.sop_id },
      actor: user,
      before: { status: "active" },
      after: { status: "archived", reason: body.reason },
      payload: { sop_id: sop.sop_id, number: sop.number, department_id: sop.department_id },
    });
    return sop.sop_id;
  });
  return get(user, sopId);
}

module.exports = {
  reachOf,
  mayWrite,
  mayArchive,
  assertWriter,
  get,
  list,
  forScreen,
  departments,
  versions,
  version,
  inForce,
  create,
  saveDraft,
  discardDraft,
  publish,
  archive,
};
