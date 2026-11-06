import { ApiError } from "@/api/client";
import type { PersonRef } from "@/api/types/common";
import { useAuth } from "@/auth/AuthProvider";
import { hasCapability } from "@/shell/access";
import { toast, type DocumentEditorField } from "@mycity/ui";
import type { ChecklistItem, Field, RecordField, TemplateAsk } from "@mycity/contract/contract.gen.ts";

/** Wiring the Partnerships screens share: a failed request's message, a short name, a select's options. */
export const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : "Something went wrong");
export const short = (p: PersonRef) => {
  const [a, b] = p.display_name.split(" ");
  return `${a} ${b?.[0] ?? ""}.`;
};
export const opts = (l: string[]): Array<[string, string]> => l.map((x) => [x, x]);

/**
 * May this reader change the pipeline's setup: `partnerships` edit and the `partnerships.configure` capability,
 * which the API asks for (docs/guides/partnerships.md §8). Hiding a button is a courtesy; the API refuses the rest.
 */
export function useConfigure() {
  const { me, can } = useAuth();
  return !!me && can("partnerships", "edit") && hasCapability(me, "partnerships.configure");
}

/** What a refusal says: the API's words, or a plain retry when the server could not be reached. */
export const refusal = (e: unknown, fallback: string) => (e instanceof ApiError && e.status !== 0 && e.message ? e.message : fallback);

export const KIND_LABEL = {
  deal_merchant: "Deal Merchant",
  mou: "MOU",
  service_agreement: "Service Agreement",
  contract: "Contract",
} as const;

export const MEANING_LABEL = {
  prospect: "Prospect",
  contacted: "Contacted",
  meeting: "Meeting",
  proposal: "Proposal",
  negotiation: "Negotiation",
  signed: "Signed",
  active: "Active",
  closed_lost: "Closed Lost",
  on_hold: "On Hold",
} as const;

export const FIELD_TYPE_LABEL = {
  text: "Text",
  long_text: "Long Text",
  number: "Number",
  money: "Money",
  date: "Date",
  pick: "Pick One",
  multi_pick: "Pick Many",
  yes_no: "Yes or No",
  url: "Link",
} as const;

export const APPLIES_LABEL = { lead: "Leads", partner: "Partners", deal: "Deals" } as const;

/** When a checklist item falls due, as a person reads it. */
export function dueText(i: Pick<ChecklistItem, "due_from" | "due_days">): string {
  if (i.due_from === "signing") return i.due_days === 0 ? "On signing" : `${i.due_days} ${i.due_days === 1 ? "day" : "days"} after signing`;
  return i.due_days === 0 ? "On the event's first day" : `${i.due_days} ${i.due_days === 1 ? "day" : "days"} before the event`;
}

/** The house format a value of this type is written with in a template (shared/documents/render.js). */
const HELPER: Record<string, string> = { date: "longdate", money: "money", number: "number" };

/** `{{ longdate deal.valid_until }}`: the words a field's chip keeps in the wording. */
export const tagOf = (field: string, type: string) => (HELPER[type] ? `{{ ${HELPER[type]} ${field} }}` : `{{ ${field} }}`);

const GROUP: Record<string, string> = {
  today: "Agreement",
  org: "Agreement",
  partner: "Partner",
  contact: "Contact",
  deal: "Deal",
  category: "Deal",
  signer: "Signing",
  custom: "Custom",
  ask: "Ask",
};

/** Every value a template of one category may name, for the editor's Insert Field: the record's, the category's own and the asks. */
export function editorFields(record: RecordField[], custom: Field[], asks: TemplateAsk[]): DocumentEditorField[] {
  const out: DocumentEditorField[] = record.map((r) => ({ field: r.field, label: r.label, tag: tagOf(r.field, r.type), group: GROUP[r.field.split(".")[0]] }));
  for (const f of custom)
    if (f.active) out.push({ field: `custom.${f.key}`, label: f.label, tag: tagOf(`custom.${f.key}`, f.field_type), group: "Custom" });
  for (const a of asks) out.push({ field: `ask.${a.key}`, label: a.label, tag: tagOf(`ask.${a.key}`, a.type), group: "Ask" });
  return out;
}
