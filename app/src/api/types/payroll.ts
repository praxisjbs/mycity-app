import type { IsoDate, Money, Paged, Tone, Uuid } from "./common";

/**
 * INTERIM payroll shapes (owner TB, M6) for what the contract does not declare yet. Payroll runs are on the
 * contract since M6 PR 2 (packages/contract/schemas/payroll.js), deductions since PR 3 and payslips since PR 4;
 * grades and statutory follow with PR 5, and their entries go here as they land (npm run contract:status).
 */
type Pill = { tone: Tone; text: string };

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
    "GET /api/v1/payroll/grades/summary": { query: never; body: never; params: never; response: GradesSummary };
    "GET /api/v1/payroll/grades": { query: Q; body: never; params: never; response: Paged<Grade> };
    "POST /api/v1/payroll/grades": { query: never; body: { code: string; band: string; minimum: Money; midpoint: Money; maximum: Money; effective_from: IsoDate }; params: never; response: Grade };
    "GET /api/v1/payroll/statutory": { query: never; body: never; params: never; response: Statutory };
    "POST /api/v1/payroll/statutory/enable": { query: never; body: { effective_from: IsoDate }; params: never; response: Statutory };
  }
}
