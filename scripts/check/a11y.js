#!/usr/bin/env node
"use strict";
/* global window */
/**
 * Accessibility on the gallery (FRONTEND_FOUNDATION F7, F10; MILESTONES §3).
 *
 * Every shared component is accessible in every state before a screen uses it,
 * so a screen built from them starts accessible. This gate opens every
 * component page of the gallery (lib/gallery.js builds and serves it) in
 * Chromium at 390 px (phone, touch) and 1440 px (desktop), in both densities
 * (compact and comfortable), and runs axe-core with every rule on, colour
 * contrast included (real layout and real colours here, unlike the jsdom
 * component tests), over each state's frame and over whatever a state renders
 * in a portal (an open overlay). Each state is drawn in a light and a dark
 * frame, so both themes are covered. ANY violation fails, whatever its impact.
 *
 * A finding names the rule, the component page, the state, the element and
 * axe's own fix line; the same violation seen at several sizes or densities
 * is reported once with each place it was seen.
 *
 * Results are cached in the OS temp folder, keyed by the gallery's input hash
 * and this file, so an unchanged gallery is not checked twice.
 *
 * Usage:
 *   node scripts/check/a11y.js                     exit 0 ok, 1 problems
 *   node scripts/check/a11y.js --component=Button  only that page (repeatable)
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const gallery = require("./lib/gallery");
const { WIDTHS } = require("./lib/screens");

const ROOT = path.resolve(__dirname, "..", "..");
const DENSITIES = ["compact", "comfortable"];
/** The key the gallery keeps its density under (packages/ui/gallery/main.tsx). */
const DENSITY_KEY = "mc-gallery-density";
const only = process.argv
  .slice(2)
  .filter((a) => a.startsWith("--component="))
  .map((a) => a.slice(12));

function axeSource() {
  const pkg = require.resolve("axe-core/package.json", { paths: [path.join(ROOT, "packages", "ui"), ROOT] });
  return fs.readFileSync(path.join(path.dirname(pkg), "axe.min.js"), "utf8");
}

async function launch() {
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch (err) {
    throw new Error("Playwright is not installed. Run `npm ci`.", { cause: err });
  }
  try {
    return await chromium.launch({ executablePath: process.env.MYCITY_CHROMIUM || undefined });
  } catch (err) {
    throw new Error(`Chromium did not start (${String(err.message).split("\n")[0]}). Run \`npx playwright install chromium\` once.`, { cause: err });
  }
}

/**
 * In the page: run axe over each state's frame on its own (the gallery's own
 * headings around a state are not the component's; a PageHeader's h1 between
 * two state headings is not a heading-order fault), and once over anything
 * the states rendered outside the gallery root (an open Modal, Popover or
 * toast lives in a portal on <body>). Returns the violations, each node
 * labelled with its state and frame.
 */
async function runAxe(page) {
  return page.evaluate(async () => {
    const doc = window.document;
    const label = (frame) => {
      const s = frame.closest("section[aria-labelledby]");
      const h = s && doc.getElementById(s.getAttribute("aria-labelledby"));
      return [h ? h.textContent.trim() : "", frame.getAttribute("data-gallery-frame") || ""].filter(Boolean).join(", ");
    };
    const shape = (violations, where) =>
      violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.map((n) => ({
          target: n.target.join(" "),
          state: where,
          summary: String(n.failureSummary || "").split("\n").filter(Boolean).slice(0, 3).join(" "),
        })),
      }));
    const out = [];
    for (const frame of doc.querySelectorAll("[data-gallery-frame]")) {
      const r = await window.axe.run(frame, { resultTypes: ["violations"] });
      out.push(...shape(r.violations, label(frame)));
    }
    const portals = [...doc.body.children].filter((el) => el.id !== "root" && !["SCRIPT", "STYLE", "LINK"].includes(el.tagName));
    if (portals.length) {
      const r = await window.axe.run({ include: portals }, { resultTypes: ["violations"] });
      out.push(...shape(r.violations, "rendered outside the frame (portal)"));
    }
    return out;
  });
}

async function checkCombo(browser, url, names, width, density, axe) {
  const ctx = await browser.newContext(WIDTHS[width]);
  await ctx.addInitScript(
    ([key, value]) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* the gallery then shows its default density, compact */
      }
    },
    [DENSITY_KEY, density],
  );
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const found = [];
  for (const name of names) {
    try {
      await gallery.openComponent(page, url, name);
      await page.addScriptTag({ content: axe });
      for (const v of await runAxe(page)) found.push({ ...v, component: name, width, density });
    } catch (err) {
      found.push({ id: "page-did-not-render", impact: "critical", help: String(err.message).split("\n")[0], nodes: [], component: name, width, density });
    }
  }
  await ctx.close();
  return found;
}

/** Pure: one line per (rule, component, element), listing every size and density it was seen at. */
function merge(violations) {
  const map = new Map();
  for (const v of violations) {
    const nodes = v.nodes.length ? v.nodes : [{ target: "", state: "", summary: "" }];
    for (const n of nodes) {
      const key = `${v.id}|${v.component}|${n.state}|${n.target}`;
      if (!map.has(key)) map.set(key, { id: v.id, impact: v.impact, help: v.help, component: v.component, state: n.state, target: n.target, summary: n.summary, seen: [] });
      map.get(key).seen.push(`${v.width} ${v.density}`);
    }
  }
  return [...map.values()].sort((a, b) => a.component.localeCompare(b.component) || a.id.localeCompare(b.id));
}

async function main() {
  const built = gallery.ensureGallery();
  const key = crypto.createHash("sha1").update(built.hash).update(fs.readFileSync(__filename)).update(only.join(",")).digest("hex").slice(0, 16);
  const cacheFile = path.join(os.tmpdir(), `mycity-a11y-${key}.json`);
  let result = null;
  if (fs.existsSync(cacheFile)) {
    try {
      result = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    } catch {
      result = null;
    }
  }
  if (!result) {
    const server = await gallery.serve(built.dir);
    const browser = await launch();
    try {
      const probe = await browser.newPage({ viewport: WIDTHS.desktop.viewport });
      let names = await gallery.componentNames(probe, server.url);
      await probe.close();
      if (only.length) names = names.filter((n) => only.includes(n));
      if (!names.length) throw new Error(only.length ? `no gallery page named ${only.join(", ")}` : "the gallery lists no component pages");
      const axe = axeSource();
      const combos = [];
      for (const width of Object.keys(WIDTHS)) for (const density of DENSITIES) combos.push(checkCombo(browser, server.url, names, width, density, axe));
      const violations = (await Promise.all(combos)).flat();
      result = { components: names.length, views: names.length * combos.length, violations };
    } finally {
      await browser.close();
      await server.close();
    }
    fs.writeFileSync(cacheFile, JSON.stringify(result));
  }

  const lines = merge(result.violations);
  const scope = `${result.components} component page(s), ${result.views} views (390 and 1440 px, compact and comfortable, light and dark frames)`;
  if (lines.length) {
    console.error(`a11y: ${lines.length} violation(s) in ${scope}\n`);
    for (const l of lines) {
      console.error(`  ${l.component}${l.state ? ` › ${l.state}` : ""}: ${l.id} (${l.impact || "n/a"}): ${l.help}`);
      if (l.target) console.error(`      element  ${l.target}`);
      if (l.summary) console.error(`      fix      ${l.summary}`);
      console.error(`      seen at  ${l.seen.join("; ")}`);
    }
    console.error(
      "\nFix it in the component (packages/ui/src), never by turning a rule off. Each component's test runs axe too\n" +
        "(expect(await axe(container)).toHaveNoViolations()). Open the page: npm run gallery. Rules: FRONTEND_FOUNDATION F7.",
    );
    process.exit(1);
  }
  console.log(`a11y: ok (${scope})`);
}

module.exports = { merge };

if (require.main === module) {
  main().catch((err) => {
    console.error(`a11y: could not run\n  ${err.message}`);
    process.exit(1);
  });
}
