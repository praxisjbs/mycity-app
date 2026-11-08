import type { PersonRef } from "./common";
import type { BarRow } from "./home";

/**
 * INTERIM Partnerships shapes (owner GE; docs/guides/partnerships.md), for the screens still on the
 * mock: Analytics (PR 8). Pipeline, Partners, Leads and both 360s run on the generated contract since
 * M7 PR 3, Proposals and the studio since PR 7, Contracts & MOUs since PR 6; this file is deleted in PR 8.
 */
export interface PartnershipAnalytics {
  period: string;
  prospects: number;
  meetings: number;
  proposals: number;
  signed: number;
  by_owner: Array<{ owner: PersonRef; prospects: number; meetings: number; proposals: number; signed: number; active: number; downloads: number }>;
  signed_per_month: { labels: string[]; values: number[] };
  downloads: BarRow[];
  months: Array<{ month: string; prospects: number; proposals: number; signed: number; conversion_pct: number }>;
}

declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/partnerships/analytics": { query: never; body: never; params: never; response: PartnershipAnalytics };
  }
}
