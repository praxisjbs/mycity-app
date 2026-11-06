import type { IsoDate, Money, Paged, Uuid } from "./common";
import type { Status, Step } from "./performance";

/**
 * INTERIM shapes for M5's Offers and Onboarding tabs (owner AJ), which stay on the Recruitment screen
 * until M5 puts them on the contract. Everything of M4 (vacancies, candidates, assessments, interviews,
 * the Talent Pool) is typed by the contract (packages/contract/schemas/), through api/endpoints.ts.
 */

/** A letter as the document engine fills it (INTERIM for the offer letter; owner TB). `filled` marks the words that came from the record. */
export interface LetterPreview {
  reference: string;
  title: string;
  date_line: string;
  paragraphs: Array<Array<{ text: string; filled?: boolean }>>;
  signer: string;
  signer_role: string;
  fields_note: string;
}

export interface OfferRow {
  offer_id: Uuid;
  number: string;
  candidate: string;
  role: string;
  salary: Money;
  issued_on: IsoDate | null;
  expires_on: IsoDate | null;
  status: Status;
}

export interface OffersSummary {
  awaiting_signature: number;
  signed_this_year: number;
  declined: number;
  average_days_to_sign: string;
}

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
    "GET /api/v1/recruitment/offers/summary": { query: never; body: never; params: never; response: OffersSummary };
    "GET /api/v1/recruitment/offers": { query: Q; body: never; params: never; response: Paged<OfferRow> };
    "GET /api/v1/recruitment/offers/:id/letter": { query: never; body: never; params: { id: string }; response: LetterPreview };
    "POST /api/v1/recruitment/offers": { query: never; body: { candidate_id: Uuid; salary: Money; start_date: IsoDate; expires_on: IsoDate }; params: never; response: OfferRow };
    "POST /api/v1/recruitment/offers/:id/send": { query: never; body: Record<string, never>; params: { id: string }; response: OfferRow };
    "GET /api/v1/recruitment/onboarding/summary": { query: never; body: never; params: never; response: OnboardingSummary };
    "GET /api/v1/recruitment/onboarding": { query: Q; body: never; params: never; response: Paged<OnboardingRow> };
    "GET /api/v1/recruitment/onboarding/:id": { query: never; body: never; params: { id: string }; response: OnboardingDetail };
    "POST /api/v1/recruitment/onboarding/:id/remind": { query: never; body: Record<string, never>; params: { id: string }; response: OnboardingDetail };
  }
}
