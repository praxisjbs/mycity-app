"use strict";
/**
 * Voice notes and video, made playable everywhere (BACKEND_STRUCTURE §5.3). Runs in the
 * worker (the av-transcode job), never in a request: a minute of video takes seconds of CPU.
 *
 *   voice note (M1 chat, M2 dictation)  → Opus in Ogg, mono, 32 kbps; duration stored
 *   video (chat)                        → H.264 + AAC MP4, at most 720p, fast start; a poster frame
 *
 * The original upload stays the master (it is what was sent); these are variants beside it,
 * under derived/<document id>/.
 *
 * ffmpeg and ffprobe are run directly with an argument list (never a shell), with a time
 * limit, and their output goes to a scratch folder on the same disk as the
 * store, so storing the result is a rename. Paths come from FFMPEG_PATH / FFPROBE_PATH.
 */
const { spawn } = require("node:child_process");
const path = require("node:path");
const { config } = require("../../config/env");
const storage = require("../storage/storage.service");

const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_SECONDS = 15 * 60;

/**
 * Run a binary; resolve its stdout, reject with the tail of stderr.
 * @param {string} bin
 * @param {string[]} args
 * @param {{timeoutMs?: number}} [opts]
 */
function run(bin, args, { timeoutMs = RUN_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    let child;
    try {
      child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      reject(new Error(`${path.basename(bin)} could not start: ${e.message}`));
      return;
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => {
      if (out.length < 1_000_000) out += d;
    });
    child.stderr.on("data", (d) => {
      err = (err + d).slice(-4000);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`${path.basename(bin)} is not runnable: ${e.message}`));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${path.basename(bin)} ${signal ? `was stopped (${signal})` : `exited ${code}`}: ${err.slice(-600)}`));
    });
  });
}

/** Duration, size and which streams a file has. */
async function probe(absPath) {
  const json = await run(config.FFPROBE_PATH, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", absPath], {
    timeoutMs: 60_000,
  });
  const meta = JSON.parse(json || "{}");
  const streams = meta.streams || [];
  const video = streams.find((s) => s.codec_type === "video" && !(s.disposition && s.disposition.attached_pic));
  const audio = streams.find((s) => s.codec_type === "audio");
  const seconds = Number(meta.format && meta.format.duration);
  return {
    duration_ms: Number.isFinite(seconds) ? Math.round(seconds * 1000) : null,
    width: video ? video.width : null,
    height: video ? video.height : null,
    has_video: Boolean(video),
    has_audio: Boolean(audio),
  };
}

const ffmpeg = (args) => run(config.FFMPEG_PATH, ["-hide_banner", "-nostdin", "-y", ...args]);

async function toOpus(inAbs, outAbs) {
  await ffmpeg(["-i", inAbs, "-t", String(MAX_SECONDS), "-vn", "-ac", "1", "-c:a", "libopus", "-b:a", "32k", "-application", "voip", outAbs]);
}

async function toMp4(inAbs, outAbs) {
  await ffmpeg([
    "-i", inAbs, "-t", String(MAX_SECONDS),
    "-vf", "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", outAbs,
  ]);
}

async function posterFrame(inAbs, outAbs, durationMs) {
  const at = durationMs && durationMs > 2000 ? 1 : 0;
  await ffmpeg(["-ss", String(at), "-i", inAbs, "-frames:v", "1", "-vf", "scale='min(960,iw)':-2", "-q:v", "4", outAbs]);
}

/**
 * Make the playable variants for a stored audio or video master.
 * @param {{document_id: string, storage_key: string, kind: "audio"|"video"}} doc
 * @returns {Promise<{duration_ms: number|null, width: number|null, height: number|null,
 *           variants: Array<{kind: string, key: string, mime: string, bytes: number}>}>}
 */
async function derive({ document_id: id, storage_key: key, kind }) {
  const input = storage.absPath(key);
  const info = await probe(input);
  const { dir, cleanup } = await storage.scratch();
  const variants = [];
  try {
    if (kind === "audio" || !info.has_video) {
      const out = path.join(dir, "voice.ogg");
      await toOpus(input, out);
      const k = `derived/${id}/voice.ogg`;
      const { bytes } = await storage.putFile(k, out, { overwrite: true });
      variants.push({ kind: "opus", key: k, mime: "audio/ogg", bytes });
    } else {
      const out = path.join(dir, "video.mp4");
      await toMp4(input, out);
      const k = `derived/${id}/video.mp4`;
      const { bytes } = await storage.putFile(k, out, { overwrite: true });
      variants.push({ kind: "mp4-720", key: k, mime: "video/mp4", bytes });
      const still = path.join(dir, "poster.jpg");
      await posterFrame(input, still, info.duration_ms);
      const pk = `derived/${id}/poster.jpg`;
      const p = await storage.putFile(pk, still, { overwrite: true });
      variants.push({ kind: "poster", key: pk, mime: "image/jpeg", bytes: p.bytes });
    }
  } finally {
    await cleanup();
  }
  return { duration_ms: info.duration_ms, width: info.width, height: info.height, variants };
}

/** Readiness: both binaries answer. */
async function health() {
  try {
    await run(config.FFMPEG_PATH, ["-version"], { timeoutMs: 5000 });
    await run(config.FFPROBE_PATH, ["-version"], { timeoutMs: 5000 });
    return { status: "up" };
  } catch (err) {
    return { status: "degraded", error: err.message.slice(0, 200) };
  }
}

module.exports = { run, probe, derive, health, MAX_SECONDS };
