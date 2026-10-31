import type { PlaceValue } from "@mycity/ui";
import type { IsoDate, IsoDateTime, Money, Paged, PersonRef, Uuid } from "./common";
import type { BarRow } from "./home";
import type { Status, Step, Trail } from "./performance";

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

/** INTERIM Recruitment shapes (owner TB; MILESTONES §9). Candidates apply and take assessments on the public site. */
export type Stage = "applied" | "shortlisted" | "interview" | "offer" | "hired" | "rejected";
export interface VacancyRef {
  vacancy_id: Uuid;
  title: string;
}
export interface Vacancy extends VacancyRef {
  department: string;
  openings: number;
  location: string;
  applicants: number;
  published_on: IsoDate;
  status: Status;
  paused: boolean;
  days_open: number;
  stage_note: string;
  next_step: string;
  public_url: string;
}
export interface VacanciesSummary {
  open: number;
  applicants: number;
  in_interview: number;
  offers_out: number;
  funnel: BarRow[];
  funnel_note: string;
}
export interface VacancyCreate {
  title: string;
  department: string;
  openings: number;
  /** Picked from the address search at level area (F27): a district, a town or a city. */
  location: PlaceValue;
  arrangement: "on_site" | "hybrid" | "remote";
  closes_on: IsoDate;
  description: string;
}
export interface Candidate {
  candidate_id: Uuid;
  name: string;
  vacancy: VacancyRef;
  stage: Stage;
  score: number | null;
  score_provisional: boolean;
  chip: Status;
}
export interface CandidateDetail extends Candidate {
  email: string;
  applied_on: IsoDate;
  source: string;
  assessments: string | null;
  interview: string | null;
  weighted_total: number | null;
  next_stages: Stage[];
}
export interface CandidatesSummary {
  candidates: number;
  in_board: number;
  awaiting_human: number;
  average_score: number;
  distribution: BarRow[];
  distribution_note: string;
}
export interface Assessment {
  assessment_id: Uuid;
  name: string;
  role: string;
  kind: "Psychometric" | "Technical" | "Case study";
  duration_min: number;
  candidates: number;
  average_score: number | null;
  status: Status;
}
export interface AssessmentsSummary {
  assessments: number;
  taken: number;
  average_score: number;
  abandoned: number;
  by_assessment: BarRow[];
  by_assessment_note: string;
}
export interface InterviewRow {
  interview_id: Uuid;
  candidate: string;
  role: string;
  at: IsoDateTime;
  panel_size: number;
  round: Status;
}
export interface InterviewDetail extends InterviewRow {
  panel: Array<{ panellist: PersonRef; submitted: boolean; score: number | null; sealed: boolean }>;
  scorecard: BarRow[];
  activity: Trail[];
  can_consolidate: boolean;
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
export interface PoolRow {
  pool_id: Uuid;
  name: string;
  applied_for: string;
  score: number;
  added_on: IsoDate;
  reason: string;
  invited: boolean;
}
export interface PoolSummary {
  in_pool: number;
  invited_back: number;
  hired_from_pool: number;
  average_score: number;
}

type Q<T = object> = T & { page?: number; q?: string };
declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/recruitment/vacancies/summary": { query: never; body: never; params: never; response: VacanciesSummary };
    "GET /api/v1/recruitment/vacancies": { query: Q<{ status?: "open" | "paused" }>; body: never; params: never; response: Paged<Vacancy> };
    "POST /api/v1/recruitment/vacancies": { query: never; body: VacancyCreate; params: never; response: Vacancy };
    "POST /api/v1/recruitment/vacancies/:id/pause": { query: never; body: Record<string, never>; params: { id: string }; response: Vacancy };
    "POST /api/v1/recruitment/vacancies/:id/resume": { query: never; body: Record<string, never>; params: { id: string }; response: Vacancy };
    "GET /api/v1/recruitment/candidates/summary": { query: never; body: never; params: never; response: CandidatesSummary };
    "GET /api/v1/recruitment/candidates": { query: Q<{ stage?: Stage; vacancy_id?: Uuid }>; body: never; params: never; response: Paged<Candidate> };
    "GET /api/v1/recruitment/candidates/:id": { query: never; body: never; params: { id: string }; response: CandidateDetail };
    "POST /api/v1/recruitment/candidates": { query: never; body: { name: string; email: string; vacancy_id: Uuid }; params: never; response: CandidateDetail };
    "POST /api/v1/recruitment/candidates/:id/move": { query: never; body: { stage: Stage; reason?: string }; params: { id: string }; response: CandidateDetail };
    "POST /api/v1/recruitment/candidates/:id/pool": { query: never; body: { reason: string }; params: { id: string }; response: PoolRow };
    "GET /api/v1/recruitment/assessments/summary": { query: never; body: never; params: never; response: AssessmentsSummary };
    "GET /api/v1/recruitment/assessments": { query: Q; body: never; params: never; response: Paged<Assessment> };
    "POST /api/v1/recruitment/assessments": { query: never; body: { name: string; role: string; kind: Assessment["kind"]; duration_min: number }; params: never; response: Assessment };
    "GET /api/v1/recruitment/interviews": { query: Q; body: never; params: never; response: Paged<InterviewRow> };
    "GET /api/v1/recruitment/interviews/:id": { query: never; body: never; params: { id: string }; response: InterviewDetail };
    "POST /api/v1/recruitment/interviews": { query: never; body: { candidate_id: Uuid; at: IsoDateTime; panel_ids: Uuid[] }; params: never; response: InterviewRow };
    "POST /api/v1/recruitment/interviews/:id/consolidate": { query: never; body: Record<string, never>; params: { id: string }; response: InterviewDetail };
    "GET /api/v1/recruitment/offers/summary": { query: never; body: never; params: never; response: OffersSummary };
    "GET /api/v1/recruitment/offers": { query: Q; body: never; params: never; response: Paged<OfferRow> };
    "GET /api/v1/recruitment/offers/:id/letter": { query: never; body: never; params: { id: string }; response: LetterPreview };
    "POST /api/v1/recruitment/offers": { query: never; body: { candidate_id: Uuid; salary: Money; start_date: IsoDate; expires_on: IsoDate }; params: never; response: OfferRow };
    "POST /api/v1/recruitment/offers/:id/send": { query: never; body: Record<string, never>; params: { id: string }; response: OfferRow };
    "GET /api/v1/recruitment/onboarding/summary": { query: never; body: never; params: never; response: OnboardingSummary };
    "GET /api/v1/recruitment/onboarding": { query: Q; body: never; params: never; response: Paged<OnboardingRow> };
    "GET /api/v1/recruitment/onboarding/:id": { query: never; body: never; params: { id: string }; response: OnboardingDetail };
    "POST /api/v1/recruitment/onboarding/:id/remind": { query: never; body: Record<string, never>; params: { id: string }; response: OnboardingDetail };
    "GET /api/v1/recruitment/pool/summary": { query: never; body: never; params: never; response: PoolSummary };
    "GET /api/v1/recruitment/pool": { query: Q; body: never; params: never; response: Paged<PoolRow> };
    "POST /api/v1/recruitment/pool/:id/invite": { query: never; body: { vacancy_id: Uuid }; params: { id: string }; response: PoolRow };
  }
}
