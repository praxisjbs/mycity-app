"use strict";
/**
 * Voice to text: voice notes on request (M1), dictation (M2, A18). The chain is Groq, then
 * Gemini, then the browser's own captions (docs/guides/integrations.md §1.2 decisions 6 to 9).
 *
 *   const t = await transcription.transcribe({ document_id, module: "community", actor: req.user, captions });
 *   // → { text, draft: false, provisional: true, run_id, vendor: "groq", model: "whisper-large-v3" }
 *   // → { text: captions, draft: true, vendor: "browser", ... }   when no provider could answer
 *
 * The chain is the action's (`voice-note-transcription`, services/ai/actions.js), which is the
 * Transcription job's unless AI Control gives it its own: Whisper on Groq first, then Gemini's
 * Flash, as it starts (services/ai/jobs.js). A model is passed over when (its state on AI Control):
 *   - its key is not set up, or the key's list no longer names it;
 *   - its provider said its quota or rate limit is used up, until the time it gave (skips.js);
 *   - its provider is on the Free plan and has reached the daily limit on Settings · Integrations;
 *   - its provider has reached its monthly cap on AI Control · Spend;
 *   - it refuses, fails, or takes more than 30 seconds (this call only).
 * A quota refusal also marks the provider skipped until its reset, so the next voice note goes
 * straight to the next one. When none answers, the captions the browser wrote while the sender
 * recorded are handed back as a draft, never to be stored as the transcript; without them the
 * call fails with AI_UNAVAILABLE. With no provider set up at all (a laptop, CI) the stub's marked
 * placeholder comes back, as a draft too.
 *
 * Each step is charged at its model's price (prices.js): Groq by the seconds it bills, Gemini's
 * input tokens at its audio price. A Free plan is charged nothing; its seconds are still kept.
 *
 * Same path as llm.service.complete: governance first (a refusal is recorded), the run opened
 * before anything is sent, each attempt recorded as a step, the run closed. Only audio the caller
 * may read is sent: the caller checks access first, and this reads the stored file by id (a voice
 * note must be audio, and must have passed its scan if it came from outside).
 */
const path = require("node:path");
const fsp = require("node:fs/promises");
const { AppError } = require("../../shared/errors");
const catalog = require("../../shared/access/access.catalog");
const integrations = require("../../shared/integrations/settings");
const quota = require("../../shared/integrations/quota");
const usage = require("../../shared/integrations/usage");
const { logger } = require("../../config/logger");
const governance = require("./governance");
const ledger = require("./ledger");
const jobs = require("./jobs");
const prices = require("./prices");
const skips = require("./skips");

/** How long one provider may take before the next is asked (decision 7). */
const PROVIDER_MS = 30_000;

const DEFAULT_VENDORS = Object.freeze({
  groq: require("./vendors/groq"),
  gemini: require("./vendors/gemini"),
  stub: require("./vendors/stub"),
});

/** What Groq's Whisper takes as it is; anything else is sent as MP3. */
const GROQ_TYPES = new Map([
  ["audio/webm", "webm"],
  ["audio/ogg", "ogg"],
  ["audio/mp4", "m4a"],
  ["audio/x-m4a", "m4a"],
  ["audio/m4a", "m4a"],
  ["audio/mpeg", "mp3"],
  ["audio/mp3", "mp3"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/flac", "flac"],
]);

/** The stored recording, as each provider takes it. */
const DEFAULT_AUDIO = {
  /** The original, which is the best quality there is; MP3 when Groq would not read its type. */
  async forGroq(doc) {
    const storage = require("../storage/storage.service");
    const base = String(doc.mime).split(";")[0].trim().toLowerCase();
    const ext = GROQ_TYPES.get(base);
    if (ext) return { audio: await storage.get(doc.storage_key), mime: base, filename: `voice-note.${ext}` };
    return { audio: await DEFAULT_AUDIO.mp3(doc), mime: "audio/mpeg", filename: "voice-note.mp3" };
  },
  /** MP3 for Gemini, which cannot read the WebM Chrome records. */
  async mp3(doc) {
    const storage = require("../storage/storage.service");
    const { speechMp3 } = require("../media/av-pipeline");
    const { dir, cleanup } = await storage.scratch();
    try {
      const out = path.join(dir, "speech.mp3");
      await speechMp3(storage.absPath(doc.storage_key), out);
      return await fsp.readFile(out);
    } finally {
      await cleanup();
    }
  },
};

/** Whether a failure means the provider's quota or rate limit is used up. */
const isQuota = (err) => Boolean(err) && (err.kind === "rate_limited" || err.status === 429 || err.status === 402);

const draftOf = (captions, runId) => ({
  text: captions,
  draft: true,
  provisional: true,
  run_id: runId,
  vendor: "browser",
  model: "browser",
});

/**
 * @param {{document_id: string, module: string, actor: object|null, purpose?: string,
 *          captions?: string|null, db?: {query: Function}, vendors?: object, audio?: object}} req
 *   purpose   the registered action (services/ai/actions.js); a voice note's unless given
 *   captions  what the browser wrote while the sender recorded, if anything: the last resort
 *   vendors, audio  tests
 * @returns {Promise<{text: string, draft: boolean, provisional: true, run_id: string, vendor: string, model: string}>}
 */
async function transcribe({
  document_id: documentId,
  module,
  actor = null,
  purpose = "voice-note-transcription",
  captions = null,
  db = require("../../config/db").pool,
  vendors = DEFAULT_VENDORS,
  audio = DEFAULT_AUDIO,
}) {
  if (!catalog.isModule(module)) throw new Error(`ai.transcribe: "${module}" is not a module key`);
  const { rows } = await db.query("SELECT mime, scan_status, storage_key FROM document WHERE document_id = $1", [documentId]);
  const doc = rows[0];
  if (!doc) throw new AppError("NOT_FOUND", "Not found", 404);
  if (!/^audio\//.test(doc.mime)) throw new AppError("NOT_AUDIO", "Only a voice recording can be transcribed.", 422);
  if (doc.scan_status === "pending" || doc.scan_status === "infected")
    throw new AppError("NOT_READY", "This recording is not ready yet.", 409);
  const fallback = typeof captions === "string" && captions.trim() ? captions.trim() : null;

  let g;
  try {
    g = await governance.check(db, { module });
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    const runId = await ledger.refused(db, { purpose, module, actor, error: err });
    // The captions came from the sender's own browser, not an AI vendor: a switched-off AI
    // still leaves them.
    if (fallback) return draftOf(fallback, runId);
    throw err;
  }

  const chain = g.settings.forced_stub ? null : await jobs.resolve(purpose, { db });
  const setUp = Boolean(chain) && chain.links.some((l) => l.state !== "not_set_up" && vendors[l.provider]);
  if (!setUp) return stub(db, { purpose, module, actor, fallback, vendors });
  const links = chain.links.filter((l) => l.state === "ready" && vendors[l.provider]);
  const first = links[0] || chain.links[0];

  // An action with a prompt of its own (review-dictation) is transcribed by it; the rest by the voice note's.
  const llm = require("./llm.service");
  const own = require("node:fs").existsSync(path.join(llm.PROMPTS_DIR, `${purpose}.md`));
  const prompt = llm.loadPrompt(own ? purpose : "voice-note-transcription");
  const runId = await ledger.startRun(db, { purpose, module, actor, vendor: first.provider, model: first.model, prompt });
  let stepNo = 0;
  let last = null;

  for (const link of links) {
    const { provider, model } = link;
    const skippedUntil = await skips.until(provider);
    if (skippedUntil) {
      logger.debug({ provider, until: skippedUntil.toISOString() }, "transcription: provider skipped until its reset");
      continue;
    }
    if (await quota.spent(provider, { db })) continue;
    const apiKey = await integrations.secret(provider, "api_key", { db });
    if (!apiKey) continue;

    stepNo += 1;
    const started = Date.now();
    const kind = provider === "groq" ? "transcribe" : "call";
    const charged = await prices.forStep(db, { provider, model, audio: provider === "gemini" });
    try {
      const res =
        provider === "groq"
          ? await vendors.groq.transcribe({ apiKey, model, ...(await audio.forGroq(doc)), timeoutMs: PROVIDER_MS })
          : await vendors.gemini.transcribe({
              apiKey,
              model,
              audio: await audio.mp3(doc),
              mime: "audio/mp3",
              prompt: prompt.body,
              timeoutMs: PROVIDER_MS,
            });
      usage.record(provider, kind, provider === "groq" ? { ok: true, units: res.billed_s } : { ok: true });
      await ledger.recordStep(db, runId, {
        step_no: stepNo,
        kind: "transcription",
        vendor: provider,
        model: res.model || model,
        usage: provider === "groq" ? { input_tokens: 0, output_tokens: 0, audio_seconds: res.billed_s } : res.usage,
        prices: charged,
        latency_ms: Date.now() - started,
        finish_reason: res.finish_reason || null,
        outcome: "ok",
      });
      await ledger.finishRun(db, runId, { status: "ok", vendor: provider, model: res.model || model });
      return { text: res.text, draft: false, provisional: true, run_id: runId, vendor: provider, model: res.model || model };
    } catch (err) {
      last = err;
      const code = require("./llm.service").callCode(err);
      usage.record(provider, kind, provider === "groq" ? { ok: false, units: 0, error_code: code } : { ok: false, error_code: code });
      await ledger.recordStep(db, runId, {
        step_no: stepNo,
        kind: "transcription",
        vendor: provider,
        model,
        prices: charged,
        latency_ms: Date.now() - started,
        outcome: "failed",
        error: err && err.message,
      });
      if (isQuota(err)) await skips.mark(provider, err.retryAfterMs, code);
      logger.warn({ provider, code, err: err && err.message }, "transcription: provider did not answer; trying the next");
    }
  }

  await ledger.finishRun(db, runId, {
    status: "failed",
    error_code: "AI_UNAVAILABLE",
    error: last ? last.message : "every provider in the chain was skipped",
  });
  if (fallback) return draftOf(fallback, runId);
  throw new AppError("AI_UNAVAILABLE", "Transcription is not available right now. Try again shortly.", 503);
}

/** Nothing set up: the browser's captions if there are any, else the stub's marked placeholder. */
async function stub(db, { purpose, module, actor, fallback, vendors }) {
  const runId = await ledger.startRun(db, { purpose, module, actor, vendor: fallback ? "browser" : "stub", model: fallback ? "browser" : "stub" });
  if (fallback) {
    await ledger.finishRun(db, runId, { status: "ok" });
    return draftOf(fallback, runId);
  }
  const started = Date.now();
  const res = await vendors.stub.transcribe();
  await ledger.recordStep(db, runId, {
    step_no: 1,
    kind: "transcription",
    vendor: "stub",
    model: "stub",
    usage: res.usage,
    prices: prices.zero(),
    latency_ms: Date.now() - started,
    outcome: "ok",
  });
  await ledger.finishRun(db, runId, { status: "ok" });
  return { text: res.text, draft: true, provisional: true, run_id: runId, vendor: "stub", model: "stub" };
}

/** The stub's placeholder: never a transcript to keep, or to show as one. */
const STUB_TEXT = DEFAULT_VENDORS.stub.TRANSCRIPT;

module.exports = { transcribe, PROVIDER_MS, GROQ_TYPES, DEFAULT_AUDIO, STUB_TEXT };
