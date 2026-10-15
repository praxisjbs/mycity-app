"use strict";
/**
 * Voice to text (M1 voice notes on request, M2 dictation). The seam is built in M0 so
 * the callers, the switch, the cap and the ledger are in place; the Gemini audio call
 * itself arrives with M2 (BACKEND_STRUCTURE §14.5).
 *
 *   const t = await transcription.transcribe({ document_id, module: "community", actor: req.user });
 *   // → { text, provisional: true, run_id, vendor }
 *
 * Same path as llm.service.complete: governance first (a refusal is recorded), the run
 * opened before anything is sent, the step recorded with its tokens, the run closed.
 * The stub answers with a marked placeholder. With a Gemini key, until M2, the call
 * fails with AI_NOT_AVAILABLE and the run says so, rather than pretending.
 *
 * Only audio the caller may read is sent: the caller checks vault.canRead first, and
 * this reads the stored file by id (a voice note must be audio, and must have passed
 * its scan if it came from outside).
 */
const { AppError } = require("../../shared/errors");
const catalog = require("../../shared/access/access.catalog");
const governance = require("./governance");
const ledger = require("./ledger");

const DEFAULT_VENDORS = Object.freeze({ stub: require("./vendors/stub") });

/**
 * @param {{document_id: string, module: string, actor: object|null, purpose?: string,
 *          db?: {query: Function}, vendors?: object}} req
 */
async function transcribe({
  document_id: documentId,
  module,
  actor = null,
  purpose = "transcription",
  db = require("../../config/db").pool,
  vendors = DEFAULT_VENDORS,
}) {
  if (!catalog.isModule(module))
    throw new Error(`ai.transcribe: "${module}" is not a module key`);
  const { rows } = await db.query(
    "SELECT mime, scan_status FROM document WHERE document_id = $1",
    [documentId],
  );
  const doc = rows[0];
  if (!doc) throw new AppError("NOT_FOUND", "Not found", 404);
  if (!/^audio\//.test(doc.mime))
    throw new AppError(
      "NOT_AUDIO",
      "Only a voice recording can be transcribed.",
      422,
    );
  if (doc.scan_status === "pending" || doc.scan_status === "infected")
    throw new AppError("NOT_READY", "This recording is not ready yet.", 409);

  let g;
  try {
    g = await governance.check(db, { module });
  } catch (err) {
    if (err instanceof AppError)
      await ledger.refused(db, { purpose, module, actor, error: err });
    throw err;
  }
  const vendorName = g.vendor;
  const model = vendorName === "stub" ? "stub" : g.model;
  const runId = await ledger.startRun(db, {
    purpose,
    module,
    actor,
    vendor: vendorName,
    model,
  });
  const prices =
    vendorName === "stub"
      ? { input_ngn_per_million: "0.00", output_ngn_per_million: "0.00" }
      : {
          input_ngn_per_million: g.settings.input_ngn_per_million,
          output_ngn_per_million: g.settings.output_ngn_per_million,
        };

  const vendor = vendors[vendorName];
  const started = Date.now();
  if (!vendor || typeof vendor.transcribe !== "function") {
    await ledger.recordStep(db, runId, {
      step_no: 1,
      kind: "transcription",
      vendor: vendorName,
      model,
      prices,
      latency_ms: 0,
      outcome: "failed",
      error: "transcription arrives with M2",
    });
    await ledger.finishRun(db, runId, {
      status: "failed",
      error_code: "AI_NOT_AVAILABLE",
      error: "transcription arrives with M2",
    });
    throw new AppError(
      "AI_NOT_AVAILABLE",
      "Transcription is not available yet.",
      501,
    );
  }
  const res = await vendor.transcribe({ document_id: documentId, model });
  await ledger.recordStep(db, runId, {
    step_no: 1,
    kind: "transcription",
    vendor: vendorName,
    model: res.model || model,
    usage: res.usage,
    prices,
    latency_ms: Date.now() - started,
    outcome: "ok",
  });
  await ledger.finishRun(db, runId, { status: "ok" });
  return {
    text: res.text,
    provisional: true,
    run_id: runId,
    vendor: vendorName,
  };
}

module.exports = { transcribe };
