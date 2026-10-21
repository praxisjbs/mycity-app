import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { apiMode, contractPageSize, deliveryPlan, sharedVite } from "@mycity/ui/vite";
import { VitePWA } from "vite-plugin-pwa";
import { MODULES } from "./src/shell/catalogue";
import { hrefFor } from "./src/lib/routes";

/**
 * The route list the screen gates read (FRONTEND_GUIDE §9.2): every module and
 * tab in the catalogue, written into the build as screens.json, so
 * scripts/check/lib/screens.js opens each screen at phone and desktop size
 * (gates 8 and 11) without importing the app's TypeScript.
 */
function screenList(): Plugin {
  let mode = "live";
  return {
    name: "mycity-screen-list",
    apply: "build",
    configResolved(c) {
      mode = apiMode(c.mode);
    },
    generateBundle() {
      const screens = MODULES.flatMap((m) =>
        m.tabs.map((t) => ({ module: m.key, module_label: m.label, tab: t.slug, tab_label: t.label, path: hrefFor(m.key, t.slug) })),
      );
      this.emitFile({ type: "asset", fileName: "screens.json", source: `${JSON.stringify({ api_mode: mode, screens }, null, 2)}\n` });
    },
  };
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
      // The socket rides the same origin on a server; on a laptop against the live API it needs the proxy too.
      proxy: {
        "/api": { target: "http://localhost:3000", changeOrigin: false },
        "/socket.io": { target: "http://localhost:3000", changeOrigin: false, ws: true },
      },
    },
    build: {
      target: "es2022",
      sourcemap: false,
      chunkSizeWarningLimit: 600,
    },
    plugins: [
      react(),
      tailwindcss(),
      screenList(),
      VitePWA({
        // Our own service worker (src/sw.ts): the precache and offline rules below, and web push.
        strategies: "injectManifest",
        srcDir: "src",
        filename: "sw.ts",
        registerType: "prompt",
        injectRegister: false,
        includeAssets: ["favicon.svg", "apple-touch-icon.png", "badge-96.png"],
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
        // What the worker precaches. The navigation fallback (never /api/ or /gallery, F10) and
        // the API left to the network (FRONTEND_GUIDE §8) are in src/sw.ts.
        injectManifest: {
          globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
          // PDF.js's fonts, maps and decoders are fetched only by a PDF that needs them, never precached.
          globIgnores: ["pdfjs/**"],
          rollupFormat: "iife",
        },
        devOptions: { enabled: false },
    }),
  ],
  }),
);
