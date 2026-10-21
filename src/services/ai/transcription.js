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
 * The stub answers with a marked placeholder. With a Gemini key the stored recording is sent
 * to Gemini (vendors/gemini.js transcribe): a type Gemini takes as it is, anything else
 * (browsers record webm/Opus, Safari mp4/AAC) first made 16 kHz mono FLAC with ffmpeg, which
 * for a dictated answer of at most three minutes takes well under a second.
 *
 * Only audio the caller may read is sent: the caller checks vault.canRead first, and
 * this reads the stored file by id (a voice note must be audio, and must have passed
 * its scan if it came from outside).
 */
const { AppError } = require("../../shared/errors");
const catalog = require("../../shared/access/access.catalog");
const governance = require("./governance");
const ledger = require("./ledger");

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { config } = require("../../config/env");
const storage = require("../storage/storage.service");
const av = require("../media/av-pipeline");

const DEFAULT_VENDORS = Object.freeze({ gemini: require("./vendors/gemini"), stub: require("./vendors/stub") });

/** Types Gemini takes as they are, by the stored mime's base type. */
const ACCEPTED = new Map([
  ["audio/wav", "audio/wav"],
  ["audio/x-wav", "audio/wav"],
  ["audio/mp3", "audio/mp3"],
  ["audio/mpeg", "audio/mp3"],
  ["audio/aiff", "audio/aiff"],
  ["audio/aac", "audio/aac"],
  ["audio/flac", "audio/flac"],
]);
const CONVERT_TIMEOUT_MS = 60_000;

/** The recording's bytes in a type the vendor takes. */
async function audioOf(doc) {
  const audio = await storage.get(doc.storage_key);
  const base = String(doc.mime || "").split(";")[0].trim().toLowerCase();
  if (ACCEPTED.has(base)) return { audio, mimeType: ACCEPTED.get(base) };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mycity-audio-"));
  try {
    const input = path.join(dir, "in.bin");
    const output = path.join(dir, "out.flac");
    await fs.writeFile(input, audio);
    await av.run(
      config.FFMPEG_PATH || "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-nostdin", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "flac", output],
      { timeoutMs: CONVERT_TIMEOUT_MS },
    );
    return { audio: await fs.readFile(output), mimeType: "audio/flac" };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

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
    "SELECT mime, scan_status, storage_key FROM document WHERE document_id = $1",
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
      error: "this vendor does not transcribe",
    });
    await ledger.finishRun(db, runId, {
      status: "failed",
      error_code: "AI_NOT_AVAILABLE",
      error: "this vendor does not transcribe",
    });
    throw new AppError(
      "AI_NOT_AVAILABLE",
      "Transcription is not available yet.",
      501,
    );
  }
  let res;
  try {
    const input = vendorName === "stub" ? {} : await audioOf(doc);
    res = await vendor.transcribe({
      document_id: documentId,
      model,
      apiKey: config.GEMINI_API_KEY,
      timeoutMs: config.AI_REQUEST_TIMEOUT_MS,
      ...input,
    });
  } catch (err) {
    await ledger.recordStep(db, runId, {
      step_no: 1,
      kind: "transcription",
      vendor: vendorName,
      model,
      prices,
      latency_ms: Date.now() - started,
      outcome: "failed",
      error: err.message,
    });
    const configError = err.kind === "config";
    await ledger.finishRun(db, runId, {
      status: "failed",
      error_code: configError ? "AI_VENDOR_CONFIG" : "AI_UNAVAILABLE",
      error: err.message,
    });
    throw new AppError(configError ? "AI_VENDOR_CONFIG" : "AI_UNAVAILABLE", "Could not hear that, try again", 503);
  }
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
