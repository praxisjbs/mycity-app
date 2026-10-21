import type { DocumentRef, IsoDate, IsoDateTime, Money, Paged, PersonRef, Uuid } from "./common";
import type { BarRow } from "./home";
import type { Status, Step, Trail } from "./shared";

/** INTERIM Expenses shapes (owner LA; MILESTONES §13). One chain for every request (HANDOFF ruling 5). */
export type ExpenseStage = "line_manager" | "operations" | "requisition" | "ceo" | "approved" | "disbursed" | "rejected" | "returned" | "draft";
export interface ExpenseRow {
  request_id: Uuid;
  number: string;
  title: string;
  requester: PersonRef;
  category: string;
  amount: Money;
  stage: ExpenseStage;
  stage_status: Status;
  submitted_at: IsoDateTime;
  project: string | null;
}
export interface ExpenseDetail extends ExpenseRow {
  chain: Step[];
  chain_note: string;
  beneficiary: { name: string; bank: string; account_last4: string };
  invoice: DocumentRef | null;
  history: Trail[];
  can_approve: boolean;
  approve_as: string | null;
  requisition: string | null;
}
export interface ExpenseCreate {
  title: string;
  category_id: Uuid;
  amount: Money;
  project?: string;
  beneficiary_name: string;
  bank: string;
  account_number: string;
  invoice_document_id: Uuid;
}
export interface MineSummary {
  in_flight: number;
  disbursed_this_year: Money;
  average_turnaround: string;
  rejected: number;
  focus_id: Uuid | null;
}
export interface ApprovalsSummary {
  with_you: number;
  total_value: Money;
  oldest_days: number;
  approved_this_month: number;
  focus_id: Uuid | null;
}
export interface Requisition {
  requisition_id: Uuid;
  number: string;
  count: number;
  total: Money;
  submitted_on: IsoDate;
  approved_on: IsoDate | null;
  status: Status;
  can_approve: boolean;
}
export interface RequisitionDetail extends Requisition {
  items: ExpenseRow[];
}
export interface RequisitionsSummary {
  with_ceo: number;
  days_waiting: number;
  disbursed_this_year: Money;
  average_size: string;
  ready_to_group: number;
  focus_id: Uuid | null;
}
export interface Disbursement {
  disbursement_id: Uuid;
  number: string;
  beneficiary: string;
  bank: string;
  amount: Money;
  bank_reference: string;
  paid_on: IsoDate;
  status: Status;
}
export interface DisbursementsSummary {
  settled_this_month: Money;
  awaiting: number;
  average_days: string;
  missing_reference: number;
  trend: { labels: string[]; values: Money[] };
}
export interface Budgets {
  illustrative: boolean;
  year: number;
  lines: Array<{ department: string; budget: Money; actual: Money; variance: Money; pct: number; status: Status }>;
}
export interface Category {
  category_id: Uuid;
  name: string;
  kind: "Operating" | "Capital";
  flag_above: Money;
  this_month: Money;
  requests: number;
}
export interface CategoriesSummary {
  categories: number;
  spend_this_month: Money;
  requests: number;
  capital: number;
  by_category: BarRow[];
}

type Q<T = object> = T & { page?: number; q?: string };
declare module "@/api/endpoints" {
  interface Endpoints {
    "GET /api/v1/expenses/mine/summary": { query: never; body: never; params: never; response: MineSummary };
    "GET /api/v1/expenses/approvals/summary": { query: never; body: never; params: never; response: ApprovalsSummary };
    "GET /api/v1/expenses/requests": { query: Q<{ scope?: "mine" | "approvals" | "all"; stage?: ExpenseStage }>; body: never; params: never; response: Paged<ExpenseRow> };
    "GET /api/v1/expenses/requests/:id": { query: never; body: never; params: { id: string }; response: ExpenseDetail };
    "POST /api/v1/expenses/requests": { query: never; body: ExpenseCreate; params: never; response: ExpenseDetail };
    "POST /api/v1/expenses/requests/:id/approve": { query: never; body: Record<string, never>; params: { id: string }; response: ExpenseDetail };
    "POST /api/v1/expenses/requests/:id/reject": { query: never; body: { reason: string }; params: { id: string }; response: ExpenseDetail };
    "GET /api/v1/expenses/requisitions/summary": { query: never; body: never; params: never; response: RequisitionsSummary };
    "GET /api/v1/expenses/requisitions": { query: Q; body: never; params: never; response: Paged<Requisition> };
    "GET /api/v1/expenses/requisitions/:id": { query: never; body: never; params: { id: string }; response: RequisitionDetail };
    "POST /api/v1/expenses/requisitions": { query: never; body: { request_ids: Uuid[] }; params: never; response: RequisitionDetail };
    "POST /api/v1/expenses/requisitions/:id/approve": { query: never; body: { remove_ids: Uuid[] }; params: { id: string }; response: RequisitionDetail };
    "GET /api/v1/expenses/disbursements/summary": { query: never; body: never; params: never; response: DisbursementsSummary };
    "GET /api/v1/expenses/disbursements": { query: Q; body: never; params: never; response: Paged<Disbursement> };
    "POST /api/v1/expenses/disbursements": { query: never; body: { request_id: Uuid; bank_reference: string; paid_on: IsoDate }; params: never; response: Disbursement };
    "GET /api/v1/expenses/budgets": { query: never; body: never; params: never; response: Budgets };
    "GET /api/v1/expenses/categories/summary": { query: never; body: never; params: never; response: CategoriesSummary };
    "GET /api/v1/expenses/categories": { query: Q; body: never; params: never; response: Paged<Category> };
    "POST /api/v1/expenses/categories": { query: never; body: { name: string; kind: Category["kind"]; flag_above: Money }; params: never; response: Category };
  }
}
