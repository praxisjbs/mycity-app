#!/usr/bin/env node
"use strict";
/**
 * Write docs/MyCity-ERP-Documents/dark-theme-samples.html: the hub's Home in each dark preset
 * of Settings · Appearance, side by side, with the four colours to paste for each. Asked for at
 * the Milestone 1 handover (21/10/2026): a dark theme on charcoal, black or dark grey with the
 * green as a highlight, shown to MyCity before anything changes.
 *
 * Every colour on the page is the contract's deriveDark() of the preset's four, the maths the
 * hub itself uses, so a palette chosen here and pasted into Settings · Appearance looks the same
 * in the app. The sample's names and figures are invented for the picture.
 *
 *   node scripts/gen/dark-theme-samples.js            write the file
 *   node scripts/gen/dark-theme-samples.js --check    exit 1 when the file is stale
 */
const fs = require("node:fs");
const path = require("node:path");
const A = require("../../packages/contract/schemas/appearance.js");

const ROOT = path.resolve(__dirname, "..", "..");
const FILE = path.join(ROOT, "docs", "MyCity-ERP-Documents", "dark-theme-samples.html");

/** The light theme's tokens the dark palette leaves as they are (MILESTONES §5.1), read from tokens.css. */
function shippedTokens() {
  const css = fs.readFileSync(path.join(ROOT, "packages", "ui", "src", "styles", "tokens.css"), "utf8");
  const take = (re) => {
    const m = re.exec(css);
    const body = css.slice(m.index + m[0].length, css.indexOf("}", m.index));
    return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]));
  };
  return { ...take(/:root,\s*\[data-theme="light"\]\s*\{/), ...take(/\n\[data-theme="dark"\]\s*\{/) };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const LABELS = { background: "Background", card: "Card", brand_green: "Brand Green", primary_yellow: "Primary Yellow" };
const NOTES = {
  deep_green: "Today's dark theme, on the brand's own hue.",
  charcoal: "Cool charcoal, the green kept for highlights.",
  black: "True black, cards a step above it.",
  dark_grey: "Soft dark grey, the lightest of the four.",
};

/** Lucide-style glyphs, drawn in the current colour. */
const ICON = {
  pin: '<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.6"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3Z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  msg: '<path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5.2A8.5 8.5 0 1 1 21 12Z"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
};
const icon = (name, size = 16) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

const BARS = [92, 88, 95, 64, 90, 86, 97, 61, 89, 93, 87, 66, 91, 90];

/** The Home Overview, as Operations & People see it, in one palette. */
function home() {
  const bars = BARS.map((h, i) => `<i style="height:${h}%" class="${h < 70 ? "sat" : ""}" title="Day ${i + 1}"></i>`).join("");
  const kpi = (title, value, caption, tone) =>
    `<div class="kpi"><span class="kt">${title}</span><b>${value}</b><span class="kc ${tone}">${caption}</span></div>`;
  const row = (name, what, pill, tone, on) =>
    `<div class="row${on ? " on" : ""}"><span class="av">${name.split(" ").map((w) => w[0]).join("")}</span><span class="rw"><b>${name}</b><span>${what}</span></span><span class="pill ${tone}">${pill}</span></div>`;
  return `<div class="app">
    <nav class="rail">
      <span class="brand">${icon("pin", 22)}</span>
      <a class="on">${icon("home")}</a><a>${icon("grid")}</a><a>${icon("users")}</a><a>${icon("msg")}</a><a>${icon("chart")}</a><a>${icon("cog")}</a>
    </nav>
    <main>
      <header class="top">
        <span class="search">${icon("search", 14)} Search people, screens, records</span>
        <span class="bell">${icon("bell", 16)}</span>
        <span class="btn">${icon("clock", 14)} Clock In</span>
      </header>
      <div class="page">
        <div class="eyebrow">Wednesday 21 October</div>
        <h1>Good afternoon, Cynthia</h1>
        <div class="tabs"><span class="on">Overview</span><span>Team</span><span>Alerts</span><span>Reports</span></div>
        <div class="kpis">
          ${kpi("Clocked In Today", "37<small> of 41</small>", "4 late", "warn")}
          ${kpi("Leave Pending", "3", "1 waiting on you", "info")}
          ${kpi("Open Alerts", "2", "1 high", "err")}
          ${kpi("Proposals Out", "5", "2 more than last month", "ok")}
        </div>
        <div class="split">
          <section class="card chart">
            <h2>Attendance, 14 Working Days</h2>
            <div class="bars">${bars}</div>
            <div class="legend"><span><i class="c1"></i>Present</span><span><i class="c2"></i>Saturday, half day</span></div>
          </section>
          <section class="card">
            <h2>Need You</h2>
            ${row("Ada Obi", "Annual leave, 7 days", "Approve", "warn", false)}
            ${row("Tunde Bello", "Lagos conference site", "Waiting", "info", true)}
            ${row("Ngozi Eze", "Clocked out at 13:10", "Early", "err", false)}
            <a class="link">View All</a>
          </section>
        </div>
        <section class="card">
          <h2>Team Roster</h2>
          <div class="field">${icon("search", 13)} Search people</div>
          ${row("Musa Danjuma", "Programmes · 08:52", "On Time", "ok", false)}
          ${row("Bisi Ojo", "Operations · 09:14", "Late", "warn", false)}
          ${row("Zainab Ali", "Marketing · not in", "Absent", "err", false)}
        </section>
      </div>
    </main>
  </div>`;
}

const PAGE_CSS = `
*{box-sizing:border-box}
body{margin:0;background:#0B0C0D;color:#E9E9EA;font:14px/1.5 "Geist",ui-sans-serif,system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1500px;margin:0 auto;padding:32px 24px 64px}
.head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:28px}
.head h1{margin:0;font-size:28px;letter-spacing:-.02em}
.head p{margin:6px 0 0;color:#A9ABB0;max-width:70ch}
.view{display:flex;gap:6px;flex-wrap:wrap}
.view button{font:inherit;font-size:13px;font-weight:600;border:1px solid #33363A;background:#17181A;color:#E9E9EA;border-radius:999px;padding:7px 14px;cursor:pointer}
.view button[aria-pressed="true"]{background:#FFDF55;color:#01221D;border-color:#FFDF55}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:28px}
.grid.one{grid-template-columns:minmax(0,1fr)}
.grid.one .sample:not(.chosen){display:none}
.sample{border:1px solid #2A2C30;border-radius:18px;overflow:hidden;background:#121315}
.meta{display:flex;flex-wrap:wrap;gap:14px 20px;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #2A2C30}
.meta h2{margin:0;font-size:18px}
.meta p{margin:2px 0 0;color:#A9ABB0;font-size:13px}
.codes{display:flex;flex-wrap:wrap;gap:8px}
.code{display:flex;align-items:center;gap:8px;border:1px solid #2F3136;border-radius:10px;padding:6px 8px 6px 6px;background:#18191C;color:#E9E9EA;font:inherit;cursor:pointer}
.code i{width:22px;height:22px;border-radius:6px;border:1px solid rgba(255,255,255,.18)}
.code span{display:flex;flex-direction:column;line-height:1.2;text-align:left}
.code small{color:#A9ABB0;font-size:11px}
.code b{font:600 13px ui-monospace,SFMono-Regular,Menlo,monospace}
.code.done b::after{content:"  copied";color:#45C8B0;font-family:"Geist",system-ui,sans-serif;font-weight:500}
.stats{padding:10px 18px;border-top:1px solid #2A2C30;color:#A9ABB0;font-size:12px}
.stats b{color:#E9E9EA}
.frame{padding:18px}
/* The sample: every colour below is a token, set per preset */
.app{display:flex;min-height:560px;border-radius:14px;overflow:hidden;border:1px solid var(--border);background:var(--background);color:var(--foreground);font-size:13px}
.rail{width:58px;flex:none;display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 0;background:var(--sidebar);color:var(--sidebar-muted)}
.rail .brand{color:var(--sidebar-primary);margin-bottom:10px}
.rail a{display:grid;place-items:center;width:38px;height:38px;border-radius:10px}
.rail a.on{background:var(--sidebar-accent);color:var(--sidebar-accent-foreground)}
main{flex:1;min-width:0;display:flex;flex-direction:column}
.top{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border);background:var(--card)}
.search{flex:1;min-width:0;display:flex;align-items:center;gap:8px;height:32px;padding:0 10px;border:1px solid var(--input);border-radius:9px;background:var(--popover);color:var(--subtle-foreground);font-size:12px;white-space:nowrap;overflow:hidden}
.bell{color:var(--muted-foreground)}
.btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 14px;border-radius:999px;background:var(--primary);color:var(--primary-foreground);font-weight:650;font-size:12.5px}
.page{padding:16px;display:flex;flex-direction:column;gap:12px}
.eyebrow{color:var(--eyebrow);font-size:11px;font-weight:650;letter-spacing:.09em;text-transform:uppercase}
.page h1{margin:-6px 0 0;font-size:20px;letter-spacing:-.016em}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--border)}
.tabs span{padding:6px 10px;color:var(--muted-foreground);font-weight:600;font-size:12.5px;border-bottom:2px solid transparent}
.tabs span.on{color:var(--foreground);border-color:var(--primary)}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.kpi{display:flex;flex-direction:column;gap:2px;padding:11px 12px;border:1px solid var(--border);border-radius:14px;background:var(--card);min-height:96px}
.kt{color:var(--muted-foreground);font-size:11px;font-weight:600}
.kpi b{font-size:22px;line-height:1.2}
.kpi b small{font-size:12px;color:var(--muted-foreground);font-weight:500}
.kc{margin-top:auto;font-size:11px;font-weight:650}
.ok{color:var(--success)}.warn{color:var(--warning)}.err{color:var(--destructive)}.info{color:var(--info)}
.split{display:grid;grid-template-columns:1.25fr 1fr;gap:10px}
.card{border:1px solid var(--border);border-radius:14px;background:var(--card);padding:12px}
.card h2{margin:0 0 8px;font-size:13px}
.bars{display:flex;align-items:flex-end;gap:5px;height:110px;padding-top:6px}
.bars i{flex:1;border-radius:4px 4px 1px 1px;background:var(--chart-1)}
.bars i.sat{background:var(--chart-2)}
.legend{display:flex;gap:14px;margin-top:8px;color:var(--subtle-foreground);font-size:11px}
.legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px}
.legend .c1{background:var(--chart-1)}.legend .c2{background:var(--chart-2)}
.row{display:flex;align-items:center;gap:9px;padding:7px 6px;border-bottom:1px solid var(--border);border-radius:8px}
.row:last-of-type{border-bottom:0}
.row.on{background:var(--accent)}
.row.on .rw b{color:var(--accent-foreground)}
.av{display:grid;place-items:center;width:26px;height:26px;border-radius:999px;background:var(--muted);color:var(--muted-foreground);font-size:10.5px;font-weight:650;flex:none}
.rw{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.3}
.rw b{font-size:12.5px;font-weight:600}
.rw span{color:var(--subtle-foreground);font-size:11px}
.pill{flex:none;padding:2px 8px;border-radius:999px;font-size:10.5px;font-weight:650}
.pill.ok{background:var(--success-soft)}.pill.warn{background:var(--warning-soft)}.pill.err{background:var(--destructive-soft)}.pill.info{background:var(--info-soft)}
.link{display:inline-block;margin-top:6px;color:var(--accent-foreground);font-weight:650;font-size:12px}
.field{display:flex;align-items:center;gap:7px;height:30px;margin-bottom:6px;padding:0 9px;border:1px solid var(--input);border-radius:9px;color:var(--subtle-foreground);font-size:11.5px}
.foot{margin-top:28px;color:#8A8D93;font-size:12px}
@media (max-width:1100px){.grid{grid-template-columns:minmax(0,1fr)}}
@media (max-width:700px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.split{grid-template-columns:minmax(0,1fr)}.wrap{padding:20px 12px}.frame{padding:10px}}
`;

const SCRIPT = `
document.querySelectorAll(".code").forEach(function (b) {
  b.addEventListener("click", function () {
    var hex = b.getAttribute("data-hex");
    var done = function () { b.classList.add("done"); setTimeout(function () { b.classList.remove("done"); }, 1400); };
    if (navigator.clipboard) navigator.clipboard.writeText(hex).then(done, done); else done();
  });
});
var grid = document.querySelector(".grid");
document.querySelectorAll(".view button").forEach(function (b) {
  b.addEventListener("click", function () {
    document.querySelectorAll(".view button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    var key = b.getAttribute("data-key");
    grid.classList.toggle("one", key !== "all");
    document.querySelectorAll(".sample").forEach(function (s) { s.classList.toggle("chosen", s.id === key); });
  });
});
`;

function build() {
  const base = shippedTokens();
  const sections = A.DARK_PRESETS.map((p) => {
    const d = A.deriveDark(p.seeds);
    if (Object.keys(d.problems).length) throw new Error(`${p.key}: ${JSON.stringify(d.problems)}`);
    const tokens = { ...base, ...d.tokens };
    const vars = Object.entries(tokens)
      .filter(([, v]) => /^(#|rgba\()/.test(v))
      .map(([k, v]) => `--${k}:${v}`)
      .join(";");
    const lowest = d.pairs.reduce((m, x) => (x.ratio < m.ratio ? x : m));
    const codes = A.DARK_SEED_KEYS.map(
      (k) =>
        `<button class="code" type="button" data-hex="${p.seeds[k]}" title="Copy ${LABELS[k]}"><i style="background:${p.seeds[k]}"></i><span><small>${LABELS[k]}</small><b>${p.seeds[k]}</b></span></button>`,
    ).join("");
    const moved = Object.keys(d.nudged);
    return `<article class="sample" id="${p.key}">
      <div class="meta">
        <div><h2>${esc(p.name)}</h2><p>${esc(NOTES[p.key] || "")}</p></div>
        <div class="codes">${codes}</div>
      </div>
      <div class="frame" style="${vars}">${home()}</div>
      <div class="stats">Every text pair at <b>4.5:1</b> or more · lowest <b>${lowest.ratio.toFixed(2)}:1</b> (${lowest.text} on ${lowest.surface}) · ${d.pairs.length} pairs checked${moved.length ? ` · adjusted for contrast: ${moved.join(", ")}` : ""}</div>
    </article>`;
  }).join("\n");
  const buttons = [`<button type="button" data-key="all" aria-pressed="true">All Four</button>`, ...A.DARK_PRESETS.map((p) => `<button type="button" data-key="${p.key}" aria-pressed="false">${esc(p.name)}</button>`)].join("");
  return `<!doctype html>
<html lang="en-NG">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dark Theme Samples</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${PAGE_CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="head">
    <div>
      <h1>MyCity Hub · Dark Theme Samples</h1>
      <p>Four dark themes for the hub, each shown on Home. Pick one, then paste its four colours into Settings · Appearance and press Save Palette; the hub works out every other shade and keeps all text readable. The light theme does not change. Click a colour to copy it.</p>
    </div>
    <div class="view" role="group" aria-label="Show">${buttons}</div>
  </div>
  <div class="grid">
${sections}
  </div>
  <p class="foot">Generated by scripts/gen/dark-theme-samples.js from the same maths the hub uses (packages/contract/schemas/appearance.js). Names and figures are invented for the picture.</p>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

const html = build();
if (process.argv.includes("--check")) {
  const now = fs.existsSync(FILE) ? fs.readFileSync(FILE, "utf8") : "";
  if (now !== html) {
    console.error(`dark-theme-samples: ${path.relative(ROOT, FILE)} is stale; run node scripts/gen/dark-theme-samples.js`);
    process.exit(1);
  }
  console.log("dark-theme-samples: up to date");
} else {
  fs.writeFileSync(FILE, html);
  console.log(`dark-theme-samples: wrote ${path.relative(ROOT, FILE)}`);
}
