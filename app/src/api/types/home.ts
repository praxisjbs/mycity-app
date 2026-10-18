import type { IsoDateTime, Paged, Tone, Uuid } from "./common";

/**
 * INTERIM Home shapes for the tab not yet on the real API (owner TB; docs/guides/home.md
 * §5): Reports. The Overview, the records behind a card, the card picker, Team and Alerts
 * are on the contract (packages/contract/schemas/dashboard.js, alerts.js) and are typed from
 * contract.gen.ts; Reports' own PR moves its keys there and deletes them here.
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
    "GET /api/v1/home/reports": { query: Q; body: never; params: never; response: Paged<HomeReport> };
    "GET /api/v1/home/reports/summary": { query: never; body: never; params: never; response: ReportSummary };
    "POST /api/v1/home/reports": { query: never; body: ReportBody; params: never; response: HomeReport };
    "POST /api/v1/home/reports/:id/run": { query: never; body: { format: "pdf" | "xlsx" }; params: { id: string }; response: ReportRun };
    "GET /api/v1/home/report-runs": { query: Q; body: never; params: never; response: Paged<ReportRun> };
  }
}
