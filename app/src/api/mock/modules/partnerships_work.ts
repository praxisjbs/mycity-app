/**
 * Connect to Partner on the mock (docs/guides/partnerships.md §6.16; workspace.md §6): the link a
 * task, project or event carries, named as the API names it, its refusals, and Connect to Partner's
 * two pickers. A lead that has become a partner reads as its partner, as the API moves its work in
 * the conversion's transaction. The Work tab's own read lives with the work (workspace.ts).
 */
import type { PartnerLinkView } from "@mycity/contract/contract.gen.ts";
import { paged, route } from "../core";
import { categoryNameOf, dealOf, DEALS, recordOf, RECORDS } from "./partnerships";

export type LinkValue = { partner_id: string | null; lead_id: string | null; deal_id: string | null };
type Body = Record<string, unknown>;

const KEYS = ["partner_id", "lead_id", "deal_id"] as const;
const id = (v: unknown) => (typeof v === "string" && v ? v : null);

/** The link as it stands now: a converted lead's work is its partner's. */
export function current(link: LinkValue | null | undefined): LinkValue | null {
  if (!link || (!link.partner_id && !link.lead_id)) return null;
  const lead = link.lead_id ? recordOf(link.lead_id) : null;
  if (lead && lead.status === "converted" && lead.converted_partner_id) return { partner_id: lead.converted_partner_id, lead_id: null, deal_id: link.deal_id };
  return link;
}

/** The link on the way out, named (the mock's readers see every record). */
export function viewOf(link: LinkValue | null | undefined): PartnerLinkView | null {
  const now = current(link);
  if (!now) return null;
  const r = recordOf(now.partner_id ?? now.lead_id);
  const d = dealOf(now.deal_id);
  return { ...now, name: r?.name ?? null, number: r?.number ?? null, deal_number: d?.number ?? null, deal_title: d?.title ?? null };
}

/** What a create body names. */
export const linkFrom = (b: Body): LinkValue => ({ partner_id: id(b.partner_id), lead_id: id(b.lead_id), deal_id: id(b.deal_id) });

/** Does an edit body name the link at all. */
export const touches = (b: Body) => KEYS.some((k) => k in b);

/** The link an edit leaves: a new record clears the other and, unless one is given, the deal. */
export function merged(was: LinkValue | null, b: Body): LinkValue {
  const before = was ?? { partner_id: null, lead_id: null, deal_id: null };
  const out = { ...before };
  if ("partner_id" in b || "lead_id" in b) {
    const partner = "partner_id" in b ? id(b.partner_id) : id(b.lead_id) ? null : before.partner_id;
    const lead = "lead_id" in b ? id(b.lead_id) : id(b.partner_id) ? null : before.lead_id;
    if (partner !== before.partner_id || lead !== before.lead_id) Object.assign(out, { partner_id: partner, lead_id: lead, deal_id: "deal_id" in b ? id(b.deal_id) : null });
  }
  if ("deal_id" in b) out.deal_id = id(b.deal_id);
  if (!out.partner_id && !out.lead_id) out.deal_id = null;
  return out;
}

/** The API's refusals (partners.work checkLink), on their fields. */
export function problemOf(link: LinkValue): Record<string, string[]> | null {
  if (!link.partner_id && !link.lead_id) return link.deal_id ? { partner_id: ["Pick the partner first"] } : null;
  if (link.partner_id && link.lead_id) return { lead_id: ["A partner or a lead, not both"] };
  const r = recordOf(link.partner_id ?? link.lead_id);
  const takesWork = r && (r.kind === "partner" ? r.status !== "closed" : !["converted", "lost"].includes(r.status));
  if (!r || !takesWork || r.kind !== (link.partner_id ? "partner" : "lead")) return link.partner_id ? { partner_id: ["Not a partner you can see"] } : { lead_id: ["Not a lead you can see"] };
  if (!link.deal_id) return null;
  const d = dealOf(link.deal_id);
  const on = d && (link.partner_id ? d.partner_id === link.partner_id : d.lead_id === link.lead_id && !d.partner_id);
  return on && (d.status === "open" || d.status === "live") ? null : { deal_id: ["Not one of its open deals"] };
}

/** Does this item's link name the record a Partner filter asks for. */
export const linkedTo = (link: LinkValue | null | undefined, kind: "partner" | "lead", recordId: string) => {
  const now = current(link);
  return Boolean(now && now[kind === "partner" ? "partner_id" : "lead_id"] === recordId);
};

route("GET /api/v1/partnerships/work/records", (req) => {
  const { kind, ...query } = req.query;
  const rows = RECORDS.filter((r) => (r.kind === "partner" ? r.status !== "closed" : !["converted", "lost"].includes(r.status)))
    .filter((r) => !kind || r.kind === kind)
    .map((r) => ({ kind: r.kind, id: r.id, number: r.number, name: r.name, category: categoryNameOf(r.category_id) }));
  return paged(rows, { ...req, query }, { search: (r) => [r.name, r.number], sort: { name: (a, b) => a.name.localeCompare(b.name) } });
});

route("GET /api/v1/partnerships/work/deals", (req) => {
  const { partner_id: partnerId, lead_id: leadId, ...query } = req.query;
  const rows = DEALS.filter((d) => (d.status === "open" || d.status === "live") && (partnerId ? d.partner_id === partnerId : leadId ? d.lead_id === leadId && !d.partner_id : true))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((d) => ({ deal_id: d.id, number: d.number, title: d.title, status: d.status as "open" | "live", record_name: recordOf(d.partner_id ?? d.lead_id)?.name ?? "" }));
  return paged(rows, { ...req, query }, { search: (d) => [d.title, d.number] });
});
