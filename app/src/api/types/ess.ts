import type { PersonRef, Tone, Uuid } from "./common";

/** INTERIM Employee Self-Service shapes (owner AJ; docs/guides/ess.md). Scope is always own. My Queries is on the contract (schemas/queries.js, sanctions.js). */
type Pill = { tone: Tone; text: string };

export interface MyPerformance {
  period: string;
  set_by: string;
  stats: Array<{ label: string; value: string; tone?: Tone }>;
  kpis: Array<{ label: string; pct: number; value: string; emphasis?: "warn" | "brand" }>;
  chain: Array<{ title: string; level: string; mine?: boolean; top?: boolean }>;
  reviews: Array<{ review_id: Uuid; cycle: string; self: string | null; manager: string | null; second: string | null; status: Pill; manager_comment: string | null }>;
}

declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/ess/performance": { query: never; body: never; params: never; response: MyPerformance };
  }
}

export type { PersonRef };
