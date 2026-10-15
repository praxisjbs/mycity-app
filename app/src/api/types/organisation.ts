import type { DocumentRef, IsoDate, Money, Paged, PersonRef, Tone, Uuid } from "./common";

/**
 * Organisation: employees, departments, the reporting tree.
 * EmployeeCreate mirrors packages/contract/schemas/organisation.js EXACTLY
 * (the one module whose contract is already written). The rest is INTERIM.
 */
export type EmploymentType = "full_time" | "part_time" | "contractor" | "consultant" | "intern";
export type WorkPattern = "on_site" | "hybrid" | "remote";

export interface EmployeeCreate {
  staff_number?: string;
  first_name: string;
  last_name: string;
  work_email: string;
  phone: string;
  job_title: string;
  start_date: IsoDate;
  employment_type: EmploymentType;
  work_pattern: WorkPattern;
  date_of_birth?: IsoDate;
  next_of_kin?: string;
  bank_name?: string;
  account_number?: string;
  gross_monthly?: Money;
  department_id: Uuid;
  line_manager_id?: Uuid;
  worksite_id?: Uuid;
}

export type Pill = { tone: Tone; text: string };

export interface EmployeeRow {
  employee_id: Uuid;
  staff_number: string;
  display_name: string;
  job_title: string;
  department: string;
  line_manager: PersonRef | null;
  arrangement: string;
  attendance_today: Pill;
  status: Pill;
}

export interface EmployeesSummary {
  kpis: Array<{ key: string; label: string; value: string; tone?: Tone }>;
  arrangements: Array<{ label: string; value: string }>;
  departments: Array<{ label: string; pct: number; value: string }>;
  decisions: Array<{ title: string; text: string; action: Pill; link: string }>;
}

export interface Employee360 {
  employee_id: Uuid;
  staff_number: string;
  display_name: string;
  job_title: string;
  department: string;
  grade: string;
  line_manager: PersonRef | null;
  start_date: IsoDate;
  employment_type: string;
  arrangement: string;
  status: Pill;
  work_email: string;
  phone: string;
  /** Field-masked: null when the viewer lacks the field grant (BACKEND_STRUCTURE §9.4). */
  gross_monthly: Money | null;
  bank_name: string | null;
  account_last4: string | null;
  next_of_kin: string | null;
  stats: Array<{ label: string; value: string; tone?: Tone }>;
  kpis: Array<{ label: string; pct: number; value: string; emphasis?: "warn" | "brand" }>;
  activity: Array<{ title: string; when: string; text?: string; tone?: "hi" | "ok" }>;
  punches: Array<{ date: IsoDate; in: string | null; out: string | null; location: string; status: Pill }>;
  documents: Array<{ name: string; status: Pill; expires: IsoDate | null; document: DocumentRef | null }>;
  queries: Array<{ subject: string; raised_by: string; date: IsoDate | null; outcome: Pill }>;
  open_queries: number;
}

export interface Department {
  department_id: Uuid;
  name: string;
  head: PersonRef | null;
  headcount: number;
}

export interface OrgNode {
  employee_id: Uuid | null;
  seat_id: Uuid;
  display_name: string;
  job_title: string;
  department: string;
  manager_seat_id: Uuid | null;
  is_ceo: boolean;
  vacant: boolean;
  dotted_line_to: string | null;
  /** Builder only (People); omitted in the read-only Org Chart. */
  meta: string | null;
}

type Q<T = object> = T & { page?: number; q?: string };

declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/employees": { query: Q<{ department?: string; status?: string; arrangement?: string }>; body: never; params: never; response: Paged<EmployeeRow> };
    "GET /api/v1/employees/summary": { query: never; body: never; params: never; response: EmployeesSummary };
    "GET /api/v1/employees/:id": { query: never; body: never; params: { id: string }; response: Employee360 };
    "POST /api/v1/employees": { query: never; body: EmployeeCreate; params: never; response: Employee360 };
    "PATCH /api/v1/employees/:id/line-manager": { query: never; body: { line_manager_id: Uuid | null; reason: string }; params: { id: string }; response: OrgNode };
    "GET /api/v1/departments": { query: Q; body: never; params: never; response: Paged<Department> };
    "GET /api/v1/org-chart": { query: { view: "builder" | "viewer" }; body: never; params: never; response: { nodes: OrgNode[]; seats: number; filled: number } };
  }
}
