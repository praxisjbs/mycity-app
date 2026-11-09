import type { IsoDate, Money, Paged, PersonRef, Tone, Uuid } from "./common";

/**
 * INTERIM payroll shapes (owner TB, M6) for what the contract does not declare yet. Payroll runs are on the
 * contract since M6 PR 2 (packages/contract/schemas/payroll.js) and deductions since PR 3; payslips, grades and
 * statutory follow with PR 4 and PR 5, and their entries go here as they land (npm run contract:status).
 */
type Pill = { tone: Tone; text: string };

export interface PayslipRow {
  payslip_id: Uuid;
  number: string;
  employee: PersonRef;
  period: string; // "2026-09"
  gross: Money;
  deductions: Money;
  net: Money;
  status: "paid" | "in_run" | "draft";
  paid_on: IsoDate | null;
  has_query_deduction: boolean;
}
export interface Payslip extends PayslipRow {
  job_title: string;
  grade: string;
  bank_name: string;
  account_last4: string;
  earnings: Array<{ label: string; amount: Money }>;
  deduction_lines: Array<{ label: string; amount: Money; reference: string | null }>;
  approved_by: string | null;
}
export interface PayslipYear {
  year: number;
  years: number[];
  gross: Money;
  deductions: Money;
  net: Money;
  count: number;
  next_payday: IsoDate | null;
}
export interface DeductionRow {
  period: string;
  amount: Money;
  reason: string;
  query_number: string;
  outcome: Pill;
}

type Q<T = object> = T & { page?: number; q?: string };

/* ── Payroll module (owner TB, M6) ── */
type Status = Pill;
export interface Grade {
  grade_id: Uuid;
  code: string;
  band: string;
  minimum: Money;
  midpoint: Money;
  maximum: Money;
  staff: number;
}
export interface GradesSummary {
  grades: number;
  placed: number;
  below_minimum: number;
  above_maximum: number;
  scale_max: Money;
}
export interface Statutory {
  enabled: boolean;
  effective_from: IsoDate | null;
  items: Array<{ item: string; kind: "Employee" | "Employer"; rate: string; base: string; status: Status }>;
  paye_bands: Array<{ label: string; annual: Money; rate: string }>;
}

declare module "@/api/endpoints" {
  interface Endpoints {
    "POST /api/v1/payroll/runs/:id/email-payslips": { query: never; body: Record<string, never>; params: { id: string }; response: { job_id: Uuid } };
    "GET /api/v1/payroll/grades/summary": { query: never; body: never; params: never; response: GradesSummary };
    "GET /api/v1/payroll/grades": { query: Q; body: never; params: never; response: Paged<Grade> };
    "POST /api/v1/payroll/grades": { query: never; body: { code: string; band: string; minimum: Money; midpoint: Money; maximum: Money; effective_from: IsoDate }; params: never; response: Grade };
    "GET /api/v1/payroll/statutory": { query: never; body: never; params: never; response: Statutory };
    "POST /api/v1/payroll/statutory/enable": { query: never; body: { effective_from: IsoDate }; params: never; response: Statutory };
    "GET /api/v1/payslips": { query: Q<{ scope?: "own" | "all"; year?: string; period?: string; status?: string }>; body: never; params: never; response: Paged<PayslipRow> };
    "GET /api/v1/payslips/summary": { query: { year?: string }; body: never; params: never; response: PayslipYear };
    "GET /api/v1/payslips/:id": { query: never; body: never; params: { id: string }; response: Payslip };
    "POST /api/v1/payslips/:id/email": { query: never; body: Record<string, never>; params: { id: string }; response: null };
    "GET /api/v1/payslips/deductions": { query: Q<{ scope?: "own" }>; body: never; params: never; response: Paged<DeductionRow> };
  }
}
