#!/usr/bin/env node
"use strict";
/**
 * Gate 10: search reaches everything (MILESTONES A13 and §18.2; docs/guides/foundation.md
 * §6.7, CLAUDE.md). A screen, an action or a record nobody can find is one people stop
 * trusting the system with.
 *
 * Modules (check):
 *  1. A module with records (a controller AND a repo with content) has a
 *     `<module>.search.js` with content, or `// search:none <reason>` in its controller.
 *     The reason is required.
 *  2. Every provider loads (shared/search/registry.js): a module key that exists, a
 *     record type shared/route-map can open, and no type declared twice.
 *
 * Reach (reach): fails what ⌘K cannot find, unless it carries `// search:none <reason>`.
 *  3. Every screen in shared/route-map.js SCREENS is in the search screen catalogue
 *     (shared/search/screens.js) with the label the shell shows (app/src/shell/catalogue.ts),
 *     and the catalogue names no screen the route map lacks. A screen kept out writes
 *     `// search:none <module>.<tab> <reason>` in route-map.js.
 *  4. Every entity type in ENTITY_ROUTES is declared by a search provider, or its line
 *     (or the line above) carries the marker. A type with both is a stale marker. A
 *     marker that reads `not built yet (src/modules/<m>)` holds only while that module
 *     has no controller and repo: once it is built, it answers or gives a real reason.
 *  5. Every screen's New action (`useScreenAction({ label })` in app/src) has its label
 *     in the search action catalogue (shared/search/actions.js), or the call (its line or
 *     the line above) carries the marker. A label that is not written out is refused,
 *     because search cannot list it.
 *
 * Usage: node scripts/check/search-coverage.js [--list]     exit 0 ok, 1 on a gap
 */
const fs = require("node:fs");
const path = require("node:path");

process.env.MYCITY_SKIP_DOTENV = "1";
process.env.APP_ENV = process.env.APP_ENV || "test";
process.env.LOG_LEVEL = "silent";

const ROOT = path.resolve(__dirname, "..", "..");
const MODULES = path.join(ROOT, "src", "modules");
const OPT_OUT = /\/\/\s*search:none\b[ \t:,-]*(.*)$/m;

const filled = (file) =>
  fs.existsSync(file) && fs.readFileSync(file, "utf8").trim().length > 0;

/**
 * @param {{dir?: string}} [opts]
 */
function check({ dir = MODULES } = {}) {
  const out = {
    providers: [],
    optedOut: [],
    missing: [],
    unexplained: [],
    loadError: null,
    types: [],
  };
  if (!fs.existsSync(dir)) return out;
  for (const e of fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDirectory()) continue;
    const folder = path.join(dir, e.name);
    const files = fs.readdirSync(folder);
    const controllers = files
      .filter((f) => f.endsWith(".controller.js"))
      .map((f) => path.join(folder, f))
      .filter(filled);
    const repos = files
      .filter((f) => f.endsWith(".repo.js"))
      .map((f) => path.join(folder, f))
      .filter(filled);
    if (controllers.length === 0 || repos.length === 0) continue;
    if (
      files.some(
        (f) => f.endsWith(".search.js") && filled(path.join(folder, f)),
      )
    ) {
      out.providers.push(e.name);
      continue;
    }
    let opt = null;
    for (const c of controllers) {
      const m = fs.readFileSync(c, "utf8").match(OPT_OUT);
      if (m) {
        opt = (m[1] || "").trim();
        break;
      }
    }
    if (opt === null) out.missing.push(e.name);
    else if (opt.replace(/[^A-Za-z]/g, "").length < 8)
      out.unexplained.push(e.name);
    else out.optedOut.push({ module: e.name, reason: opt });
  }
  try {
    out.types = require(path.join(ROOT, "src", "shared", "search", "registry"))
      .load({ dir })
      .flatMap((p) => p.types || [p.type]);
  } catch (err) {
    out.loadError = err.message;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Reach: screens, entity types, New actions
 * ------------------------------------------------------------------ */

const MARK = /\/\/\s*search:none\b[ \t:,-]*(.*)$/;
const NOT_BUILT = /^not built yet \(src\/modules\/([a-z][a-z0-9_]*)\)/;
const reasoned = (reason) => reason.replace(/[^A-Za-z]/g, "").length >= 8;

/** The marker's reason on this line or the line above (a comment line), or null. */
function markerAt(lines, i) {
  for (const j of [i, i - 1]) {
    if (j < 0 || j >= lines.length) continue;
    if (j === i - 1 && !/^\s*\/\//.test(lines[j])) continue;
    const m = lines[j].match(MARK);
    if (m) return (m[1] || "").trim();
  }
  return null;
}

/** module key → tab slug → label, from the shell's catalogue (catalogue.ts). */
function shellLabels(text) {
  const out = {};
  const starts = [...text.matchAll(/\{\s*key:\s*"([a-z_]+)"/g)];
  starts.forEach((m, n) => {
    const end = n + 1 < starts.length ? starts[n + 1].index : text.length;
    const block = text.slice(m.index, end);
    out[m[1]] = {};
    for (const t of block.matchAll(/\bt\("([^"]+)",\s*"([^"]+)"\)/g)) out[m[1]][t[2]] = t[1];
  });
  return out;
}

/** The source of every useScreenAction(...) call in a file, with the line it starts on. */
function screenActionCalls(text) {
  const out = [];
  const re = /\buseScreenAction\s*\(/g;
  let m;
  while ((m = re.exec(text))) {
    let depth = 0;
    let end = m.index + m[0].length - 1;
    for (; end < text.length; end += 1) {
      if (text[end] === "(") depth += 1;
      else if (text[end] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push({
      line: text.slice(0, m.index).split("\n").length - 1,
      args: text.slice(m.index + m[0].length, end),
    });
  }
  return out;
}

function walkFiles(dir, want, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", "build", "coverage"].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, want, out);
    else if (want(full)) out.push(full);
  }
  return out;
}

/**
 * What ⌘K cannot reach.
 * @param {{root?: string, types?: string[]}} [opts]
 *   root   the repository (tests point it at a fixture)
 *   types  the record types the providers declare (check().types by default)
 */
function reach({ root = ROOT, types } = {}) {
  const rel = (f) => path.relative(root, f).split(path.sep).join("/");
  const out = { screens: [], types: [], actions: [], exempt: [], counts: { screens: 0, types: 0, actions: 0 } };
  const routeMapFile = path.join(root, "src", "shared", "route-map.js");
  const routeMap = require(routeMapFile);
  const routeLines = fs.readFileSync(routeMapFile, "utf8").split("\n");
  const { SCREENS: catalogue } = require(path.join(root, "src", "shared", "search", "screens.js"));
  const { ACTIONS } = require(path.join(root, "src", "shared", "search", "actions.js"));
  const shellFile = path.join(root, "app", "src", "shell", "catalogue.ts");
  const shell = fs.existsSync(shellFile) ? shellLabels(fs.readFileSync(shellFile, "utf8")) : null;
  const builtModule = (m) => {
    const folder = path.join(root, "src", "modules", m);
    return filled(path.join(folder, `${m}.controller.js`)) && filled(path.join(folder, `${m}.repo.js`));
  };

  /* 3. screens */
  const exemptScreens = new Map();
  routeLines.forEach((line) => {
    const m = line.match(/\/\/\s*search:none\s+([a-z_]+\.[a-z0-9-]+)\b[ \t:,-]*(.*)$/);
    if (m) exemptScreens.set(m[1], m[2].trim());
  });
  const listed = new Map(catalogue.map((x) => [`${x.module}.${x.tab}`, x]));
  for (const [module, tabs] of Object.entries(routeMap.SCREENS)) {
    for (const tab of tabs) {
      const id = `${module}.${tab}`;
      out.counts.screens += 1;
      const entry = listed.get(id);
      if (exemptScreens.has(id)) {
        if (!reasoned(exemptScreens.get(id))) out.screens.push(`${id}: search:none needs a reason`);
        else if (entry) out.screens.push(`${id}: is in the search catalogue and marked search:none; remove one`);
        else out.exempt.push({ what: `screen ${id}`, reason: exemptScreens.get(id) });
        continue;
      }
      if (!entry) {
        out.screens.push(`${id}: not in src/shared/search/screens.js; add s("${module}", "${tab}", "<label>", [words])`);
        continue;
      }
      const label = shell && shell[module] ? shell[module][tab] : undefined;
      if (shell && label !== undefined && label !== entry.label)
        out.screens.push(`${id}: search calls it "${entry.label}", the shell "${label}"`);
    }
  }
  for (const id of listed.keys()) {
    const [module, tab] = id.split(".");
    if (!(routeMap.SCREENS[module] || []).includes(tab))
      out.screens.push(`${id}: in src/shared/search/screens.js but not a screen in the route map`);
  }

  /* 4. entity types */
  const declared = new Set(types || []);
  const start = routeLines.findIndex((l) => /const ENTITY_ROUTES\b/.test(l));
  for (const type of Object.keys(routeMap.ENTITY_ROUTES)) {
    out.counts.types += 1;
    let at = -1;
    for (let i = Math.max(start, 0); i < routeLines.length; i += 1) {
      if (new RegExp(`^\\s{2}${type}:`).test(routeLines[i])) {
        at = i;
        break;
      }
    }
    const reason = at >= 0 ? markerAt(routeLines, at) : null;
    if (declared.has(type)) {
      if (reason !== null) out.types.push(`${type}: a provider declares it, so remove its search:none in route-map.js`);
      continue;
    }
    if (reason === null) {
      out.types.push(`${type}: no search provider declares it; add one, or mark its ENTITY_ROUTES line // search:none <reason>`);
      continue;
    }
    if (!reasoned(reason)) {
      out.types.push(`${type}: search:none needs a reason`);
      continue;
    }
    const later = reason.match(NOT_BUILT);
    if (later && builtModule(later[1])) {
      out.types.push(`${type}: src/modules/${later[1]} is built now; give it a provider, or a real reason`);
      continue;
    }
    out.exempt.push({ what: `type ${type}`, reason });
  }

  /* 5. New actions */
  const labels = new Set(ACTIONS.map((x) => x.label));
  const sources = walkFiles(path.join(root, "app", "src"), (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
  for (const file of sources) {
    if (rel(file) === "app/src/shell/screen-action.tsx") continue;
    const text = fs.readFileSync(file, "utf8");
    if (!text.includes("useScreenAction")) continue;
    const lines = text.split("\n");
    for (const call of screenActionCalls(text)) {
      if (/^\s*$/.test(call.args)) continue;
      out.counts.actions += 1;
      const where = `${rel(file)}:${call.line + 1}`;
      const reason = markerAt(lines, call.line);
      const found = [...call.args.matchAll(/\blabel:\s*(["'`])([^"'`$]+)\1/g)].map((m) => m[2]);
      if (reason !== null) {
        if (!reasoned(reason)) out.actions.push(`${where}: search:none needs a reason`);
        else out.exempt.push({ what: `action at ${where}`, reason });
        continue;
      }
      if (found.length === 0) {
        out.actions.push(`${where}: write the label out ("New Task") so search can list it, or mark it // search:none <reason>`);
        continue;
      }
      for (const label of found)
        if (!labels.has(label))
          out.actions.push(`${where}: "${label}" is not in src/shared/search/actions.js; add it, or mark the call // search:none <reason>`);
    }
  }
  return out;
}

if (require.main === module) {
  const r = check();
  const g = reach({ types: r.types });
  const gaps = g.screens.length + g.types.length + g.actions.length;
  if (process.argv.includes("--list")) {
    for (const m of r.providers) console.log(`  search  ${m}`);
    for (const o of r.optedOut)
      console.log(`  none    ${o.module}: ${o.reason}`);
    for (const m of r.missing) console.log(`  GAP     ${m}`);
    for (const e of g.exempt) console.log(`  none    ${e.what}: ${e.reason}`);
  }
  if (!r.missing.length && !r.unexplained.length && !r.loadError && gaps === 0) {
    console.log(
      `search-coverage: ok (${g.counts.screens} screens, ${g.counts.actions} New action(s), ${r.types.length} record types searchable; ` +
        `${r.optedOut.length} module(s) and ${g.exempt.length} type(s) or action(s) marked search:none with a reason)`,
    );
    process.exit(0);
  }
  for (const [what, list] of [
    ["screen(s) search cannot reach", g.screens],
    ["entity type(s) search cannot reach", g.types],
    ["New action(s) search cannot reach", g.actions],
  ]) {
    if (!list.length) continue;
    console.error(`search-coverage: ${list.length} ${what}:`);
    for (const p of list) console.error(`  - ${p}`);
  }
  if (r.missing.length) {
    console.error(
      `search-coverage: ${r.missing.length} module(s) with records and neither a provider nor an opt-out:`,
    );
    for (const m of r.missing) console.error(`  - src/modules/${m}`);
    console.error(
      "\nAdd src/modules/<m>/<m>.search.js (recordProvider, shared/search/provider.js),",
    );
    console.error(
      "or put `// search:none <reason>` at the top of the module's controller.",
    );
  }
  if (r.unexplained.length) {
    console.error(
      `search-coverage: ${r.unexplained.length} opt-out(s) without a reason:`,
    );
    for (const m of r.unexplained) console.error(`  - src/modules/${m}`);
  }
  if (r.loadError)
    console.error(`search-coverage: a provider does not load: ${r.loadError}`);
  process.exit(1);
}

module.exports = { check, reach, shellLabels, screenActionCalls };
