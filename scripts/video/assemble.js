"use strict";
/**
 * Put a filmed video together (docs/runbooks/training-videos.md §5): each shot becomes a segment
 * (its picture, 1920 × 960, over its caption bar, 1920 × 120), the segments are joined, and the
 * narration is laid on the same clock, set to -16 LUFS. The MP4 carries the chapters, the title and
 * "JBS Praxis" as its artist, as the Milestone 3 video does.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const style = require("./style");
const cards = require("./cards");
const { GAP, LEAD, TAIL } = require("./film");

const FPS = 30;
const ffmpeg = (args) => execFileSync(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });

/** A caption longer than this is shown in two halves, split at "|" or at the comma nearest its middle. */
const CAPTION_MAX = 92;

function captionParts(say) {
  const text = say.trim();
  if (text.includes("|")) return text.split("|").map((p) => p.trim()).filter(Boolean);
  if (text.length <= CAPTION_MAX) return [text];
  const mid = text.length / 2;
  let best = -1;
  for (let i = text.indexOf(", "); i !== -1; i = text.indexOf(", ", i + 1)) if (best === -1 || Math.abs(i - mid) < Math.abs(best - mid)) best = i;
  if (best === -1) { best = text.lastIndexOf(" ", mid); return [text.slice(0, best), text.slice(best + 1)]; }
  return [text.slice(0, best + 1), text.slice(best + 2)];
}

/** Where a card shot's lines fall, since nothing is filmed for it. */
function cardTake(shot) {
  let t = LEAD;
  const lines = shot.lines.map((l, i) => {
    const at = t;
    t += l.duration + (l.hold || 0) + (i < shot.lines.length - 1 ? GAP : TAIL);
    return { id: l.id, at };
  });
  return { start: 0, end: t + (shot.extra || 0), lines, frames: [] };
}

function takeOf(shot, out) {
  if (shot.kind === "card") return cardTake(shot);
  const f = path.join(out, "shots", shot.id, "take.json");
  if (!fs.existsSync(f)) throw new Error(`${shot.id} has not been filmed: run the film step (runbook §4.4).`);
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

/** An ffconcat list holding each image for its time, from `from` to `to` (seconds on the take's clock). */
function concatList(file, items, from, to) {
  const rows = ["ffconcat version 1.0"];
  const list = items.length ? items : [];
  for (let i = 0; i < list.length; i++) {
    const a = i === 0 ? from : list[i].t;
    const b = i + 1 < list.length ? list[i + 1].t : to;
    if (b - a <= 0) continue;
    rows.push(`file '${list[i].file}'`, `duration ${(b - a).toFixed(4)}`);
  }
  rows.push(`file '${list[list.length - 1].file}'`);
  fs.writeFileSync(file, rows.join("\n") + "\n");
}

async function assemble(plan, out, { audioDir, python }) {
  const work = path.join(out, "work");
  fs.mkdirSync(work, { recursive: true });
  const shooter = await cards.open();
  const segments = [];
  const clips = [];
  const chapters = [];
  let offset = 0;
  try {
    const opening = await shooter.shoot(style.card({ ...plan.opening }), path.join(work, "opening.png"), style.SIZE.picture);
    const closing = await shooter.shoot(style.card({ ...plan.closing, closing: true }), path.join(work, "closing.png"), style.SIZE.picture);
    const rim = await shooter.shoot(style.phoneRim(), path.join(work, "phone-rim.png"), style.SIZE.picture);
    const barCache = new Map();
    const barOf = async (shot, caption) => {
      const key = `${shot.chapter}|${caption}`;
      if (!barCache.has(key))
        barCache.set(key, await shooter.shoot(style.bar({ number: shot.chapter, total: plan.chapters, chapter: shot.chapterName, caption }),
          path.join(work, `bar-${String(barCache.size + 1).padStart(4, "0")}.png`), style.SIZE.bar));
      return barCache.get(key);
    };

    for (const [k, shot] of plan.shots.entries()) {
      const take = takeOf(shot, out);
      const length = take.end - take.start;
      if (!chapters.length || chapters[chapters.length - 1].number !== shot.chapter)
        chapters.push({ number: shot.chapter, title: shot.chapterName, start: offset });

      // The caption bar: each line's caption (or its halves, by length) from when it is spoken until the next.
      const bars = [];
      for (const [i, line] of take.lines.entries()) {
        const spec = shot.lines.find((l) => l.id === line.id);
        const parts = captionParts(spec.say);
        const total = parts.reduce((n, p) => n + p.length, 0);
        let at = line.at - take.start;
        for (const p of parts) {
          bars.push({ file: await barOf(shot, p), t: i === 0 && bars.length === 0 ? 0 : at });
          at += (spec.duration * p.length) / total;
        }
        clips.push({ file: path.join(audioDir, `${line.id}.wav`), at: offset + (line.at - take.start) });
      }
      const barList = path.join(work, `bars-${shot.id}.txt`);
      concatList(barList, bars, 0, length);

      // The picture.
      const seg = path.join(work, `seg-${String(k + 1).padStart(3, "0")}.mp4`);
      const enc = ["-r", String(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-pix_fmt", "yuv420p", "-t", length.toFixed(3), seg];
      if (shot.kind === "card") {
        const still = shot.card === "closing" ? closing : opening;
        ffmpeg(["-loop", "1", "-framerate", String(FPS), "-i", still, "-f", "concat", "-safe", "0", "-i", barList,
          "-filter_complex", `[1:v]fps=${FPS},scale=1920:120[b];[0:v][b]vstack=inputs=2,format=yuv420p[v]`, "-map", "[v]", ...enc]);
      } else {
        const shotDir = path.join(out, "shots", shot.id);
        const frames = take.frames.map((f) => ({ file: path.join(shotDir, f.file), t: f.t - take.start }));
        const frameList = path.join(work, `frames-${shot.id}.txt`);
        concatList(frameList, frames, 0, length);
        if (shot.kind === "phone") {
          const ground = await shooter.shoot(style.phoneGround(shot.label), path.join(work, `ground-${shot.id}.png`), style.SIZE.picture);
          const s = style.PHONE.screen;
          ffmpeg(["-loop", "1", "-framerate", String(FPS), "-i", ground, "-f", "concat", "-safe", "0", "-i", frameList,
            "-loop", "1", "-framerate", String(FPS), "-i", rim, "-f", "concat", "-safe", "0", "-i", barList,
            "-filter_complex", `[1:v]fps=${FPS},scale=${s.width}:${s.height}:flags=lanczos[p];[0:v][p]overlay=${s.x}:${s.y}[g];[g][2:v]overlay=0:0[pic];[3:v]fps=${FPS},scale=1920:120[b];[pic][b]vstack=inputs=2,format=yuv420p[v]`,
            "-map", "[v]", ...enc]);
        } else {
          ffmpeg(["-f", "concat", "-safe", "0", "-i", frameList, "-f", "concat", "-safe", "0", "-i", barList,
            "-filter_complex", `[0:v]fps=${FPS},scale=1920:960:flags=lanczos[pic];[1:v]fps=${FPS},scale=1920:120[b];[pic][b]vstack=inputs=2,format=yuv420p[v]`,
            "-map", "[v]", ...enc]);
        }
      }
      segments.push(seg);
      offset += length;
      console.log(`segment ${shot.id}: ${length.toFixed(1)}s (to ${offset.toFixed(1)}s)`);
    }
  } finally {
    await shooter.close();
  }

  // The narration on one track, the segments joined, then the finished file.
  const timeline = path.join(work, "timeline.json");
  fs.writeFileSync(timeline, JSON.stringify({ length: offset, clips }, null, 1));
  const voice = path.join(work, "narration.wav");
  execFileSync(python, [path.join(__dirname, "narrate.py"), "mix", timeline, voice], { stdio: "inherit" });
  const segList = path.join(work, "segments.txt");
  fs.writeFileSync(segList, "ffconcat version 1.0\n" + segments.map((s) => `file '${s}'`).join("\n") + "\n");
  const meta = path.join(work, "meta.txt");
  const ms = (s) => Math.round(s * 1000);
  fs.writeFileSync(meta, [";FFMETADATA1", `title=${plan.meta.title}`, `artist=${plan.meta.artist || "JBS Praxis"}`,
    ...chapters.flatMap((c, i) => ["[CHAPTER]", "TIMEBASE=1/1000", `START=${ms(c.start)}`,
      `END=${ms(i + 1 < chapters.length ? chapters[i + 1].start : offset)}`, `title=${c.title}`])].join("\n") + "\n");
  const final = path.join(out, `${plan.file}.mp4`);
  ffmpeg(["-f", "concat", "-safe", "0", "-i", segList, "-i", voice, "-i", meta, "-map", "0:v", "-map", "1:a", "-map_metadata", "2", "-map_chapters", "2",
    "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-pix_fmt", "yuv420p", "-r", String(FPS), "-movflags", "+faststart",
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=7,aresample=48000", "-ac", "1", "-c:a", "aac", "-b:a", "160k", "-t", offset.toFixed(3), final]);
  return { final, length: offset, chapters };
}

module.exports = { assemble, captionParts, cardTake };
