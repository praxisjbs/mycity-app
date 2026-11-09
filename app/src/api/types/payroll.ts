import type { IsoDate, Money, Paged, PersonRef, Tone, Uuid } from "./common";

/**
 * INTERIM payroll shapes (owner TB, M6) for what the contract does not declare yet. Payroll runs are on the
 * contract since M6 PR 2 (packages/contract/schemas/payroll.js) and payslips since PR 4 (payslips.js); deductions,
 * grades and statutory follow with PR 3 and PR 5, and their entries go here as they land (npm run contract:status).
 */
type Pill = { tone: Tone; text: string };

type Q<T = object> = T & { page?: number; q?: string };

/* ── Payroll module (owner TB, M6) ── */
type Status = Pill;
type Step = { label: string; state: "done" | "now" | null };
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
  }
}
