import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sharedVite } from "@mycity/ui/vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * The page size is the contract's, never the app's (FRONTEND_GUIDE §4). It is
 * read from packages/contract/schemas/common.js at build time and handed to the
 * code as __CONTRACT_PAGE_SIZE__, so there is one number in the repository.
 */
function contractPageSize(): number {
  const file = fileURLToPath(new URL("../packages/contract/schemas/common.js", import.meta.url));
  const match = /\bPAGE_SIZE\s*=\s*(\d+)/.exec(readFileSync(file, "utf8"));
  if (!match) throw new Error("vite.config: PAGE_SIZE not found in packages/contract/schemas/common.js");
  return Number(match[1]);
}

/**
 * Where the API is. `mock`: the in-browser mock (src/api/mock), for development
 * and `npm run build:demo`, until the backend modules land. `live`: the real API.
 * A production build is always live. Override with VITE_API_MODE=live npm run dev
 * to talk to the API on localhost:3000 through the proxy below. (Set here, not in
 * .env files: the repository ignores .env.* by rule.)
 */
function apiMode(mode: string): "mock" | "live" {
  const asked = process.env.VITE_API_MODE;
  if (asked === "mock" || asked === "live") return asked;
  return mode === "production" ? "live" : "mock";
}

/**
 * The delivery plan, read from the docs at build time so there is one source
 * (lib/plan.ts uses it for the milestone switch and production's Coming Soon):
 *
 *   docs/PROGRESS.md                  each screen's milestone (M column) and its
 *                                     API, UI and Mobile ticks: all three ticked = delivered
 *   docs/MyCity-ERP-Documents/MILESTONES.md   §4's table: each milestone's name and demo date
 *
 * Screens are keyed "<section>|<slug>": the PROGRESS heading ("Employee
 * Self-Service") and the backticked slug or path in the row.
 */
type Plan = {
  milestones: Array<{ key: string; n: number; name: string; demo: string | null }>;
  screens: Record<string, { m: string; delivered: boolean }>;
};
function deliveryPlan(): Plan {
  const doc = (p: string) => readFileSync(fileURLToPath(new URL(`../docs/${p}`, import.meta.url)), "utf8");
  const ms = doc("MyCity-ERP-Documents/MILESTONES.md");
  const year = Number((/\b(20\d\d)\b/.exec(ms) ?? [])[1]) || new Date().getFullYear();
  const MONTH: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
  const head = ms.indexOf("| M | Milestone |");
  if (head < 0) throw new Error("vite.config: the milestone table (| M | Milestone |) is missing from MILESTONES.md");
  const milestones: Plan["milestones"] = [];
  for (const line of ms.slice(head).split("\n").slice(2)) {
    if (!line.startsWith("|")) break;
    const c = line.split("|").map((x) => x.replace(/\*/g, "").trim());
    const n = Number(c[1]);
    const d = /(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.exec(c[5]);
    milestones.push({ key: `M${n}`, n, name: c[2], demo: d ? `${year}-${MONTH[d[2]]}-${d[1].padStart(2, "0")}` : null });
  }
  /* "with M1": a milestone demonstrated alongside another takes its date. */
  for (const m of milestones) if (!m.demo) m.demo = milestones.find((x) => x.n === m.n + 1)?.demo ?? null;
  const screens: Plan["screens"] = {};
  let section = "";
  for (const line of doc("PROGRESS.md").split("\n")) {
    if (line.startsWith("### ")) section = line.slice(4).split(" · ")[0].trim();
    const r = /^\|\s*\d+\s*\|[^|]*\|\s*`([^`]+)`\s*\|\s*(M\d+)\s*\|[^|]*\|\s*(\S+)\s*\|\s*(\S+)\s*\|\s*(\S+)\s*\|/.exec(line);
    if (r) screens[`${section}|${r[1]}`] = { m: r[2], delivered: [r[3], r[4], r[5]].every((t) => t === "☑") };
  }
  if (Object.keys(screens).length < 50) throw new Error("vite.config: could not read the screens from docs/PROGRESS.md");
  return { milestones, screens };
}

/*
 * The shared settings come first (packages/ui/vite.shared.js): @mycity/ui resolved
 * from the workspace with one React, @mycity/contract consumed as CommonJS with
 * ONE Zod instance. The app's own settings merge over them.
 */
export default defineConfig(({ mode }) =>
  mergeConfig(sharedVite(), {
    define: {
      __CONTRACT_PAGE_SIZE__: JSON.stringify(contractPageSize()),
      __DELIVERY_PLAN__: JSON.stringify(deliveryPlan()),
      "import.meta.env.VITE_API_MODE": JSON.stringify(apiMode(mode)),
    },
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
      port: 5173,
      proxy: { "/api": { target: "http://localhost:3000", changeOrigin: false } },
    },
    build: {
      target: "es2022",
      sourcemap: false,
      chunkSizeWarningLimit: 600,
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "prompt",
        injectRegister: false,
        includeAssets: ["favicon.svg", "apple-touch-icon.png"],
        manifest: {
          id: "/",
          name: "MyCity App",
          short_name: "MyCity",
          description: "MyCity App staff workspace",
          lang: "en-NG",
          start_url: "/",
          scope: "/",
          display: "standalone",
          orientation: "any",
          theme_color: "#01221D",
          background_color: "#01221D",
          icons: [
            { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
            { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
            { src: "pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [/^\/api\//],
          cleanupOutdatedCaches: true,
          // The API is never cached: every number on a screen is live (FRONTEND_GUIDE §8).
          runtimeCaching: [{ urlPattern: /^\/api\//, handler: "NetworkOnly" }],
        },
        devOptions: { enabled: false },
    }),
  ],
  }),
);
