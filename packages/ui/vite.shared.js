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
