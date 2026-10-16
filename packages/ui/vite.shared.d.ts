import type { UserConfig } from "vite";

/** The repository root's Zod, by the file its `import` condition names. */
export declare function zodEntry(): string;

/** The partial Vite config both apps merge under their own (see vite.shared.js). */
export declare function sharedVite(): UserConfig;

/** The contract's page size, from packages/contract/schemas/common.js. */
export declare function contractPageSize(): number;

/** "mock" or "live", from VITE_API_MODE or the Vite mode (production is always live). */
export declare function apiMode(mode: string): "mock" | "live";

/** The delivery plan from docs/PROGRESS.md and MILESTONES §4 (lib/plan.ts reads it as __DELIVERY_PLAN__). */
export declare function deliveryPlan(): {
  milestones: Array<{ key: string; n: number; name: string; demo: string | null }>;
  screens: Record<string, { m: string; api: boolean; delivered: boolean }>;
};
