/// <reference types="vite/client" />

/** The contract's page size (packages/contract/schemas/common.js), injected by vite.config.ts. */
declare const __CONTRACT_PAGE_SIZE__: number;

/** The delivery plan from docs/PROGRESS.md and MILESTONES.md, injected by vite.config.ts (lib/plan.ts). */
declare const __DELIVERY_PLAN__: {
  milestones: Array<{ key: string; n: number; name: string; demo: string | null }>;
  screens: Record<string, { m: string; delivered: boolean }>;
};

interface ImportMetaEnv {
  /** "mock" runs the in-browser API (development and `build:demo`); "live" talks to /api. */
  readonly VITE_API_MODE: "mock" | "live";
}
