import type { DocumentRef, IsoDateTime } from "./common";

/**
 * INTERIM public-site shapes for M5's pages, Sign Offer and Verify Document (owner AJ), until their
 * contract lands. M4's pages (Careers, Vacancy, Apply, Assessment) take the generated contract
 * (`api/endpoints.ts` picks their routes; their types come from `@mycity/contract/contract.gen.ts`).
 *
 * Rules the shapes keep (MILESTONES §6, the demo's notes, docs/guides/partnerships.md §6.9):
 * - Signing is reached by an opaque, per-person token.
 * - Verify by reference returns the document type, the signer and two verdicts, never the content;
 *   only the QR's token (`/verify/t/<token>`) also returns the document itself.
 */

export interface OfferToSign {
  reference: string;
  candidate_name: string;
  role: string;
  company: string;
  /** The day the letter is dated, as its letterhead prints it. */
  issued_at: IsoDateTime;
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

/** Verify by the QR's token: the same record, and the document it is about. */
export interface VerifyByToken extends VerifyResult {
  document: {
    title: string;
    /** The letter's text, as the PDF has it (the same renderer as OfferToSign.letter). */
    letter: string[];
    file_name: string;
    url: string;
  };
}

declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/public/v1/sign/:token": { query: never; body: never; params: { token: string }; response: OfferToSign };
    "POST /api/public/v1/sign/:token/sign": { query: never; body: { signature_png: string }; params: { token: string }; response: OfferToSign };
    "POST /api/public/v1/sign/:token/decline": { query: never; body: { reason: string }; params: { token: string }; response: OfferToSign };
    "GET /api/public/v1/verify/:number": { query: never; body: never; params: { number: string }; response: VerifyResult };
    "GET /api/public/v1/verify/t/:token": { query: never; body: never; params: { token: string }; response: VerifyByToken };
  }
}

export type { DocumentRef };
