"use strict";
/**
 * The Talent Pool: the one write path for who is kept for later (docs/guides/recruitment.md §3 step
 * 13, §6.9; moved to M4 by TB, 04/11/2026).
 *
 *   list(), summary()         the pool in the reader's scope (the hiring manager of the vacancy each
 *                             person applied for), its score with Provisional while it is the estimate
 *   add()                     Add to Pool from an application (any status), with why; one already in
 *                             the pool is renewed: the new reason, and 24 months from now
 *   invite()                  Invite to Apply to an open vacancy, through the candidates module's own
 *                             invite (the link made and mailed after commit); the application it leads
 *                             to has source pool
 *   remove()                  off the pool before their time
 *   requestExport(), gather() Export: the whole filtered pool as a workbook
 */
const crypto = require("node:crypto");
const { pool } = require("../../config/db");
const { config } = require("../../config/env");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { assertInScope } = require("../../shared/rbac/scope");
const exportFiles = require("../../shared/documents/exports");
const { exportFilename } = require("../../shared/spreadsheet/cells");
const candidates = require("../candidates/candidates.service");
const candidateRepo = require("../candidates/candidates.repo");
const repo = require("./talent_pool.repo");
const { EVENTS, EXPORT_DOC_TYPE } = require("./talent_pool.events");

/** The most people one export file holds. */
const EXPORT_CEILING = 5000;

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That person is not in the pool", 404);
const num = (v) => (v === null || v === undefined ? null : Number(v));
const iso = (v) => (v ? new Date(v).toISOString() : null);

/** Whether `scope` may see a vacancy managed by `managerId` (the rule assertInScope applies). */
const sees = (scope, managerId) =>
  !scope || scope.scope === "all" || Boolean(managerId && (scope.scope_ids || []).includes(managerId));

/**
 * PoolEntry. A vacancy outside the reader's scope is not named: a reader scoped to some hiring managers
 * sees that the person was invited back, never the title of another manager's role.
 */
function entry(r, scope) {
  const screening = num(r.screening_score);
  const provisional = num(r.provisional_score);
  return {
    talent_pool_entry_id: r.talent_pool_entry_id,
    candidate_id: r.candidate_id,
    name: r.name,
    email: r.email,
    application_id: r.application_id,
    applied_for: r.applied_vacancy_id && sees(scope, r.hiring_manager_id) ? { vacancy_id: r.applied_vacancy_id, number: r.applied_number, title: r.applied_title } : null,
    score: screening !== null ? screening : provisional,
    score_provisional: screening === null && provisional !== null,
    reason: r.reason,
    added_by_name: r.added_by_name,
    created_at: iso(r.created_at),
    expires_at: iso(r.expires_at),
    invited_at: iso(r.invited_at),
    invited_vacancy: r.invited_vacancy_id && sees(scope, r.invited_hiring_manager_id) ? { vacancy_id: r.invited_vacancy_id, number: r.invited_number, title: r.invited_title } : null,
    hired_from_pool: Boolean(r.hired_from_pool),
    removed_at: iso(r.removed_at),
  };
}

async function list(query, scope) {
  const page = await repo.list(pool, query, scope);
  return { ...page, data: page.data.map((r) => entry(r, scope)) };
}

async function summary(scope) {
  const r = await repo.summary(pool, scope);
  return { in_pool: r.in_pool, invited_back: r.invited_back, hired_from_pool: r.hired_from_pool, average_score: num(r.average_score) };
}

/**
 * The people kept that the reader may list, in figures (docs/guides/praxis-ai.md §6.13, Recruitment and
 * onboarding): everyone kept unless a period (added) is asked; by role applied for, by why kept, and
 * kept by month. Runs on the client the assistant hands over, inside its read timeout.
 * @param {{query: Function}} client
 * @param {object} params   PoolSummaryQuery, parsed
 * @param {{scope: string, scope_ids: string[]|null}} scope
 */
async function aiSummary(client, params, scope, now = new Date()) {
  const { figure, group, top, series, askedPeriod } = require("../../shared/ai/summary");
  const period = askedPeriod(params, now);
  const r = await repo.aiSummary(client, { invited: params.invited, from: period && period.from, to: period && period.to }, scope);
  const f = r.figures;
  return {
    figures: [
      figure("kept", "People kept", f.kept || 0),
      figure("invited", "Invited back", f.invited || 0),
      figure("hired", "Hired from the pool", f.hired || 0),
      figure("leaving_soon", "Leaving within 30 days", f.leaving_soon || 0),
      figure("average_score", "Average score", f.average_score || 0),
    ],
    groups: [group("role", "People kept by role applied for", r.by_role), top("reason", "People kept by why", r.by_reason)],
    series: [series("kept", "People kept by month", r.months)],
    total: f.kept || 0,
  };
}

/** One live entry of the reader's scope (a ⌘K link to a person past the list's first page), or 404. */
async function get(id, scope) {
  const row = await repo.get(pool, id);
  if (!row) throw notFound();
  assertInScope(scope, row.hiring_manager_id);
  return entry(row, scope);
}

/** A live entry of the reader's scope, locked, or 404. */
async function visible(client, id, scope) {
  const row = await repo.get(client, id, { lock: true });
  if (!row) throw notFound();
  assertInScope(scope, row.hiring_manager_id);
  return row;
}

async function add(actor, scope, body) {
  return tx(async (client) => {
    const app = await candidateRepo.get(client, body.application_id);
    if (!app) throw new AppError("VALIDATION_FAILED", "Pick a candidate", 422, { application_id: ["Pick a candidate"] });
    assertInScope(scope, app.hiring_manager_id);
    const fields = { candidate_id: app.candidate_id, application_id: app.application_id, reason: body.reason, added_by: actor.user_id };
    // Two adds at once: the second's insert makes nothing, and it renews the entry the first made.
    let existing = await repo.liveFor(client, app.candidate_id);
    let id = existing ? existing.talent_pool_entry_id : await repo.insert(client, fields);
    if (!id) {
      existing = await repo.liveFor(client, app.candidate_id);
      id = existing.talent_pool_entry_id;
    }
    // In the pool from another manager's role: theirs to renew, not taken over from outside their scope.
    if (existing && scope.scope !== "all" && !(existing.hiring_manager_id && (scope.scope_ids || []).includes(existing.hiring_manager_id)))
      throw new AppError("VALIDATION_FAILED", "Already in the pool", 422, { application_id: ["Already in the pool"] });
    if (existing) await repo.renew(client, id, fields);
    await emit(client, {
      key: existing ? EVENTS.TALENT_POOL_RENEWED : EVENTS.TALENT_POOL_ADDED,
      entity: { type: "talent_pool_entry", id },
      actor,
      payload: { talent_pool_entry_id: id, application_number: app.number },
    });
    return entry(await repo.get(client, id), scope);
  });
}

async function invite(actor, scope, id, body) {
  return tx(async (client) => {
    const row = await visible(client, id, scope);
    await candidates.inviteIn(client, actor, scope, row.candidate_id, body.vacancy_id, { source: "pool" });
    await repo.setInvited(client, id, body.vacancy_id, actor.user_id);
    await emit(client, {
      key: EVENTS.TALENT_POOL_INVITED,
      entity: { type: "talent_pool_entry", id },
      actor,
      payload: { talent_pool_entry_id: id, vacancy_id: body.vacancy_id },
    });
    return entry(await repo.get(client, id), scope);
  });
}

async function remove(actor, scope, id, body) {
  return tx(async (client) => {
    const row = await visible(client, id, scope);
    await repo.remove(client, id, body.removed_reason || null);
    await emit(client, {
      key: EVENTS.TALENT_POOL_REMOVED,
      entity: { type: "talent_pool_entry", id },
      actor,
      payload: { talent_pool_entry_id: id, candidate_id: row.candidate_id },
    });
    // Answered as it was just before it left, with when it left; it is no longer listed.
    return { ...entry(row, scope), removed_at: new Date().toISOString() };
  });
}

/** POST /recruitment/pool/exports: reserve the whole filtered pool's file, made by the worker after commit. */
async function requestExport(actor, filters) {
  return tx(async (client) => {
    const doc = await exportFiles.reserve(client, {
      doc_type: EXPORT_DOC_TYPE,
      entity: { type: EXPORT_DOC_TYPE, id: crypto.randomUUID() },
      file_name: exportFilename({ base: "talent-pool", env: config.APP_ENV, extension: "xlsx" }),
      title: "Talent Pool export",
      actor,
    });
    await emit(client, {
      key: EVENTS.TALENT_POOL_EXPORT_REQUESTED,
      entity: { type: doc.entity_type, id: doc.entity_id },
      actor,
      payload: { filters, requested_by: actor.user_id, document_id: doc.document_id },
    });
    return exportFiles.present(doc);
  });
}

/** Every entry the filters match in `scope`, a page of 25 at a time up to the ceiling (for the export). */
async function gather(filters, scope) {
  const rows = [];
  let page = await repo.list(pool, { ...filters, page: 1, sort: { field: "created_at", dir: "desc" } }, scope);
  const push = (data) =>
    rows.push(
      ...data.map((r) => {
        const e = entry(r, scope);
        return {
          name: e.name,
          email: e.email,
          applied_for: e.applied_for ? `${e.applied_for.number}, ${e.applied_for.title}` : "",
          score: e.score === null ? "" : e.score,
          provisional: e.score_provisional ? "Yes" : "",
          reason: e.reason,
          created_at: e.created_at,
          expires_at: e.expires_at,
          invited_to: e.invited_vacancy ? `${e.invited_vacancy.number}, ${e.invited_vacancy.title}` : "",
          invited_at: e.invited_at,
        };
      }),
    );
  push(page.data);
  while (page.page.has_next && rows.length < EXPORT_CEILING) {
    page = await repo.list(pool, { ...filters, page: page.page.number + 1, sort: { field: "created_at", dir: "desc" } }, scope);
    push(page.data);
  }
  return { rows: rows.slice(0, EXPORT_CEILING), total: page.page.total, capped: page.page.total > EXPORT_CEILING };
}

module.exports = { list, summary, aiSummary, get, add, invite, remove, requestExport, gather, entry };
