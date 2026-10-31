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
 * 4. PDF.js's own files (PdfViewer): its standard fonts, character maps, colour
 *    profiles and decoders, served at /pdfjs/ in dev and copied there in a build
 *    (pdfjsAssets), because the security policy lets it fetch from nowhere else.
 *
 * And three readers both apps' configs call, so neither keeps a copy:
 * contractPageSize() (FRONTEND_GUIDE §4), apiMode() (§9.5) and deliveryPlan()
 * (F14, lib/plan.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
/** The contract is CommonJS, as the API require()s it. */
const contractPlan = createRequire(import.meta.url)("../contract/plan.js");

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

const PDFJS_DIR = path.join(ROOT, "node_modules", "pdfjs-dist");
const PDFJS_FOLDERS = ["standard_fonts", "cmaps", "wasm", "iccs"];
const PDFJS_TYPES = { ".wasm": "application/wasm", ".js": "text/javascript", ".mjs": "text/javascript" };

/**
 * PDF.js's files at <base>pdfjs/<folder>/<file>, from the installed pdfjs-dist: served by
 * the dev server, written into the build. A PDF fetches only the ones it needs, from our
 * own origin, when it is opened (PdfViewer.draw.tsx reads them from BASE_URL + "pdfjs/").
 */
export function pdfjsAssets() {
  const fileOf = (rel) => {
    const [folder, ...rest] = rel.split("/");
    if (!PDFJS_FOLDERS.includes(folder) || rest.length !== 1 || !/^[\w.-]+$/.test(rest[0])) return null;
    const file = path.join(PDFJS_DIR, folder, rest[0]);
    return fs.existsSync(file) ? file : null;
  };
  return {
    name: "mycity-pdfjs-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^(?:.*\/)?pdfjs\/(.+)$/.exec(decodeURIComponent((req.url || "").split("?")[0]));
        const file = m && fileOf(m[1]);
        if (!file) return next();
        res.setHeader("Content-Type", PDFJS_TYPES[path.extname(file)] || "application/octet-stream");
        fs.createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const folder of PDFJS_FOLDERS) {
        const dir = path.join(PDFJS_DIR, folder);
        if (!fs.existsSync(dir)) throw new Error(`vite: ${dir} is missing; run npm ci at the repository root`);
        for (const name of fs.readdirSync(dir)) {
          this.emitFile({ type: "asset", fileName: `pdfjs/${folder}/${name}`, source: fs.readFileSync(path.join(dir, name)) });
        }
      }
    },
  };
}

/** The partial config both apps merge under their own. */
export function sharedVite() {
  return {
    plugins: [pdfjsAssets()],
    resolve: {
      // Exactly "zod": its subpaths ("zod/v4/core") resolve as published, because the
      // form resolver reads them to tell Zod builds apart. Our own source may not
      // import a subpath at all (eslint.shared.js refuses "zod/*"), so a screen
      // cannot load a second Zod by that door.
      alias: [{ find: /^zod$/, replacement: zodEntry() }],
      dedupe: ["react", "react-dom"],
    },
    optimizeDeps: {
      include: ["zod", "@mycity/contract/schemas/*.js", "@mycity/contract/plan.js"],
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

/**
 * The delivery plan, read from the docs at build time so there is one source: each screen's
 * milestone and ticks from docs/PROGRESS.md, each milestone's name and demo date from
 * MILESTONES §4 (@mycity/contract/plan readPlan, the reader the API's fallback uses too).
 * lib/plan.ts in @mycity/ui decides what opens from it (F14). A build fails when the plan
 * cannot be read.
 */
export function deliveryPlan() {
  return contractPlan.readPlan(doc);
}
