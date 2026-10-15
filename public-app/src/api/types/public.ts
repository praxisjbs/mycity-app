import type { DocumentRef, IsoDateTime, ListQuery, Money, Paged } from "./common";

/**
 * INTERIM public-site shapes, `/api/public/v1/*` (SYSTEM_ARCHITECTURE §3).
 * Careers, Vacancy, Apply and Assessment are M4 (owner TB); Sign Offer and
 * Verify Document are M5 (owner LA). Only the document and verify routes are
 * named in BACKEND_STRUCTURE §8; every other route here is proposed and needs
 * the owner's agreement before the contract is written.
 *
 * Rules the shapes keep (MILESTONES §6, the demo's notes):
 * - Careers and a vacancy are reached by a readable slug and are indexable.
 * - Apply, assessment and signing are reached by an opaque, per-person token.
 * - An application writes and never reads back: no score, no other applicant.
 * - Verify returns the document type, the signer and two verdicts. Never the file.
 */

export type WorkPattern = "on_site" | "hybrid" | "remote";

export interface VacancyCard {
  slug: string;
  title: string;
  department: string;
  location: string;
  work_pattern: WorkPattern;
}

export interface Vacancy extends VacancyCard {
  /** "4 days on site". */
  work_pattern_note: string | null;
  employment_type: string;
  probation_months: number | null;
  reports_to: string | null;
  /** From the grade band for the role. Null when the band is not published. */
  salary_min: Money | null;
  salary_max: Money | null;
  summary: string;
  must_have: string;
  nice_to_have: string | null;
  /** From the assessment set attached to the vacancy. */
  how_we_hire: string;
  applicants: number;
  /** A paused role keeps its link and takes no applications; a filled one says so instead of a 404. */
  state: "open" | "paused" | "filled";
}

/** Apply reads nothing but the role it is for and when the link lapses. */
export interface ApplyLink {
  vacancy_title: string;
  expires_at: IsoDateTime;
  state: "open" | "submitted";
}
export interface ApplicationBody {
  full_name: string;
  email: string;
  phone: string;
  years_experience: number;
  cv_document_id: string;
  why: string;
}
export interface ApplicationReceipt {
  reference: string;
  submitted_at: IsoDateTime;
}

export type QuestionKind = "choice" | "text";
export interface AssessmentQuestion {
  question_id: string;
  n: number;
  kind: QuestionKind;
  prompt: string;
  options: Array<{ id: string; text: string }> | null;
  /** The candidate's saved answer, so a reopened link resumes exactly here. */
  answer: string | null;
}
export interface AssessmentSession {
  candidate_first_name: string;
  vacancy_title: string;
  assessment: {
    title: string;
    kind: "Psychometric" | "Technical" | "Case study";
    duration_min: number;
    question_count: number;
    instructions: string;
  };
  state: "not_started" | "in_progress" | "submitted" | "timed_out";
  /** The timer runs on the server: the end time, and the server's clock to count from. */
  ends_at: IsoDateTime | null;
  server_now: IsoDateTime;
  current: number;
  questions: AssessmentQuestion[] | null;
  submitted_at: IsoDateTime | null;
}

export interface OfferToSign {
  reference: string;
  candidate_name: string;
  role: string;
  company: string;
  expires_at: IsoDateTime;
  state: "awaiting" | "signed" | "declined" | "expired" | "withdrawn";
  /** The same text that is in the PDF, from the one renderer (MILESTONES §10). */
  letter: string[];
  signed_at: IsoDateTime | null;
  /** go.mycityapp.io/verify/<number>, once signed. */
  verify_number: string | null;
}

export type Verdict = "matches" | "differs";
export interface VerifyResult {
  number: string;
  document_type: string;
  signed_by: string;
  signed_at: IsoDateTime;
  issued_by: string;
  content: Verdict;
  artifact: Verdict;
}

declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/public/v1/jobs": { query: ListQuery; body: never; params: never; response: Paged<VacancyCard> };
    "GET /api/public/v1/jobs/:slug": { query: never; body: never; params: { slug: string }; response: Vacancy };
    "POST /api/public/v1/jobs/:slug/apply": { query: never; body: Record<string, never>; params: { slug: string }; response: { token: string } };
    "GET /api/public/v1/apply/:token": { query: never; body: never; params: { token: string }; response: ApplyLink };
    "POST /api/public/v1/apply/:token": { query: never; body: ApplicationBody; params: { token: string }; response: ApplicationReceipt };
    "GET /api/public/v1/assess/:token": { query: never; body: never; params: { token: string }; response: AssessmentSession };
    "POST /api/public/v1/assess/:token/start": { query: never; body: Record<string, never>; params: { token: string }; response: AssessmentSession };
    "PUT /api/public/v1/assess/:token/answers/:question_id": { query: never; body: { answer: string; current: number }; params: { token: string; question_id: string }; response: { saved_at: IsoDateTime } };
    "POST /api/public/v1/assess/:token/submit": { query: never; body: Record<string, never>; params: { token: string }; response: AssessmentSession };
    "GET /api/public/v1/sign/:token": { query: never; body: never; params: { token: string }; response: OfferToSign };
    "POST /api/public/v1/sign/:token/sign": { query: never; body: { signature_png: string }; params: { token: string }; response: OfferToSign };
    "POST /api/public/v1/sign/:token/decline": { query: never; body: { reason: string }; params: { token: string }; response: OfferToSign };
    "GET /api/public/v1/verify/:number": { query: never; body: never; params: { number: string }; response: VerifyResult };
  }
}

export type { DocumentRef };
