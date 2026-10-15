/**
 * Wire primitives, as packages/contract/schemas/common.js defines them.
 *
 * INTERIM: these stand in for packages/contract/contract.gen.ts until the
 * public routes' contract is written (BACKEND_STRUCTURE §6). Field names are
 * snake_case, exactly as the API sends them.
 */
export type Uuid = string;
/** "2026-10-13" */
export type IsoDate = string;
/** "2026-10-13T09:14:00+01:00" */
export type IsoDateTime = string;
/** Decimal string with two places: "1250000.00". Never a number. */
export type Money = string;

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

/** What the upload route answers: the vault document the file became. */
export interface DocumentRef {
  document_id: Uuid;
  file_name: string;
  size_bytes: number;
  mime_type: string;
}
