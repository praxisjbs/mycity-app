#!/usr/bin/env node
"use strict";
/**
 * Gate 11, two shells (FRONTEND_GUIDE §7, MILESTONES §3).
 *
 * Mobile is a native-feeling app and desktop is desktop software; a layout
 * scaled from one to the other fails. lib/screens.js opens every screen (the
 * gallery's component pages, demo.html when touched, the app once built) at
 * phone (390 × 844, touch) and desktop (1440 × 900) size; this gate refuses
 * (the gallery is not an app, so it skips the navigation and first-screen
 * rules, and adds: a state wider than its phone frame):
 *
 *   both     sideways scrolling of the page; a script error or a native dialog
 *   phone    the desktop sidebar; no bottom bar; a visible table (lists are
 *            cards on a phone); a tap target under 44 × 44 px; more than
 *            LIMITS.phoneFirstScreen words of interface copy on the first screen;
 *            a tapped row whose record opens in the page with its list
 *            instead of a sheet (F31: ListDetail, DetailPane)
 *   desktop  the phone bottom bar; no sidebar
 *
 * Modals are checked by gate 8 for copy; their layout is the shared modal's.
 *
 * Usage:
 *   node scripts/check/two-shells.js                  exit 0 ok, 1 problems
 *   node scripts/check/two-shells.js --screen=People  only findings on screens starting "People"
 */
const { LIMITS } = require("./lib/copy");

function checkScreen(sc) {
  const out = [];
  const l = sc.layout;
  if (sc.kind === "modal") return out;
  // A gallery page is not an app: no navigation and no first screen to judge (lib/screens.js).
  const checks = sc.checks || { navigation: true, firstScreen: true };
  if (l.docScrollWidth > l.innerWidth + 1 || l.scrollerScrollWidth > l.scrollerClientWidth + 1) {
    out.push(`The page scrolls sideways (${Math.max(l.docScrollWidth, l.scrollerScrollWidth)} px of content in ${l.innerWidth} px)`);
  }
  if (sc.width === "phone") {
    if (checks.navigation && l.desktopNav) out.push("The desktop sidebar shows on a phone (bottom bar only)");
    if (checks.navigation && !l.phoneNav) out.push("No bottom bar on a phone");
    if (l.tables) out.push(`${l.tables} table(s) visible on a phone (a list is a card list, §7)`);
    for (const t of l.taps) out.push(`Tap target "${t.label}" is ${t.w} × ${t.h} px (at least 44 × 44)`);
    for (const f of l.frameOverflow || []) {
      out.push(`State "${f.state}" (${f.frame}) is ${f.scrollWidth} px wide in a ${f.clientWidth} px phone frame: it scrolls sideways (§7)`);
    }
    if (checks.firstScreen && sc.firstScreenWords > LIMITS.phoneFirstScreen) {
      out.push(`First phone screen carries ${sc.firstScreenWords} words of interface copy (limit ${LIMITS.phoneFirstScreen}): ${sc.firstScreenText.slice(0, 160)}…`);
    }
    for (const r of sc.rowOpens || []) {
      if (r.outcome === "page") out.push(`Tapping "${r.label}" puts its record in the page with the list; on a phone a record opens in a sheet (F31: ListDetail, DetailPane)`);
    }
  } else if (checks.navigation) {
    if (l.phoneNav) out.push("The phone bottom bar shows on desktop");
    if (!l.desktopNav) out.push("No sidebar on desktop");
  }
  return out;
}

function main() {
  const { crawl, finish, run } = require("./lib/screens");
  run("two-shells", async () => {
    const result = await crawl();
    const findings = [];
    for (const sc of result.screens) {
      for (const message of checkScreen(sc)) findings.push({ width: sc.width, screen: sc.screen, message });
    }
    for (const e of result.errors) findings.push({ width: e.width, screen: e.screen, message: `Script error: ${e.message}` });
    finish("two-shells", findings, result);
  });
}

module.exports = { checkScreen };

if (require.main === module) main();
