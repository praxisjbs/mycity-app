import type { IsoDate, IsoDateTime, Paged, PersonRef, Tone, Uuid } from "./common";
import type { BarRow } from "./home";

/** INTERIM Performance shapes (owner TB; MILESTONES §7). Every status is worded by the API. */
export type Status = { tone: Tone; text: string };
export type Step = { label: string; state: "done" | "now" | null };
export type Trail = { title: string; when: IsoDateTime; text: string | null; tone: "hi" | "ok" | null };
export type GoalLevel = "organisational" | "annual";

export interface Goal {
  goal_id: Uuid;
  code: string | null;
  level: GoalLevel;
  theme: string | null;
  title: string;
  measure: string | null;
  baseline: string | null;
  owner: string;
  rolls_up_to: string | null;
  cascade_note: string | null;
  status: Status;
}
export interface GoalCreate {
  level: GoalLevel;
  title: string;
  theme?: string;
  measure?: string;
  baseline?: string;
  rolls_up_to?: Uuid;
}
export interface GoalsSummary {
  cascade: Step[];
  progress: BarRow[];
}
export interface Target {
  target_id: Uuid;
  month: string;
  department: string;
  title: string;
  rolls_up_to: string;
  set_by: PersonRef;
  measure: string;
  status: Status;
  can_approve: boolean;
}
export interface TargetsSummary {
  month: string;
  departments: number;
  approved: number;
  awaiting: number;
  chain: Step[];
  last_month: BarRow[];
  trail: Trail[];
}
export interface KpiAssignment {
  kpi_id: Uuid;
  employee: PersonRef;
  title: string;
  weight_pct: number;
  progress: string;
  set_by: PersonRef;
  status: Status;
}
export interface KpisSummary {
  with_kpis: number;
  staff: number;
  weights_valid: boolean;
  on_track: number;
  behind: number;
  sources: Array<{ label: string; count: number }>;
}
export interface EmployeeKpis {
  employee: PersonRef;
  items: Array<{ kpi_id: Uuid; title: string; weight_pct: number }>;
  total_pct: number;
}
export interface KpiAssign {
  employee_id: Uuid;
  month: string;
  items: Array<{ title: string; weight_pct: number }>;
}
export interface ReviewRow {
  review_id: Uuid;
  employee: PersonRef;
  cycle: string;
  self_rating: string | null;
  manager_rating: string | null;
  second_level: string | null;
  status: Status;
}
export interface ReviewsSummary {
  cycle: string;
  opens_on: IsoDate;
  last_cycle: string;
  average_rating: string;
  chain: Step[];
}
export interface PerformanceAnalytics {
  goals_on_track: string;
  reviews_completed: string;
  average_self: string;
  average_manager: string;
  completion: { labels: string[]; values: number[] };
  by_department: BarRow[];
  gap: Array<{ department: string; self: string; manager: string; gap: string }>;
  gap_cycle: string;
}

type Q<T = object> = T & { page?: number; q?: string };
declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/performance/goals/summary": { query: never; body: never; params: never; response: GoalsSummary };
    "GET /api/v1/performance/goals": { query: Q<{ level?: GoalLevel }>; body: never; params: never; response: Paged<Goal> };
    "POST /api/v1/performance/goals": { query: never; body: GoalCreate; params: never; response: Goal };
    "GET /api/v1/performance/targets/summary": { query: { month?: string }; body: never; params: never; response: TargetsSummary };
    "GET /api/v1/performance/targets": { query: Q<{ month?: string }>; body: never; params: never; response: Paged<Target> };
    "POST /api/v1/performance/targets": { query: never; body: { month: string; department: string; title: string; measure: string; rolls_up_to: Uuid }; params: never; response: Target };
    "POST /api/v1/performance/targets/:id/approve": { query: never; body: Record<string, never>; params: { id: string }; response: Target };
    "GET /api/v1/performance/kpis/summary": { query: never; body: never; params: never; response: KpisSummary };
    "GET /api/v1/performance/kpis": { query: Q<{ department?: string }>; body: never; params: never; response: Paged<KpiAssignment> };
    "GET /api/v1/performance/kpis/employees/:id": { query: never; body: never; params: { id: string }; response: EmployeeKpis };
    "POST /api/v1/performance/kpis/assign": { query: never; body: KpiAssign; params: never; response: EmployeeKpis };
    "GET /api/v1/performance/reviews/summary": { query: never; body: never; params: never; response: ReviewsSummary };
    "GET /api/v1/performance/reviews": { query: Q<{ cycle?: string }>; body: never; params: never; response: Paged<ReviewRow> };
    "POST /api/v1/performance/reviews/cycles": { query: never; body: { name: string; opens_on: IsoDate }; params: never; response: ReviewsSummary };
    "GET /api/v1/performance/analytics": { query: never; body: never; params: never; response: PerformanceAnalytics };
  }
}
