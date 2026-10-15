import type { IsoDate, IsoDateTime, Money, Paged, PersonRef, Uuid } from "./common";
import type { BarRow } from "./home";
import type { Status, Step, Trail } from "./performance";

/** INTERIM Queries & Sanctions shapes (owner AJ; MILESTONES §8). Managers see their own; People and the CEO see all. */
export interface QueryRow {
  query_id: Uuid;
  number: string;
  employee: PersonRef;
  subject: string;
  /** A person's name, or "System rule" when a rule raised it. */
  raised_by: string;
  raised_on: IsoDate;
  response: string | null;
  status: Status;
}
export interface QueryDetail extends QueryRow {
  raised_at: IsoDateTime;
  respond_by: IsoDateTime | null;
  instances: string[];
  letter: string;
  response_text: string | null;
  can_decide: boolean;
  can_remind: boolean;
}
export interface QueriesSummary {
  open: number;
  awaiting_response: number;
  closed_this_month: number;
  escalated: number;
  by_reason: BarRow[];
  by_reason_note: string;
  focus_id: Uuid | null;
}
export type Outcome = "no_action" | "caution" | "warning" | "suspension" | "suspension_without_pay" | "dismissal";
export interface QueryCreate {
  employee_id: Uuid;
  subject: string;
  details: string;
}
export interface QueryDecision {
  outcome: Outcome;
  note: string;
  fine_amount?: Money;
}
export interface Rule {
  rule_id: Uuid;
  name: string;
  description: string;
  threshold: string | null;
  status: Status;
}
export interface RulesSummary {
  active: number;
  draft: number;
  fired_this_month: number;
  queries_raised: number;
}
export interface Firing {
  firing_id: Uuid;
  rule: string;
  fired_at: IsoDateTime;
  employee: PersonRef;
  outcome: Status;
}
export interface RuleCreate {
  name: string;
  trigger: "lateness" | "missing_clock_out" | "unenrolled_device" | "absence" | "overdue_task" | "missed_kpi";
  count: number;
  window_days: number;
  template_id: Uuid;
}
export interface SanctionRow {
  sanction_id: Uuid;
  employee: PersonRef;
  kind: string;
  reason: string;
  issued_by: string;
  date: IsoDate;
  amount: Money | null;
  status: Status;
}
export interface SanctionsSummary {
  active: number;
  served: number;
  financial_this_year: Money;
  recovered: Money;
  focus: { title: string; status: Status; chain: Step[] } | null;
  activity: Trail[];
}
export interface SanctionCreate {
  employee_id: Uuid;
  kind: Exclude<Outcome, "no_action"> | "fine";
  reason: string;
  amount?: Money;
}
export interface LetterTemplate {
  template_id: Uuid;
  name: string;
  used_for: string;
  status: Status;
}
export interface TemplatesSummary {
  templates: number;
  active: number;
  awaiting: number;
  sent_90d: number;
  languages: string;
}
/** A letter as the document engine fills it. `filled` marks the words that came from the record. */
export interface LetterPreview {
  reference: string;
  title: string;
  date_line: string;
  paragraphs: Array<Array<{ text: string; filled?: boolean }>>;
  signer: string;
  signer_role: string;
  fields_note: string;
}

type Q<T = object> = T & { page?: number; q?: string };
declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/queries/summary": { query: never; body: never; params: never; response: QueriesSummary };
    "GET /api/v1/queries": { query: Q<{ scope?: "mine" | "all"; status?: "open" | "closed" }>; body: never; params: never; response: Paged<QueryRow> };
    "GET /api/v1/queries/:id": { query: never; body: never; params: { id: string }; response: QueryDetail };
    "POST /api/v1/queries": { query: never; body: QueryCreate; params: never; response: QueryDetail };
    "POST /api/v1/queries/:id/remind": { query: never; body: Record<string, never>; params: { id: string }; response: QueryDetail };
    "POST /api/v1/queries/:id/decision": { query: never; body: QueryDecision; params: { id: string }; response: QueryDetail };
    "GET /api/v1/queries/:id/letter": { query: never; body: never; params: { id: string }; response: LetterPreview };
    "GET /api/v1/queries/rules/summary": { query: never; body: never; params: never; response: RulesSummary };
    "GET /api/v1/queries/rules": { query: Q; body: never; params: never; response: Paged<Rule> };
    "POST /api/v1/queries/rules": { query: never; body: RuleCreate; params: never; response: Rule };
    "POST /api/v1/queries/rules/:id/activate": { query: never; body: Record<string, never>; params: { id: string }; response: Rule };
    "GET /api/v1/queries/rules/firings": { query: Q; body: never; params: never; response: Paged<Firing> };
    "GET /api/v1/queries/sanctions/summary": { query: never; body: never; params: never; response: SanctionsSummary };
    "GET /api/v1/queries/sanctions": { query: Q; body: never; params: never; response: Paged<SanctionRow> };
    "POST /api/v1/queries/sanctions": { query: never; body: SanctionCreate; params: never; response: SanctionRow };
    "GET /api/v1/queries/templates/summary": { query: never; body: never; params: never; response: TemplatesSummary };
    "GET /api/v1/queries/templates": { query: Q; body: never; params: never; response: Paged<LetterTemplate> };
    "GET /api/v1/queries/templates/:id/preview": { query: never; body: never; params: { id: string }; response: LetterPreview };
    "POST /api/v1/queries/templates": { query: never; body: { name: string; used_for: string; body: string }; params: never; response: LetterTemplate };
  }
}
