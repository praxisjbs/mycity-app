"use strict";
/**
 * Every AI call, recorded: who asked, for what, which vendor and model, the prompt
 * version, the tokens, the cost in naira, how long it took and how it ended
 * (BACKEND_STRUCTURE §14.2). One `ai_run` per call, one `ai_run_step` per round trip to
 * the vendor (the first answer, a retry after a malformed one, a transcription).
 *
 * Written on its own connection, outside any business transaction: AI never runs
 * inside one, and a run must be on record whether the feature's save later succeeds
 * or not. Recording is not best effort. If the ledger cannot be written the call does
 * not go ahead (llm.service starts the run before calling out), because spend that is
 * not recorded cannot be capped.
 *
 * Tables (migration 0095; BACKEND_STRUCTURE §11.1):
 *   ai_run       run_id, purpose, module_key, actor_user_id, vendor, model, prompt_key,
 *                prompt_version, prompt_sha, status ('running' | 'ok' | 'failed' | 'refused'),
 *                provisional, error_code, error, request_id, started_at, finished_at
 *   ai_run_step  ai_run_step_id, run_id, step_no, kind ('completion' | 'retry' |
 *                'transcription' | 'search' | 'embedding'), vendor, model, input_tokens, output_tokens,
 *                audio_seconds, searches, input_ngn_per_million, output_ngn_per_million,
 *                ngn_per_audio_hour, ngn_per_search, usd_ngn_rate, rate_day, cost_ngn,
 *                latency_ms, finish_reason, outcome ('ok' | 'invalid' | 'failed'), error,
 *                created_at (10200 added the audio, search and rate columns: what the step was
 *                charged at, so a new price or rate never rewrites past spend)
 */
const requestContext = require("../../config/request-context");
const money = require("../../shared/money/money");
const { costOf } = require("./governance");

const actorId = (actor) =>
  actor && typeof actor === "object" ? actor.user_id || null : actor || null;
const clip = (s, n = 2000) =>
  s === null || s === undefined ? null : String(s).slice(0, n);

/**
 * Open a run.
 * @param {{query: Function}} db
 * @param {{purpose: string, module: string, actor: object|string|null, vendor?: string, model?: string,
 *          prompt?: {key: string, version: number, sha: string}|null, status?: string}} run
 * @returns {Promise<string>} run_id
 */
async function startRun(db, run) {
  const ctx = requestContext.get() || {};
  const p = run.prompt || {};
  const { rows } = await db.query(
    `INSERT INTO ai_run (purpose, module_key, actor_user_id, vendor, model, prompt_key, prompt_version, prompt_sha, status, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING run_id`,
    [
      run.purpose,
      run.module,
      actorId(run.actor),
      run.vendor || null,
      run.model || null,
      p.key || null,
      p.version ?? null,
      p.sha || null,
      run.status || "running",
      ctx.requestId || null,
    ],
  );
  return rows[0].run_id;
}

/**
 * Record one round trip to the vendor.
 * @param {{query: Function}} db
 * @param {string} runId
 * @param {{step_no: number, kind: string, vendor: string, model: string,
 *          usage?: {input_tokens: number, output_tokens: number, audio_seconds?: number, searches?: number},
 *          prices: {input_ngn_per_million: string, output_ngn_per_million: string, ngn_per_audio_hour?: string|null,
 *                   ngn_per_search?: string|null, usd_ngn_rate?: string|null, rate_day?: string|null},
 *          latency_ms: number, finish_reason?: string|null, outcome: string, error?: string|null}} step
 * @returns {Promise<string>} the step's cost, "0.00" style
 */
async function recordStep(db, runId, step) {
  const usage = step.usage || { input_tokens: 0, output_tokens: 0 };
  const p = step.prices;
  const cost = money.toWire(costOf(usage, p));
  await db.query(
    `INSERT INTO ai_run_step
       (run_id, step_no, kind, vendor, model, input_tokens, output_tokens, audio_seconds, searches,
        input_ngn_per_million, output_ngn_per_million, ngn_per_audio_hour, ngn_per_search, usd_ngn_rate, rate_day,
        cost_ngn, latency_ms, finish_reason, outcome, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
    [
      runId,
      step.step_no,
      step.kind,
      step.vendor,
      step.model,
      Number(usage.input_tokens) || 0,
      Number(usage.output_tokens) || 0,
      Math.max(0, Math.round(Number(usage.audio_seconds) || 0)),
      Math.max(0, Math.round(Number(usage.searches) || 0)),
      p.input_ngn_per_million,
      p.output_ngn_per_million,
      p.ngn_per_audio_hour || null,
      p.ngn_per_search || null,
      p.usd_ngn_rate || null,
      p.rate_day || null,
      cost,
      Math.round(step.latency_ms || 0),
      step.finish_reason || null,
      step.outcome,
      clip(step.error),
    ],
  );
  return cost;
}

/**
 * Close a run.
 * @param {{query: Function}} db
 * @param {string} runId
 * @param {{status: "ok"|"failed", provisional?: boolean, error_code?: string|null, error?: string|null,
 *          vendor?: string, model?: string}} end  vendor and model: the fallback that answered, when not the first
 */
async function finishRun(db, runId, end) {
  await db.query(
    `UPDATE ai_run SET status = $2, provisional = $3, error_code = $4, error = $5, finished_at = now(),
            vendor = COALESCE($6, vendor), model = COALESCE($7, model)
      WHERE run_id = $1`,
    [
      runId,
      end.status,
      end.provisional !== false,
      end.error_code || null,
      clip(end.error),
      end.vendor || null,
      end.model || null,
    ],
  );
}

/** The reply of a step that answered but could not be used (it did not match the schema). */
async function markInvalid(db, runId, stepNo, issues) {
  await db.query(
    "UPDATE ai_run_step SET outcome = 'invalid', error = $3 WHERE run_id = $1 AND step_no = $2",
    [runId, stepNo, clip(issues)],
  );
}

/** A call governance refused, recorded so the spend screen shows who was turned away and why. */
async function refused(db, { purpose, module, actor, error }) {
  const runId = await startRun(db, {
    purpose,
    module,
    actor,
    status: "refused",
  });
  await finishRun(db, runId, {
    status: "refused",
    provisional: false,
    error_code: error.code || null,
    error: error.message,
  });
  return runId;
}

module.exports = { startRun, recordStep, markInvalid, finishRun, refused };
