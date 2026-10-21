import type { IsoDate, Money, Paged, PersonRef, Uuid } from "./common";
import type { BarRow } from "./home";
import type { Status, Step, Trail } from "./shared";

/** INTERIM Partnerships shapes (owner NE; MILESTONES §12). Stages are MyCity's own tracker stages. */
export interface PartnerRow {
  partner_id: Uuid;
  name: string;
  industry: string;
  type: string;
  stage: string;
  stage_status: Status;
  owner: PersonRef;
  value: Money;
  last_contact_days: number;
}
export interface PipelineSummary {
  in_pipeline: number;
  signed_this_year: number;
  signed_value: Money;
  going_quiet: number;
  stages: BarRow[];
  stages_note: string;
  longest: Array<{ partner_id: Uuid; name: string; stage: string; days_at_stage: number; owner: PersonRef; action: Status }>;
}
export interface PartnersSummary {
  active: number;
  total_value: Money;
  renewals_180: number;
  quiet_30: number;
  by_type: BarRow[];
}
export interface Partner360 {
  partner_id: Uuid;
  name: string;
  legal_name: string;
  industry: string;
  type: string;
  owner: PersonRef;
  stage: string;
  stage_status: Status;
  value: Money;
  since: IsoDate | null;
  last_contact_days: number;
  hq: string;
  website: string;
  stats: { signed_documents: number; open_tasks: number; interactions_90d: number; renewal: IsoDate | null };
  contacts: Array<[string, string]>;
  chain: Step[];
  chain_note: string;
  days_at_stage: Array<{ label: string; days: number; current: boolean }>;
  interactions: Trail[];
  documents: Array<{ title: string; kind: string; signed_on: IsoDate | null; status: Status }>;
  deliverables: Array<{ title: string; owner: PersonRef; due: IsoDate; status: Status }>;
  downloads: { labels: string[]; values: number[] };
  lines: BarRow[];
}
export interface PartnerCreate {
  name: string;
  legal_name: string;
  industry: string;
  type: string;
  owner_id: Uuid;
  value: Money;
  hq: string;
  website: string;
}
export interface InteractionCreate {
  kind: "call" | "meeting" | "email" | "visit";
  happened_on: IsoDate;
  summary: string;
}
export interface Lead {
  lead_id: Uuid;
  title: string;
  source: string;
  owner: PersonRef;
  added_on: IsoDate;
  next_action: string | null;
  status: Status;
}
export interface LeadsSummary {
  new: number;
  contacted: number;
  qualified: number;
  converted_this_month: number;
  sources: BarRow[];
}
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
  cities: string;
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
    "GET /api/v1/partnerships/pipeline": { query: never; body: never; params: never; response: PipelineSummary };
    "GET /api/v1/partnerships/partners/summary": { query: never; body: never; params: never; response: PartnersSummary };
    "GET /api/v1/partnerships/partners": { query: Q<{ stage?: string; type?: string; quiet?: boolean }>; body: never; params: never; response: Paged<PartnerRow> };
    "GET /api/v1/partnerships/partners/:id": { query: never; body: never; params: { id: string }; response: Partner360 };
    "POST /api/v1/partnerships/partners": { query: never; body: PartnerCreate; params: never; response: Partner360 };
    "POST /api/v1/partnerships/partners/:id/stage": { query: never; body: { stage: string; reason?: string }; params: { id: string }; response: Partner360 };
    "POST /api/v1/partnerships/partners/:id/interactions": { query: never; body: InteractionCreate; params: { id: string }; response: Partner360 };
    "GET /api/v1/partnerships/stages": { query: never; body: never; params: never; response: string[] };
    "GET /api/v1/partnerships/leads/summary": { query: never; body: never; params: never; response: LeadsSummary };
    "GET /api/v1/partnerships/leads": { query: Q<{ status?: string; source?: string }>; body: never; params: never; response: Paged<Lead> };
    "POST /api/v1/partnerships/leads": { query: never; body: { title: string; source: string; next_action: string }; params: never; response: Lead };
    "POST /api/v1/partnerships/leads/:id/convert": { query: never; body: Record<string, never>; params: { id: string }; response: { partner_id: Uuid } };
    "POST /api/v1/partnerships/leads/:id/lose": { query: never; body: { reason: string }; params: { id: string }; response: Lead };
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
