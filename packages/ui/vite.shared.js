/**
 * The Vite settings both apps (and the gallery) share, so the two builds cannot
 * drift (FRONTEND_FOUNDATION F1, F15). Merge it into an app's config:
 *
 *   import { sharedVite } from "@mycity/ui/vite";
 *   export default defineConfig((env) => mergeConfig(sharedVite(), { ...the app's own }));
 *
 * Three things, each a known way for a workspace build to break quietly:
 *
 * 1. @mycity/contract is CommonJS source (the API require()s it with no build
 *    step). Vite applies CommonJS interop only to `build.commonjsOptions.include`,
 *    which defaults to node_modules and replaces rather than extends, so the
 *    contract is added beside node_modules. In dev, a linked package is served as
 *    source, raw `require()` and all, unless it is pre-bundled: its schema files
 *    are named in `optimizeDeps.include` (never its index.js, which reads the
 *    schema folder from disk and cannot run in a browser).
 *
 * 2. ONE Zod instance. Zod's exports map gives `import` an ESM file and
 *    `require` a CJS file, so a screen's `import "zod"` (through the form
 *    system) and the contract's `require("zod")` would be two modules, and a
 *    contract schema would fail `instanceof z.ZodType`. Aliasing `zod` to the
 *    root install's ESM entry FILE makes both sides the same module, and it is
 *    the copy the API runs with. `zod` is pre-bundled alongside the contract for
 *    the same reason in dev.
 *
 * 3. ONE React. `dedupe` keeps the package's and the apps' React the same copy,
 *    so hooks in @mycity/ui never see a second React.
 *
 * And three readers both apps' configs call, so neither keeps a copy:
 * contractPageSize() (FRONTEND_GUIDE §4), apiMode() (§9.5) and deliveryPlan()
 * (F14, lib/plan.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The repository root's Zod, by the file its `import` condition names. */
export function zodEntry() {
  const dir = path.join(ROOT, "node_modules", "zod");
  const pkgFile = path.join(dir, "package.json");
  if (!fs.existsSync(pkgFile)) {
    throw new Error("vite: no Zod in the root node_modules. Run `npm install` at the repository root (zod is the contract's peer, installed once).");
  }
  const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
  const dot = pkg.exports && pkg.exports["."];
  const entry = (dot && typeof dot === "object" && dot.import) || pkg.module || pkg.main;
  return path.join(dir, entry);
}

/** The partial config both apps merge under their own. */
export function sharedVite() {
  return {
    resolve: {
      // Exactly "zod": its subpaths ("zod/v4/core") resolve as published, because the
      // form resolver reads them to tell Zod builds apart. Our own source may not
      // import a subpath at all (eslint.shared.js refuses "zod/*"), so a screen
      // cannot load a second Zod by that door.
      alias: [{ find: /^zod$/, replacement: zodEntry() }],
      dedupe: ["react", "react-dom"],
    },
    optimizeDeps: {
      include: ["zod", "@mycity/contract/schemas/*.js"],
    },
    build: {
      commonjsOptions: { include: [/node_modules/, /packages[\\/]contract[\\/]/] },
    },
  };
}

const doc = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/**
 * The page size is the contract's, never an app's (FRONTEND_GUIDE §4): read from
 * packages/contract/schemas/common.js at build time and handed to the code as
 * __CONTRACT_PAGE_SIZE__, so there is one number in the repository.
 */
export function contractPageSize() {
  const match = /\bPAGE_SIZE\s*=\s*(\d+)/.exec(doc("packages/contract/schemas/common.js"));
  if (!match) throw new Error("vite: PAGE_SIZE not found in packages/contract/schemas/common.js");
  return Number(match[1]);
}

/**
 * Where the API is (FRONTEND_GUIDE §9.5). `mock`: the in-browser mock, for
 * `npm run dev` and `npm run build:demo` (laptops and CI only, F12). `live`: the
 * real API; a production build is always live. VITE_API_MODE overrides it
 * (`VITE_API_MODE=live npm run dev` talks to the API on localhost:3000).
 */
export function apiMode(mode) {
  const asked = process.env.VITE_API_MODE;
  if (asked === "mock" || asked === "live") return asked;
  return mode === "production" ? "live" : "mock";
}

const MONTH = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

/**
 * The delivery plan, read from the docs at build time so there is one source
 * (lib/plan.ts in @mycity/ui decides what opens from it, F14):
 *
 *   docs/PROGRESS.md                          each screen's milestone (M column) and its API, UI
 *                                             and Mobile ticks: API = staging opens it, all three =
 *                                             production opens it
 *   docs/MyCity-ERP-Documents/MILESTONES.md   §4's table: each milestone's name and demo date
 *
 * Screens are keyed "<section>|<slug>": the PROGRESS heading ("Employee
 * Self-Service", "Public site") and the backticked slug or path in the row. A
 * build fails when the plan cannot be read.
 */
export function deliveryPlan() {
  const ms = doc("docs/MyCity-ERP-Documents/MILESTONES.md");
  const year = Number((/\b(20\d\d)\b/.exec(ms) ?? [])[1]) || new Date().getFullYear();
  const head = ms.indexOf("| M | Milestone |");
  if (head < 0) throw new Error("vite: the milestone table (| M | Milestone |) is missing from MILESTONES.md");
  const milestones = [];
  for (const line of ms.slice(head).split("\n").slice(2)) {
    if (!line.startsWith("|")) break;
    const c = line.split("|").map((x) => x.replace(/\*/g, "").trim());
    const n = Number(c[1]);
    const d = /(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.exec(c[5]);
    milestones.push({ key: `M${n}`, n, name: c[2], demo: d ? `${year}-${MONTH[d[2]]}-${d[1].padStart(2, "0")}` : null });
  }
  /* "with M1": a milestone demonstrated alongside another takes its date. */
  for (const m of milestones) if (!m.demo) m.demo = milestones.find((x) => x.n === m.n + 1)?.demo ?? null;
  const screens = {};
  let section = "";
  for (const line of doc("docs/PROGRESS.md").split("\n")) {
    if (line.startsWith("### ")) section = line.slice(4).split(" · ")[0].trim();
    const r = /^\|\s*\d+\s*\|[^|]*\|\s*`([^`]+)`\s*\|\s*(M\d+)\s*\|[^|]*\|\s*(\S+)\s*\|\s*(\S+)\s*\|\s*(\S+)\s*\|/.exec(line);
    if (r) screens[`${section}|${r[1]}`] = { m: r[2], api: r[3] === "☑", delivered: [r[3], r[4], r[5]].every((t) => t === "☑") };
  }
  if (Object.keys(screens).length < 50) throw new Error("vite: could not read the screens from docs/PROGRESS.md");
  return { milestones, screens };
}
