/**
 * Wire primitives, as packages/contract/schemas/common.js defines them.
 *
 * INTERIM: these types and the per-module types beside them stand in for
 * packages/contract/contract.gen.ts until each module's contract is written.
 * As a module's schemas land, its file here is replaced by the generated types
 * (BACKEND_STRUCTURE §6) and TypeScript shows every screen that disagrees.
 * Field names are snake_case, exactly as the API sends them.
 */
export type Uuid = string;
/** "2026-10-13" */
export type IsoDate = string;
/** "2026-10-13T09:14:00+01:00" */
export type IsoDateTime = string;
/** Decimal string with two places: "1250000.00". Never a number. */
export type Money = string;

/** `page` on every list response (common.js PageMeta). */
export interface PageMeta {
  number: number;
  size: number;
  total: number;
  pages: number;
  has_next: boolean;
}

/** Every list endpoint: `{ data, page }`, at most one page of rows. */
export interface Paged<T> {
  data: T[];
  page: PageMeta;
}

/** The controls every list accepts (common.js LIST_CONTROLS). No page size: the server decides. */
export interface ListQuery {
  page?: number;
  q?: string;
}

/** Every error body (middleware/error-handler.js). */
export interface ErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
    reference?: string;
  };
  request_id?: string;
}

/** 202 responses: work continues in the worker. */
export interface Accepted {
  job_id: Uuid;
}

/** A person as lists show them. */
export interface PersonRef {
  employee_id: Uuid;
  display_name: string;
  job_title?: string | null;
  department?: string | null;
  photo_url?: string | null;
}

/** A link the API derives for a record (src/shared/route-map.js). */
export interface ScreenLink {
  module: string;
  tab: string;
  id?: Uuid | null;
  path: string;
}

/** A file in the vault, as lists and records carry it. */
export interface DocumentRef {
  document_id: Uuid;
  file_name: string;
  size_bytes: number;
  mime_type: string;
}

/** Status pills share one tone vocabulary across modules. */
export type Tone = "ok" | "warn" | "err" | "info" | "neutral";
