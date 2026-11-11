"use strict";
/**
 * The look of a MyCity training video, measured from the Milestone 3 handover video
 * (docs/runbooks/training-videos.md §2) and kept here so every video matches it.
 *
 * A frame is 1920 × 1080: the picture (1920 × 960) above the caption bar (1920 × 120). Each builder
 * returns a self-contained HTML page that `cards.js` photographs with Chromium. Colours are the
 * brand tokens of packages/ui/src/styles/tokens.css (Deep Green, the primary yellow); the face is
 * Inter's standard cut (not its optical-size cut, which is narrower at large sizes).
 */
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const INTER = path.join(ROOT, "node_modules", "@fontsource-variable", "inter", "files", "inter-latin-wght-normal.woff2");

const SIZE = Object.freeze({ width: 1920, height: 1080, picture: 960, bar: 120 });

/** Desktop is filmed at 1536 × 768 with a device scale of 1.25 (the sidebar fills 310 px, as on Milestone 3), filling the picture exactly. */
const DESKTOP = Object.freeze({ viewport: { width: 1536, height: 768 }, deviceScaleFactor: 1.25 });

/** A phone is filmed at 390 × 860 (scale 2) and shown at 394 × 869 inside the frame below. */
const PHONE = Object.freeze({
  viewport: { width: 390, height: 860 },
  deviceScaleFactor: 2,
  screen: { x: 1068, y: 40, width: 394, height: 869, radius: 46 },
  body: { x: 1050, y: 22, width: 430, height: 905, radius: 64 },
});

const COLOUR = Object.freeze({
  deep: "#01211e",
  bar: "#00201d",
  barLine: "#dcbe33",
  primary: "#ffdf55",
  rule: "#ffdb56",
  ink: "#ffffff",
  soft: "#d7dedc",
  muted: "#a9b5b2",
  bezel: "#111312",
});

const BASE_CSS = `
@font-face{font-family:Inter;src:url("file://${INTER}") format("woff2");font-weight:100 900}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${SIZE.width}px;overflow:hidden;background:transparent}
body{font-family:Inter;color:${COLOUR.ink};position:relative;-webkit-font-smoothing:antialiased}
.ground{position:absolute;inset:0;background:
  radial-gradient(900px 700px at 1650px 170px,#0d3c35 0%,rgba(13,60,53,0) 70%),
  radial-gradient(800px 600px at 150px 960px,#1c3a1d 0%,rgba(28,58,29,0) 70%),
  ${COLOUR.deep}}
`;

const PIN = `<svg viewBox="0 0 24 30" width="32" height="40"><path fill="${COLOUR.primary}" d="M12 0C5.4 0 0 5.2 0 11.7 0 20.3 12 30 12 30s12-9.7 12-18.3C24 5.2 18.6 0 12 0zm0 16.4a4.6 4.6 0 1 1 0-9.2 4.6 4.6 0 0 1 0 9.2z"/></svg>`;

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function page(height, css, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}html,body{height:${height}px}${css}</style></head><body>${body}</body></html>`;
}

/** The opening card (and the closing one, with `closing`): the picture only, 1920 × 960. */
function card({ eyebrow, title, subtitle, left, right = "JBS Praxis", closing = false }) {
  const css = `
.brand{position:absolute;left:212px;top:104px;display:flex;align-items:center;gap:34px;font:700 39px Inter;letter-spacing:.025em}
.eyebrow{position:absolute;left:200px;top:292px;font:700 31px Inter;letter-spacing:.15em;color:${COLOUR.primary};text-transform:uppercase}
h1{position:absolute;left:200px;top:370px;font:700 140px/1 Inter;letter-spacing:0;white-space:nowrap}
.sub{position:absolute;left:200px;top:553px;font:400 41px Inter;letter-spacing:.03em;color:${COLOUR.soft}}
.rule{position:absolute;left:200px;top:662px;width:175px;height:10px;border-radius:5px;background:${COLOUR.rule}}
.foot{position:absolute;left:200px;right:200px;top:822px;display:flex;justify-content:space-between;font:400 30px Inter;letter-spacing:.02em;color:${COLOUR.muted}}
.foot b{color:${COLOUR.primary};font-weight:700}`;
  return page(SIZE.picture, css, `<div class="ground"></div>
<div class="brand">${PIN}MyCity App</div>
<div class="eyebrow">${esc(eyebrow)}</div>
<h1 data-closing="${closing}">${esc(title)}</h1>
<div class="sub">${esc(subtitle)}</div>
<div class="rule"></div>
<div class="foot"><span>${esc(left)}</span><span>Engineered by <b>${esc(right)}</b></span></div>`);
}

/** The ground a phone sits on, with its label on the left and the phone's body; the screen is cut out. */
function phoneGround({ eyebrow, title, subtitle }) {
  const s = PHONE.screen;
  const b = PHONE.body;
  const css = `
.label{position:absolute;left:150px;top:330px;width:820px}
.label .eyebrow{font:700 25px Inter;letter-spacing:.12em;color:${COLOUR.primary};text-transform:uppercase}
.label h2{margin-top:17px;font:700 62px/1.1 Inter;letter-spacing:-.005em}
.label p{margin-top:19px;font:400 28px Inter;letter-spacing:.02em;color:${COLOUR.soft}}
.body{position:absolute;left:${b.x}px;top:${b.y}px;width:${b.width}px;height:${b.height}px;border-radius:${b.radius}px;
  background:${COLOUR.bezel};box-shadow:0 0 0 2px #2c302e,0 30px 80px rgba(0,0,0,.45)}
.hole{position:absolute;left:${s.x}px;top:${s.y}px;width:${s.width}px;height:${s.height}px;border-radius:${s.radius}px;
  box-shadow:0 0 0 30px ${COLOUR.bezel};background:#fff}`;
  return page(SIZE.picture, css, `<div class="ground"></div>
<div class="label"><div class="eyebrow">${esc(eyebrow)}</div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div>
<div class="body"></div><div class="hole"></div>`);
}

/** The phone's rim, drawn over the filmed screen so its corners are rounded: transparent elsewhere. */
function phoneRim() {
  const s = PHONE.screen;
  const css = `.hole{position:absolute;left:${s.x}px;top:${s.y}px;width:${s.width}px;height:${s.height}px;border-radius:${s.radius}px;
  box-shadow:0 0 0 30px ${COLOUR.bezel}}`;
  return page(SIZE.picture, css, `<div class="hole"></div>`);
}

/** The caption bar: the chapter on the left, the line being spoken in the middle. 1920 × 120. */
function bar({ number, total, chapter, caption }) {
  const css = `
.bar{position:absolute;inset:0;background:${COLOUR.bar};border-top:2px solid ${COLOUR.barLine}}
.chapter{position:absolute;left:40px;top:28px}
.chapter .n{font:700 16px Inter;letter-spacing:.13em;color:${COLOUR.primary};text-transform:uppercase}
.chapter .t{margin-top:8px;font:700 19px Inter;color:${COLOUR.ink}}
.caption{position:absolute;left:0;right:0;top:63px;text-align:center;font:400 27px Inter;letter-spacing:.012em;color:#f2f4f3}`;
  return page(SIZE.bar, css, `<div class="bar"></div>
<div class="chapter"><div class="n">Chapter ${number} of ${total}</div><div class="t">${esc(chapter)}</div></div>
<div class="caption">${esc(caption)}</div>`);
}

module.exports = { ROOT, SIZE, DESKTOP, PHONE, COLOUR, card, phoneGround, phoneRim, bar, esc };
