import type { IsoDate, IsoDateTime, Paged, PersonRef, Tone, Uuid } from "./common";

/** INTERIM Performance shapes for Reviews until PR 3 moves them to the contract. Every status is worded by the API. */
export type Status = { tone: Tone; text: string };
export type Step = { label: string; state: "done" | "now" | null };
export type Trail = { title: string; when: IsoDateTime; text: string | null; tone: "hi" | "ok" | null };
export interface ReviewRow {
  review_id: Uuid;
  employee: PersonRef;
  cycle: string;
  self_rating: string | null;
  manager_rating: string | null;
  second_level: string | null;
  status: Status;
}
export interface ReviewsSummary {
  cycle: string;
  opens_on: IsoDate;
  last_cycle: string;
  average_rating: string;
  chain: Step[];
}
type Q<T = object> = T & { page?: number; q?: string };
declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/performance/reviews/summary": { query: never; body: never; params: never; response: ReviewsSummary };
    "GET /api/v1/performance/reviews": { query: Q<{ cycle?: string }>; body: never; params: never; response: Paged<ReviewRow> };
    "POST /api/v1/performance/reviews/cycles": { query: never; body: { name: string; opens_on: IsoDate }; params: never; response: ReviewsSummary };
  }
}
