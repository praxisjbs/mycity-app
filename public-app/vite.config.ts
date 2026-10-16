import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { apiMode, contractPageSize, deliveryPlan, sharedVite } from "@mycity/ui/vite";

/**
 * The public site (go.mycityapp.io, A9). A separate build from the staff app:
 * it imports nothing from app/, holds no session, and has no PWA and no
 * service worker (SYSTEM_ARCHITECTURE §3).
 */

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
      port: 5174,
      proxy: { "/api/public": { target: "http://localhost:3000", changeOrigin: false } },
    },
    build: {
      target: "es2022",
      sourcemap: false,
    },
    plugins: [react(), tailwindcss()],
  }),
);
