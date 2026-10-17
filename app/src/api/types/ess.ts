import type { IsoDate, IsoDateTime, Money, Paged, PersonRef, Tone, Uuid } from "./common";

/** INTERIM Employee Self-Service shapes (owner AJ; docs/guides/ess.md). Scope is always own. */
type Pill = { tone: Tone; text: string };

export interface MyProfile {
  employee_id: Uuid;
  display_name: string;
  job_title: string;
  department: string;
  photo_url: string | null;
  chips: Pill[];
  personal: { full_name: string; date_of_birth: IsoDate; phone: string; work_email: string; address: string };
  employment: { job_title: string; department: string; line_manager: string; start_date: IsoDate; employment_type: string; arrangement: string; status: Pill };
  bank: { bank_name: string; account_name: string; account_last4: string };
  next_of_kin: { name: string; relationship: string; phone: string };
  schedule: Array<{ day: string; mode: "Office" | "Remote" | "Field" | "Off"; hours: string; where: string }>;
  can_change: Array<{ field: string; how: Pill }>;
  history: Array<{ title: string; when: string; text?: string; tone?: "hi" | "ok" }>;
}
export interface ProfilePatch {
  phone?: string;
  address?: string;
  next_of_kin_name?: string;
  next_of_kin_relationship?: string;
  next_of_kin_phone?: string;
  bank_name?: string;
  account_number?: string;
  photo_document_id?: Uuid;
}

export interface MyPerformance {
  period: string;
  set_by: string;
  stats: Array<{ label: string; value: string; tone?: Tone }>;
  kpis: Array<{ label: string; pct: number; value: string; emphasis?: "warn" | "brand" }>;
  chain: Array<{ title: string; level: string; mine?: boolean; top?: boolean }>;
  reviews: Array<{ review_id: Uuid; cycle: string; self: string | null; manager: string | null; second: string | null; status: Pill; manager_comment: string | null }>;
}

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
    "GET /api/v1/ess/profile": { query: never; body: never; params: never; response: MyProfile };
    "PATCH /api/v1/ess/profile": { query: never; body: ProfilePatch; params: never; response: MyProfile };
    "GET /api/v1/ess/performance": { query: never; body: never; params: never; response: MyPerformance };
    "GET /api/v1/ess/queries/summary": { query: never; body: never; params: never; response: MyQueriesSummary };
    "GET /api/v1/ess/queries": { query: Q<{ view: "open" | "archived" }>; body: never; params: never; response: Paged<MyQuery> };
    "POST /api/v1/ess/queries/:id/response": { query: never; body: { response: string }; params: { id: string }; response: MyQuery };
    "GET /api/v1/ess/sanctions": { query: Q; body: never; params: never; response: Paged<MySanction> };
  }
}

export type { PersonRef };
