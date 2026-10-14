#!/usr/bin/env node
"use strict";
/**
 * Gate 8, the five-second rule (FRONTEND_GUIDE §5, MILESTONES §3).
 *
 * A page carries what a person needs to act; support text is collapsed and
 * system explanations are not on a screen at all. This gate holds every screen
 * to the word limits in lib/copy.js (LIMITS), Title Case for chrome, no
 * explainer cards, help closed on load, no subtitle or chart caption on a
 * phone, and buttons only in a modal footer.
 *
 * RENDERED: every screen of demo.html (and the app once it has a build) is
 *   opened at phone and desktop size by lib/screens.js; the copy in each slot
 *   is checked as a person would see it.
 * STATIC: toast messages, which no crawl sees, in demo.html and in app/ and
 *   public-app/ source; and the copy props of the shared components in app/.
 *
 * Usage:
 *   node scripts/check/five-second.js                 exit 0 ok, 1 problems
 *   node scripts/check/five-second.js --screen=Home   only findings on screens starting "Home"
 */
const { LIMITS, wordCount, longestSentence, titleCaseViolation, explainerTitle, bannedButton } = require("./lib/copy");
const { crawl, finish, run } = require("./lib/screens");
const { readDemo, scan, frontendFiles, read, lineOf } = require("./lib/sources");

const over = (text, limit, what) => {
  const n = wordCount(text);
  return n > limit ? `${what} "${text}" is ${n} words (limit ${limit})` : null;
};

function checkSlot(s, width, kind) {
  const out = [];
  const add = (m) => m && out.push(m);
  const tc = (what) => {
    const w = titleCaseViolation(s.text);
    if (w) out.push(`${what} "${s.text}" is not Title Case ("${w}")`);
  };
  switch (s.slot) {
    case "pageTitle":
      if (!s.visible) break;
      add(over(s.text, LIMITS.pageTitle, "Page title"));
      tc("Page title");
      break;
    case "pageSubtitle":
      if (!s.visible) break;
      if (width === "phone") out.push(`Page subtitle "${s.text}" shows on a phone (desktop only)`);
      else add(over(s.text, LIMITS.pageSubtitle, "Page subtitle"));
      break;
    case "title": {
      if (!s.visible) break;
      add(over(s.text, LIMITS.title, "Title"));
      const why = explainerTitle(s.text);
      if (why) out.push(`Title "${s.text}" ${why}: an explainer card is tier 3, not a screen (§5.1)`);
      tc("Title");
      break;
    }
    case "kpiCaption":
      if (s.visible) add(over(s.text, LIMITS.kpiCaption, "KPI caption"));
      break;
    case "button":
      if (!s.visible) break;
      add(over(s.text, LIMITS.button, "Button"));
      if (bannedButton(s.text)) out.push(`Button "${s.text}" says nothing; use Verb Noun (§5.4)`);
      tc("Button");
      break;
    case "header":
      if (s.visible) tc("Column header");
      break;
    case "nav":
      tc("Navigation label");
      break;
    case "chartCaption":
      if (!s.visible) break;
      if (width === "phone") out.push(`Chart caption "${s.text}" shows on a phone (desktop only)`);
      else add(over(s.text, LIMITS.chartCaption, "Chart caption"));
      break;
    case "emptyText":
      if (s.visible) add(over(s.text, LIMITS.emptyText, "Empty state line"));
      break;
    case "help":
      if (s.visible && kind === "screen") out.push(`Help "${s.text.slice(0, 50)}…" is open on load (closed by default, §5.2)`);
      add(over(s.text, LIMITS.help, "Help text"));
      break;
    case "details":
      if (s.visible && kind === "screen") out.push(`Details "${s.text.slice(0, 50)}…" is open on load (closed by default, §5.2)`);
      add(over(s.text, LIMITS.details, "Details row"));
      break;
    case "modalFooter":
      out.push(`Modal footer carries text "${s.text}" (buttons only, §5.1, §8.4)`);
      break;
    case "prose": {
      if (!s.visible) break;
      const n = longestSentence(s.text);
      if (n > LIMITS.sentence) out.push(`Sentence of ${n} words (limit ${LIMITS.sentence}): "${s.text.slice(0, 90)}${s.text.length > 90 ? "…" : ""}"`);
      break;
    }
    default:
      break;
  }
  return out;
}

/** Toasts and the shared components' copy props, read from source. */
function staticFindings() {
  const findings = [];
  const push = (file, line, message) => findings.push({ width: "source", screen: `${file}:${line}`, message });

  const demo = readDemo();
  if (demo) {
    for (const s of demo.scripts) {
      const { code } = scan(s.code);
      const re = /\btoast\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
      for (let m = re.exec(code); m; m = re.exec(code)) {
        const msg = over(m[2], LIMITS.toast, "Toast");
        if (msg) push(demo.file, lineOf(demo.html, s.offset + m.index), msg);
      }
    }
  }

  const props = [
    [/<PageHeader\b[^>]*\btitle="([^"]*)"/g, LIMITS.pageTitle, "Page title"],
    [/<PageHeader\b[^>]*\bsubtitle="([^"]*)"/g, LIMITS.pageSubtitle, "Page subtitle"],
    [/<(?:Card|Section|KpiCard|Modal|Sheet)\b[^>]*\btitle="([^"]*)"/g, LIMITS.title, "Title"],
    [/<HelpTerm\b[^>]*\btext="([^"]*)"/g, LIMITS.help, "Help text"],
    [/<EmptyState\b[^>]*\btext="([^"]*)"/g, LIMITS.emptyText, "Empty state line"],
    [/\btoast(?:\.\w+)?\(\s*["'`]([^"'`]*)["'`]/g, LIMITS.toast, "Toast"],
  ];
  for (const file of frontendFiles()) {
    const src = scan(read(file)).code;
    for (const [re, limit, what] of props) {
      re.lastIndex = 0;
      for (let m = re.exec(src); m; m = re.exec(src)) {
        const msg = over(m[1], limit, what);
        if (msg) push(file, lineOf(src, m.index), msg);
        if (what === "Title") {
          const why = explainerTitle(m[1]);
          if (why) push(file, lineOf(src, m.index), `Title "${m[1]}" ${why}: tier 3, not a screen (§5.1)`);
        }
      }
    }
  }
  return findings;
}

run("five-second", async () => {
  const result = await crawl();
  const findings = [];
  for (const sc of result.screens) {
    for (const s of sc.slots) {
      for (const message of checkSlot(s, sc.width, sc.kind)) findings.push({ width: sc.width, screen: sc.screen, message });
    }
  }
  findings.push(...staticFindings());
  finish("five-second", findings, result);
});
