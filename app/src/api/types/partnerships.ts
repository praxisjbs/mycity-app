import type { PlaceValue } from "@mycity/ui";
import type { Money, Paged, PersonRef, Uuid } from "./common";
import type { BarRow } from "./home";
import type { Status } from "./performance";

/**
 * INTERIM Partnerships shapes (owner GE; docs/guides/partnerships.md), for the screens still on the
 * mock: Proposals (M7 PR 7) and Analytics (PR 8). Pipeline, Partners, Leads, both 360s and Contracts
 * & MOUs run on the generated contract (M7 PR 3, PR 6); this file is deleted in PR 8.
 */
export interface Proposal {
  proposal_id: Uuid;
  number: string;
  title: string;
  partner: string;
  value: Money;
  status: Status;
}
export interface ProposalDoc {
  reference: string;
  title: string;
  prepared_for: string;
  sections: Array<{ heading: string; text: string }>;
  lines: Array<{ label: string; amount: Money }>;
  total: Money;
  footnote: string;
}
export interface ProposalsSummary {
  sent_this_year: number;
  accepted: number;
  viewed_no_reply: number;
  acceptance_rate: string;
}
export interface ProposalCreate {
  partner_id: Uuid;
  what: string;
  why_now: string;
  /** Picked from the address search at level city (F27), one or more. */
  cities: PlaceValue[];
  weeks: number;
  value: Money;
  terms: string;
}
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

type Q<T = object> = T & { page?: number; q?: string };
declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/partnerships/proposals/summary": { query: never; body: never; params: never; response: ProposalsSummary };
    "GET /api/v1/partnerships/proposals": { query: Q; body: never; params: never; response: Paged<Proposal> };
    "GET /api/v1/partnerships/proposals/:id/document": { query: never; body: never; params: { id: string }; response: ProposalDoc };
    "POST /api/v1/partnerships/proposals": { query: never; body: ProposalCreate; params: never; response: Proposal };
    "GET /api/v1/partnerships/analytics": { query: never; body: never; params: never; response: PartnershipAnalytics };
  }
}
