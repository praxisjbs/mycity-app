#!/usr/bin/env node
"use strict";
/**
 * Make a MyCity training video (docs/runbooks/training-videos.md).
 *
 *   node scripts/video/make.js <scene> script               print the narration, chapter by chapter
 *   node scripts/video/make.js <scene> prepare              the ground a scene films on, when it has one
 *                                                           (its `prepare`; runbook §4.1), on a fresh database
 *   node scripts/video/make.js <scene> narrate              Emma's voice for every line (cached by text)
 *   node scripts/video/make.js <scene> film [--only c03s01,c04s02]   record the shots
 *   node scripts/video/make.js <scene> assemble             cards, captions, chapters, sound: the MP4
 *   node scripts/video/make.js <scene> all                  narrate, film and assemble
 *
 * <scene> is a file in scripts/video/scenes/ (with or without .js). Needs the app running on a
 * development database with the staff roster and the staging seed (runbook §4.1), ffmpeg, Chromium
 * (MYCITY_CHROMIUM) and the narration's Python (VIDEO_PYTHON, runbook §1).
 *
 *   VIDEO_OUT        where the work and the MP4 go (default: <tmp>/mycity-video/<scene>)
 *   VIDEO_PASSWORD   the password filming gives the people it signs in as (default SEED_PASSWORD)
 *   VIDEO_PYTHON     a python with scripts/video/requirements.txt installed (default python3)
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

/** How a word on screen is said: the caption keeps the first, Emma reads the second. */
const SAID = [
  [/\bMyCity\b/g, "My City"],
  [/\bCVs\b/g, "C Vs"],
  [/\bCV\b/g, "C V"],
  [/\bJD\b/g, "J D"],
  [/\bAPP-0*(\d+)/g, "app $1"],
  [/\bASM-0*(\d+)/g, "A S M $1"],
  [/\bQRY-0*(\d+)/g, "query $1"],
  [/\bOFF-0*(\d+)/g, "offer $1"],
  [/\bCON-0*(\d+)/g, "contract $1"],
  [/\bBVN\b/g, "B V N"],
  [/\bNYSC\b/g, "N Y S C"],
  [/\bMyLagosApp\b/g, "My Lagos App"],
  [/\bEXP-0*(\d+)/g, "expense $1"],
  [/\bREQ-0*(\d+)/g, "requisition $1"],
  [/\bDSB-0*(\d+)/g, "disbursement $1"],
  [/\bINV-\d+-(\d\d)(\d\d)\b/g, "ending $1 $2"],
  [/\bJBS\b/g, "J B S"],
  [/\bPDF\b/g, "P D F"],
  [/\bDTT\b/g, "D T T"],
  [/ & /g, " and "],
  [/\bhub\.mycityapp\.io\b/g, "hub dot my city app dot I O"],
  [/\|/g, ""],
];
const speechOf = (line) => line.speech || SAID.reduce((t, [re, to]) => t.replace(re, to), line.say).replace(/\s+/g, " ").trim();

function loadScene(name) {
  const file = path.resolve(__dirname, "scenes", name.endsWith(".js") ? name : `${name}.js`);
  if (!fs.existsSync(file)) throw new Error(`No scene ${file}`);
  return require(file);
}

/** The scene, flattened: every shot with its chapter, every line with an id and its words. */
function planOf(scene) {
  const shots = [];
  scene.chapters.forEach((chapter, ci) => {
    chapter.shots.forEach((shot, si) => {
      const id = `c${String(ci + 1).padStart(2, "0")}s${String(si + 1).padStart(2, "0")}`;
      shots.push({
        ...shot, id, chapter: ci + 1, chapterName: chapter.name,
        lines: shot.lines.map((l, li) => {
          const line = typeof l === "string" ? { say: l } : l;
          return { ...line, id: `${id}l${String(li + 1).padStart(2, "0")}`, speech: speechOf(line) };
        }),
      });
    });
  });
  return { ...scene, shots, chapters: scene.chapters.length };
}

function printScript(plan) {
  let words = 0;
  let chapter = 0;
  for (const shot of plan.shots) {
    if (shot.chapter !== chapter) {
      chapter = shot.chapter;
      console.log(`\n## ${chapter} · ${shot.chapterName}`);
    }
    const where = shot.kind === "card" ? `${shot.card} card` : `${shot.kind}${shot.as ? `, as ${shot.as}` : ""}${shot.start ? `, ${shot.site === "go" ? "go" : "hub"}${shot.start}` : ""}`;
    console.log(`\n[${shot.id} · ${where}]`);
    for (const l of shot.lines) {
      words += l.speech.split(/\s+/).length;
      console.log(`- ${l.say.replace(/\|/g, "")}`);
    }
  }
  console.log(`\n${words} words, about ${(words / 155).toFixed(1)} minutes at Milestone 3's 155 words a minute.`);
}

async function main() {
  const [name, step = "all", ...rest] = process.argv.slice(2);
  if (!name) { console.log(fs.readFileSync(__filename, "utf8").split("*/")[0]); process.exit(2); }
  const plan = planOf(loadScene(name));
  if (step === "script") return printScript(plan);
  if (step === "prepare") {
    if (!plan.prepare) throw new Error(`${plan.id} has no prepare step: seed with scripts/db/seed.js --staging (runbook §4.1).`);
    return plan.prepare({ log: console.log });
  }

  const out = process.env.VIDEO_OUT || path.join(os.tmpdir(), "mycity-video", plan.id);
  const audioDir = path.join(out, "audio");
  const python = process.env.VIDEO_PYTHON || "python3";
  fs.mkdirSync(out, { recursive: true });
  const steps = step === "all" ? ["narrate", "film", "assemble"] : [step];

  if (steps.includes("narrate")) {
    const lines = path.join(out, "lines.json");
    fs.writeFileSync(lines, JSON.stringify({ voice: plan.voice || "bf_emma", speed: plan.speed || 1.0, lines: plan.shots.flatMap((s) => s.lines.map((l) => ({ id: l.id, speech: l.speech }))) }, null, 1));
    execFileSync(python, [path.join(__dirname, "narrate.py"), "speak", lines, audioDir], { stdio: "inherit" });
  }
  const durations = JSON.parse(fs.readFileSync(path.join(audioDir, "durations.json"), "utf8"));
  for (const s of plan.shots) for (const l of s.lines) {
    if (!(l.id in durations)) throw new Error(`No narration for ${l.id}: run the narrate step.`);
    l.duration = durations[l.id];
  }

  if (steps.includes("film")) {
    const { config } = require("../../src/config/env");
    const people = require("./people");
    const password = process.env.VIDEO_PASSWORD || process.env.SEED_PASSWORD;
    if (!password) throw new Error("Set VIDEO_PASSWORD (or SEED_PASSWORD) for the people filming signs in as.");
    const staff = await people.posts();
    const emails = {};
    for (const [key, find] of Object.entries(plan.people || {})) emails[key] = typeof find === "function" ? find(staff) : find;
    const used = [...new Set(plan.shots.map((s) => s.as).filter(Boolean))];
    for (const u of used) if (!emails[u]) throw new Error(`The scene films as "${u}" but its people do not name them.`);
    await people.ready(used.map((u) => emails[u]), password);
    const only = rest.find((a) => a.startsWith("--only="));
    await require("./film").film(plan, out, {
      origins: { hub: config.STAFF_ORIGIN, go: config.PUBLIC_ORIGIN },
      port: config.PORT,
      password,
      emailOf: (key) => emails[key],
      only: only ? new Set(only.slice(7).split(",")) : null,
    });
  }

  if (steps.includes("assemble")) {
    const { final, length, chapters } = await require("./assemble").assemble(plan, out, { audioDir, python });
    console.log(`\n${final}\n${(length / 60).toFixed(1)} minutes, ${chapters.length} chapters`);
  }
}

main().then(() => process.exit(0), (err) => { console.error(err.stack || err.message); process.exit(1); });
