import type { DealDetail, DealRow, LeadRow, ListValue, PartnerRow } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { useApi, useInfinite } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { paging } from "@/features/shared/wire";
import { hasCapability } from "@/shell/access";
import { toast } from "@mycity/ui";

/**
 * Wiring the Partnerships screens share (docs/guides/partnerships.md §10): MyCity's lists and
 * categories as options, the pills a lead, a partner and a deal show, and how a refusal lands.
 * Never a rule of the API's: the screens show what it decided.
 */

/** A person's first name and initial, for a narrow column (Contracts & MOUs, on the mock until M7 PR 6). */
export const short = (p: { display_name: string }) => {
  const [a, b] = p.display_name.split(" ");
  return `${a} ${b?.[0] ?? ""}.`;
};

/** A refusal in a toast: its own words, or a plain line. */
export const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : "Something went wrong");

/**
 * A save that failed: on the fields of this form when the API named them (a nested request's
 * `contact.email` lands on a contact form's `email` with `prefix`), otherwise in a toast.
 */
export function failed(f: { values: object; setServerErrors: (x: Record<string, string[]>) => void }, prefix = "") {
  return (e: unknown) => {
    const fields = e instanceof ApiError ? (e.fields ?? {}) : {};
    const mine: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(fields)) {
      const key = prefix ? (k.startsWith(prefix) ? k.slice(prefix.length) : null) : k;
      if (key !== null && key in f.values) mine[key] = v;
    }
    if (Object.keys(mine).length) f.setServerErrors(mine);
    else toast(e instanceof ApiError ? e.message : "Not saved");
  };
}

/** May the reader see and enter commission and returns (`partnerships.money`, §6.1)? */
export function useHoldsMoney() {
  const { me } = useAuth();
  return !!me && hasCapability(me, "partnerships.money");
}

/** May the reader do this in Partnerships (their grant)? */
export function useMay(action: "create" | "edit") {
  const { me } = useAuth();
  return !!me?.grants.partnerships?.includes(action);
}

/** MyCity's stages in order, the active ones a deal may move to (§6.3). */
export function useStages(): { stages: ListValue[]; all: ListValue[]; loading: boolean } {
  const list = useApi("GET /api/v1/partnerships/lists/:list", { params: { list: "partnership_stage" } });
  const all = list.data?.values ?? [];
  return { stages: all.filter((s) => s.active && s.meaning), all, loading: list.loading };
}

/** One of MyCity's other lists (sources, impact, document kinds) as options. */
export function useListOptions(list: "lead_source" | "partnership_impact" | "partner_document_kind"): Array<[string, string]> {
  const values = useApi("GET /api/v1/partnerships/lists/:list", { params: { list } });
  return (values.data?.values ?? []).filter((v) => v.active).map((v) => [v.code, v.label] as [string, string]);
}

/** The categories as options, 25 at a time as the menu nears its end (F32). */
export function useCategoryOptions() {
  const list = useInfinite("GET /api/v1/partnerships/categories", { filters: { active: "true" } });
  return { options: list.rows.map((c) => [c.partner_category_id, c.name] as [string, string]), ...paging(list) };
}

/** A stage's place in the list; a move to an earlier one, On Hold or Closed Lost needs a reason (§6.5). */
export function moveNeeds(stages: ListValue[], deal: Pick<DealDetail, "stage" | "signed_at">, code: string) {
  const from = stages.find((s) => s.code === deal.stage);
  const to = stages.find((s) => s.code === code);
  const back = !!from && !!to && from.meaning !== "on_hold" && to.position < from.position;
  const signs = !!to && (to.meaning === "signed" || to.meaning === "active") && !deal.signed_at;
  return { to, reason: back || to?.meaning === "on_hold" || to?.meaning === "closed_lost", copy: signs };
}

/** The stage after the current one, for the phone's Next Stage at the foot of a record. */
export function nextStage(stages: ListValue[], code: string): ListValue | null {
  const open = stages.filter((s) => s.meaning !== "closed_lost" && s.meaning !== "on_hold");
  const i = open.findIndex((s) => s.code === code);
  return i >= 0 && i < open.length - 1 ? open[i + 1] : i < 0 ? (open[0] ?? null) : null;
}

type Tone = "ok" | "warn" | "err" | "info" | "neutral";
export const HEALTH: Record<DealRow["health"], { label: string; tone: Tone }> = {
  on_track: { label: "On Track", tone: "ok" },
  follow_up_required: { label: "Follow-up Required", tone: "warn" },
  stalled: { label: "Stalled", tone: "err" },
};
export const healthPill = (h: DealRow["health"] | null | undefined) => (h ? { tone: HEALTH[h].tone, text: HEALTH[h].label } : null);

const LEAD_STATUS: Record<LeadRow["status"], { label: string; tone: Tone }> = {
  new: { label: "New", tone: "info" },
  contacted: { label: "Contacted", tone: "info" },
  qualified: { label: "Qualified", tone: "warn" },
  lost: { label: "Lost", tone: "neutral" },
  converted: { label: "Converted", tone: "ok" },
};
export const leadPill = (s: LeadRow["status"]) => ({ tone: LEAD_STATUS[s].tone, text: LEAD_STATUS[s].label });

const PARTNER_STATUS: Record<PartnerRow["status"], { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "ok" },
  dormant: { label: "Dormant", tone: "neutral" },
  closed: { label: "Closed", tone: "err" },
};
export const partnerPill = (s: PartnerRow["status"]) => ({ tone: PARTNER_STATUS[s].tone, text: PARTNER_STATUS[s].label });

const DEAL_STATUS: Record<DealRow["status"], { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "info" },
  live: { label: "Live", tone: "ok" },
  completed: { label: "Completed", tone: "neutral" },
  lost: { label: "Lost", tone: "neutral" },
};
export const dealPill = (s: DealRow["status"]) => ({ tone: DEAL_STATUS[s].tone, text: DEAL_STATUS[s].label });

/** The region scopes a form offers (§6.3); `cities` asks for the cities. */
export const SCOPES: Array<["cities" | "national" | "africa" | "worldwide", string]> = [
  ["cities", "Cities"],
  ["national", "National"],
  ["africa", "Africa"],
  ["worldwide", "Worldwide"],
];

/** Days as a person reads them. */
export const daysWord = (n: number | null | undefined) => (n === null || n === undefined ? "None" : n === 0 ? "Today" : n === 1 ? "1 day" : `${n} days`);

/** Where a record opens: a lead's 360 or a partner's, beside its list. */
export const recordHref = (r: { type: "lead" | "partner"; id: string }) => `/partnerships?tab=${r.type === "lead" ? "leads" : "partners"}&id=${r.id}`;
