import type { IsoDate, IsoDateTime, Money, Paged, PersonRef, Tone, Uuid } from "./common";

/** INTERIM payroll shapes (owner LA, M6). Statutory rates come from current Nigerian law at M6. */
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

export interface PayrollRun {
  run_id: Uuid;
  number: string;
  period: string;
  headcount: number;
  gross: Money;
  deductions: Money;
  net: Money;
  status: "draft" | "computing" | "review" | "awaiting_approval" | "approved" | "paid";
  submitted_by: string | null;
  approved_by: string | null;
  created_at: IsoDateTime;
}

type Q<T = object> = T & { page?: number; q?: string };

/* ── Payroll module (owner LA, M6) ── */
type Status = Pill;
type Step = { label: string; state: "done" | "now" | null };
export interface RunRow {
  run_id: Uuid;
  period: string;
  headcount: number;
  gross: Money;
  deductions: Money;
  net: Money;
  approved_by: string | null;
  status: Status;
}
export interface RunsSummary {
  current: RunRow & { chain: Step[]; stage: PayrollRun["status"]; can_submit: boolean; can_approve: boolean; can_pay: boolean } | null;
  next_period: string;
  trend: { labels: string[]; values: Money[] };
  trend_note: string;
}
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
export interface PayrollDeduction {
  deduction_id: Uuid;
  employee: PersonRef;
  reason: string;
  source: string;
  amount: Money;
  period: string;
  status: Status;
}
export interface DeductionsSummary {
  pending: number;
  applied_this_period: Money;
  recovered_this_year: Money;
  sources: number;
  tiers_on: boolean;
  focus: { deduction_id: Uuid; title: string; chain: Step[]; note: string } | null;
}
export interface Statutory {
  enabled: boolean;
  effective_from: IsoDate | null;
  items: Array<{ item: string; kind: "Employee" | "Employer"; rate: string; base: string; status: Status }>;
  paye_bands: Array<{ label: string; annual: Money; rate: string }>;
}

declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/payroll/runs/summary": { query: never; body: never; params: never; response: RunsSummary };
    "GET /api/v1/payroll/runs": { query: Q; body: never; params: never; response: Paged<RunRow> };
    "POST /api/v1/payroll/runs": { query: never; body: { period: string }; params: never; response: RunRow };
    "POST /api/v1/payroll/runs/:id/submit": { query: never; body: Record<string, never>; params: { id: string }; response: RunRow };
    "POST /api/v1/payroll/runs/:id/approve": { query: never; body: Record<string, never>; params: { id: string }; response: RunRow };
    "POST /api/v1/payroll/runs/:id/paid": { query: never; body: { paid_on: IsoDate }; params: { id: string }; response: RunRow };
    "POST /api/v1/payroll/runs/:id/email-payslips": { query: never; body: Record<string, never>; params: { id: string }; response: { job_id: Uuid } };
    "GET /api/v1/payroll/grades/summary": { query: never; body: never; params: never; response: GradesSummary };
    "GET /api/v1/payroll/grades": { query: Q; body: never; params: never; response: Paged<Grade> };
    "POST /api/v1/payroll/grades": { query: never; body: { code: string; band: string; minimum: Money; midpoint: Money; maximum: Money; effective_from: IsoDate }; params: never; response: Grade };
    "GET /api/v1/payroll/deductions/summary": { query: never; body: never; params: never; response: DeductionsSummary };
    "GET /api/v1/payroll/deductions": { query: Q<{ status?: "pending" | "applied" }>; body: never; params: never; response: Paged<PayrollDeduction> };
    "POST /api/v1/payroll/deductions": { query: never; body: { employee_id: Uuid; reason: string; amount: Money; period: string }; params: never; response: PayrollDeduction };
    "POST /api/v1/payroll/deductions/:id/accept": { query: never; body: { runs: 1 | 2 }; params: { id: string }; response: PayrollDeduction };
    "POST /api/v1/payroll/deductions/:id/waive": { query: never; body: { reason: string }; params: { id: string }; response: PayrollDeduction };
    "GET /api/v1/payroll/statutory": { query: never; body: never; params: never; response: Statutory };
    "POST /api/v1/payroll/statutory/enable": { query: never; body: { effective_from: IsoDate }; params: never; response: Statutory };
    "GET /api/v1/payslips": { query: Q<{ scope?: "own" | "all"; year?: string; period?: string; status?: string }>; body: never; params: never; response: Paged<PayslipRow> };
    "GET /api/v1/payslips/summary": { query: { year?: string }; body: never; params: never; response: PayslipYear };
    "GET /api/v1/payslips/:id": { query: never; body: never; params: { id: string }; response: Payslip };
    "POST /api/v1/payslips/:id/email": { query: never; body: Record<string, never>; params: { id: string }; response: null };
    "GET /api/v1/payslips/deductions": { query: Q<{ scope?: "own" }>; body: never; params: never; response: Paged<DeductionRow> };
  }
}

export type { PayrollRun as _PayrollRun };
