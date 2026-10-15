import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sharedVite } from "../vite.shared.js";

/**
 * The component gallery (FRONTEND_FOUNDATION F10): every *.gallery.tsx in
 * packages/ui/src, each state in a labelled frame, light and dark, compact and
 * comfortable. `npm run gallery` serves it; `npm -w @mycity/ui run build` writes
 * packages/ui/dist-gallery, which staging serves under /gallery (never production).
 * Relative asset paths, so it works under any base path.
 */
export default defineConfig(
  mergeConfig(sharedVite(), {
    root: fileURLToPath(new URL(".", import.meta.url)),
    base: "./",
    plugins: [react(), tailwindcss()],
    server: { port: 5175 },
    build: {
      outDir: fileURLToPath(new URL("../dist-gallery", import.meta.url)),
      emptyOutDir: true,
      target: "es2022",
      sourcemap: false,
    },
  }),
);
