import type { IsoDate, IsoDateTime, Money, Paged, PersonRef, Tone, Uuid } from "./common";

/** INTERIM Employee Self-Service shapes (owner AJ; docs/guides/ess.md). Scope is always own. */
type Pill = { tone: Tone; text: string };

export interface MyQuery {
  query_id: Uuid;
  number: string;
  subject: string;
  raised_by: string;
  date: IsoDate;
  response: string | null;
  outcome: Pill;
  respond_by: IsoDateTime | null;
}
export interface MySanction {
  sanction_id: Uuid;
  kind: string;
  reason: string;
  date: IsoDate;
  deduction: Money | null;
  status: Pill;
}
export interface MyQueriesSummary {
  open: number;
  archived: number;
  archived_note: string;
  sanctions: number;
  last_sanction: IsoDate | null;
}

type Q<T = object> = T & { page?: number; q?: string };

declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/ess/queries/summary": { query: never; body: never; params: never; response: MyQueriesSummary };
    "GET /api/v1/ess/queries": { query: Q<{ view: "open" | "archived" }>; body: never; params: never; response: Paged<MyQuery> };
    "POST /api/v1/ess/queries/:id/response": { query: never; body: { response: string }; params: { id: string }; response: MyQuery };
    "GET /api/v1/ess/sanctions": { query: Q; body: never; params: never; response: Paged<MySanction> };
  }
}

export type { PersonRef };
