import type { IsoDateTime, Paged, PersonRef, Tone, Uuid } from "./common";

/**
 * INTERIM Home shapes for the tabs not yet on the real API (owner TB; docs/guides/home.md
 * §5): Team, Alerts and Reports. The Overview, the records behind a card and the card
 * picker are on the contract (packages/contract/schemas/dashboard.js) and are typed from
 * contract.gen.ts; each tab's own PR moves its keys there and deletes them here.
 */
export interface HomeKpi {
  key: string;
  label: string;
  value: string;
  tone?: Tone;
  trend?: { text: string; dir: "up" | "dn" | "fl" };
}

export interface BarRow {
  label: string;
  pct: number;
  value: string;
  /** "warn" draws the bar in the warning series, "brand" in yellow. */
  emphasis?: "warn" | "brand";
}

export interface TeamRow {
  employee: PersonRef;
  today: { tone: Tone; text: string };
  mode: string;
  clock_in: string | null;
  kpi_pct: number;
  open_tasks: number;
}
export interface TeamSummary {
  scope_label: string;
  kpis: HomeKpi[];
  attendance_bars: BarRow[];
}

export interface HomeAlert {
  home_alert_id: Uuid;
  title: string;
  trigger: string;
  category: "attendance" | "partnership" | "approval" | "document" | "people" | "budget" | "payroll" | "recruitment";
  who_clears: string;
  age: string;
  over_by: string;
  severity: "low" | "medium" | "high";
  raised_at: IsoDateTime;
  link: string | null;
}
export interface AlertSummary {
  kpis: HomeKpi[];
  sources: BarRow[];
  categories: Array<{ value: string; label: string; count: number }>;
}
export interface AlertRule {
  home_alert_rule_id: Uuid;
  name: string;
  metric: string;
  example: string;
  threshold: number;
  window_days: number;
  severity: "low" | "medium" | "high";
  enabled: boolean;
}
export interface AlertRuleBody {
  name: string;
  metric: string;
  threshold: number;
  window_days: number;
  severity: "low" | "medium" | "high";
}

export interface HomeReport {
  home_report_id: Uuid;
  name: string;
  cadence: string;
  status: "scheduled" | "paused" | "on_demand";
  audience: string;
}
export interface ReportRun {
  run_id: Uuid;
  number: string;
  report: string;
  run_at: IsoDateTime;
  recipients: string;
  formats: string;
}
export interface ReportSummary {
  kpis: HomeKpi[];
}
export interface ReportBody {
  name: string;
  source: string;
  schedule: string;
  formats: string[];
  recipients: string;
}

type Q<T = object> = T & { page?: number; q?: string };

declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/home/team": { query: Q<{ status?: string }>; body: never; params: never; response: Paged<TeamRow> };
    "GET /api/v1/home/team/summary": { query: never; body: never; params: never; response: TeamSummary };
    "GET /api/v1/home/alerts": { query: Q<{ category?: string }>; body: never; params: never; response: Paged<HomeAlert> };
    "GET /api/v1/home/alerts/summary": { query: never; body: never; params: never; response: AlertSummary };
    "POST /api/v1/home/alerts/:id/clear": { query: never; body: { outcome: "cleared" | "dismissed"; note?: string }; params: { id: string }; response: HomeAlert };
    "GET /api/v1/home/alert-rules": { query: Q; body: never; params: never; response: Paged<AlertRule> };
    "POST /api/v1/home/alert-rules": { query: never; body: AlertRuleBody; params: never; response: AlertRule };
    "PATCH /api/v1/home/alert-rules/:id": { query: never; body: Partial<AlertRuleBody> & { enabled?: boolean }; params: { id: string }; response: AlertRule };
    "GET /api/v1/home/reports": { query: Q; body: never; params: never; response: Paged<HomeReport> };
    "GET /api/v1/home/reports/summary": { query: never; body: never; params: never; response: ReportSummary };
    "POST /api/v1/home/reports": { query: never; body: ReportBody; params: never; response: HomeReport };
    "POST /api/v1/home/reports/:id/run": { query: never; body: { format: "pdf" | "xlsx" }; params: { id: string }; response: ReportRun };
    "GET /api/v1/home/report-runs": { query: Q; body: never; params: never; response: Paged<ReportRun> };
  }
}
