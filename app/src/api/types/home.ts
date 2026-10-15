import type { IsoDate, IsoDateTime, Money, Paged, PersonRef, Tone, Uuid } from "./common";

/**
 * INTERIM Home shapes (owner TB; docs/guides/home.md §5). The overview is the
 * role's layout over the KPI catalogue, resolved by the server: a list of
 * blocks the screen renders in order. Nothing in the layout is decided here.
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

export interface NeedYouRow {
  id: Uuid;
  title: string;
  from: PersonRef | null;
  amount: Money | null;
  quiet_days?: number | null;
  stage: { tone: Tone; text: string };
  link: string;
}

export type HomeBlock =
  | { type: "kpis"; items: HomeKpi[] }
  | { type: "statstrip"; items: Array<{ label: string; value: string; tone?: Tone }> }
  | { type: "split"; cols: "1.4/1" | "2"; blocks: HomeBlock[] }
  | { type: "area"; title: string; values: number[]; labels?: string[]; note?: string }
  | { type: "donut"; pct: number; label: string; text: string }
  | { type: "bars"; title: string; rows: BarRow[]; note?: string; info?: string }
  | { type: "need_you"; title: string; badge: { tone: Tone; text: string }; variant: "requests" | "partnerships"; rows: NeedYouRow[] }
  | { type: "activity"; title: string; items: Array<{ title: string; when: string; text?: string; tone?: "hi" | "ok" }> }
  | { type: "week"; title: string; range: string; days: Array<{ day: string; text: string; kind: "diary" | "task" | "note" }> }
  | { type: "list"; title: string; info?: string; rows: Array<{ label: string; text: string; pill: { tone: Tone; text: string } }> }
  | { type: "note"; text: string };

export interface HomeOverview {
  greeting: string;
  subtitle: string;
  blocks: HomeBlock[];
}

/** A KPI card's report model: the records behind the number. */
export interface KpiDetailMeta {
  key: string;
  title: string;
  sub: string | null;
  columns: Array<{ key: string; label: string; align?: "n" }>;
  /** Server-side groups shown as chips ("On Site", "Remote"…), each with its count. */
  groups: Array<{ value: string; label: string; count: number }>;
}
export type KpiCell =
  | { kind: "text"; text: string }
  | { kind: "person"; person: PersonRef }
  | { kind: "pill"; tone: Tone; text: string }
  | { kind: "money"; amount: Money }
  | { kind: "date"; date: IsoDate }
  | { kind: "over"; text: string }
  | { kind: "bar"; pct: number; text: string };
export interface KpiRow {
  id: string;
  cells: Record<string, KpiCell>;
  link: string | null;
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
    "GET /api/v1/home/overview": { query: never; body: never; params: never; response: HomeOverview };
    "GET /api/v1/home/kpi/:key/meta": { query: never; body: never; params: { key: string }; response: KpiDetailMeta };
    "GET /api/v1/home/kpi/:key": { query: Q<{ group?: string }>; body: never; params: { key: string }; response: Paged<KpiRow> };
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
