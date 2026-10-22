import type { IsoDateTime, Tone } from "./common";
import type { BarRow } from "./home";

/** INTERIM Performance shapes for Analytics until PR 5 moves them to the contract, and the status words other mocks share. Every status is worded by the API. */
export type Status = { tone: Tone; text: string };
export type Step = { label: string; state: "done" | "now" | null };
export type Trail = { title: string; when: IsoDateTime; text: string | null; tone: "hi" | "ok" | null };
export interface PerformanceAnalytics {
  goals_on_track: string;
  reviews_completed: string;
  average_self: string;
  average_manager: string;
  completion: { labels: string[]; values: number[] };
  by_department: BarRow[];
  gap: Array<{ department: string; self: string; manager: string; gap: string }>;
  gap_cycle: string;
}

declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/performance/analytics": { query: never; body: never; params: never; response: PerformanceAnalytics };
  }
}
