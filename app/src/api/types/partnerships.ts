import type { PlaceValue } from "@mycity/ui";
import type { IsoDate, Money, Paged, PersonRef, Uuid } from "./common";
import type { BarRow } from "./home";
import type { Status, Step } from "./performance";

/**
 * INTERIM Partnerships shapes (owner GE; docs/guides/partnerships.md), for the screens still on the
 * mock: Proposals (M7 PR 7), Contracts & MOUs (PR 6) and Analytics (PR 8). Pipeline, Partners,
 * Leads and both 360s run on the generated contract since M7 PR 3; this file is deleted in PR 8.
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
export interface Contract {
  contract_id: Uuid;
  title: string;
  partner: string;
  kind: "MOU" | "Contract";
  start_on: IsoDate | null;
  renewal_on: IsoDate | null;
  value: Money;
  status: Status;
}
export interface ContractsSummary {
  active: number;
  in_review: number;
  draft: number;
  renewals_180: number;
  chain: Step[];
}
export interface Renewal {
  contract_id: Uuid;
  title: string;
  partner: string;
  due: IsoDate;
  days: number;
  owner: PersonRef;
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
    "GET /api/v1/partnerships/contracts/summary": { query: never; body: never; params: never; response: ContractsSummary };
    "GET /api/v1/partnerships/contracts": { query: Q; body: never; params: never; response: Paged<Contract> };
    "GET /api/v1/partnerships/contracts/renewals": { query: Q; body: never; params: never; response: Paged<Renewal> };
    "POST /api/v1/partnerships/contracts": { query: never; body: { partner_id: Uuid; title: string; kind: Contract["kind"]; value: Money }; params: never; response: Contract };
    "GET /api/v1/partnerships/analytics": { query: never; body: never; params: never; response: PartnershipAnalytics };
  }
}
