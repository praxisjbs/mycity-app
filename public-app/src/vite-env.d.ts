/// <reference types="vite/client" />

/** The contract's page size (packages/contract/schemas/common.js), injected by vite.config.ts. */
declare const __CONTRACT_PAGE_SIZE__: number;

/** The delivery plan from docs/PROGRESS.md and MILESTONES.md, injected by vite.config.ts (deliveryPlan in @mycity/ui/vite; lib/plan.ts binds it). */
declare const __DELIVERY_PLAN__: import("@mycity/ui").DeliveryPlan;

interface ImportMetaEnv {
  /** "mock" runs the in-browser API (development and `build:demo`); "live" talks to /api/public/v1. */
  readonly VITE_API_MODE: "mock" | "live";
}
