import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/** Component tests: jsdom, Testing Library, jest-dom matchers and an axe matcher (src/testing/setup.ts). */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/testing/setup.ts"],
    css: false,
    restoreMocks: true,
  },
});
