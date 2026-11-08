import type { IsoDate, Paged, Uuid } from "./common";
import type { Status, Step } from "./performance";

/**
 * INTERIM shapes for M5's Onboarding tab (owner AJ), which stays on these until M5 puts it on the
 * contract (PR 7). Everything else of Recruitment, M5's Offers included, is typed by the contract
 * (packages/contract/schemas/), through api/endpoints.ts.
 */

export interface OnboardingRow {
  onboarding_id: Uuid;
  name: string;
  role: string;
  start_date: IsoDate;
  documents_done: number;
  documents_total: number;
  stage: Status;
}

export interface OnboardingDetail extends OnboardingRow {
  checklist: Array<{ name: string; status: Status }>;
  plan: Array<{ title: string; text: string; done: boolean }>;
}

export interface OnboardingSummary {
  in_progress: number;
  blocked: number;
  starting_this_month: number;
  confirmed_90d: number;
  chain: Step[];
  focus_id: Uuid | null;
}

type Q<T = object> = T & { page?: number; q?: string };

declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/recruitment/onboarding/summary": { query: never; body: never; params: never; response: OnboardingSummary };
    "GET /api/v1/recruitment/onboarding": { query: Q; body: never; params: never; response: Paged<OnboardingRow> };
    "GET /api/v1/recruitment/onboarding/:id": { query: never; body: never; params: { id: string }; response: OnboardingDetail };
    "POST /api/v1/recruitment/onboarding/:id/remind": { query: never; body: Record<string, never>; params: { id: string }; response: OnboardingDetail };
  }
}
