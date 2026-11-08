/**
 * Connect to Partner (docs/guides/workspace.md §6, §10.1; partnerships.md §6.16): on New Project, New
 * Task and New Event and their edits. Unpressed, the forms are as they were. Pressed, it shows Partner
 * (the partners and leads the person sees in Partnerships, leads marked, 25 at a time) and Deal (that
 * record's open and live deals); on work already connected, both with Disconnect. A person who may
 * not view Partnerships never sees the button; work connected to a record they cannot see says so.
 * The Partner filter on Tasks and Projects reads the same list.
 */
import { useState } from "react";
import type { PartnerLinkView } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { useInfinite } from "@/api/hooks";
import { useMe } from "@/auth/AuthProvider";
import { paging } from "@/features/shared/wire";
import { hrefFor } from "@/lib/routes";
import { Link } from "@/lib/router";
import { Button, Field, FilterSelect, SelectField } from "@mycity/ui";

export type PartnerLinkValue = { partner_id: string | null; lead_id: string | null; deal_id: string | null };
export const NO_LINK: PartnerLinkValue = { partner_id: null, lead_id: null, deal_id: null };
const KEYS = ["partner_id", "lead_id", "deal_id"] as const;

/** May the person connect work to a partner: they view Partnerships. */
export const useMayConnect = () => Boolean(useMe().grants.partnerships?.includes("view"));

/** The link a saved task, project or event carries, as the form holds it. */
export const linkOf = (view?: PartnerLinkView | null): PartnerLinkValue => (view ? { partner_id: view.partner_id, lead_id: view.lead_id, deal_id: view.deal_id } : NO_LINK);

/** What New Project, New Task and New Event send: the keys that are set. */
export const linkBody = (v: PartnerLinkValue) => ({
  ...(v.partner_id && { partner_id: v.partner_id }),
  ...(v.lead_id && { lead_id: v.lead_id }),
  ...(v.deal_id && { deal_id: v.deal_id }),
});

/** What an edit sends: the whole link when it changed (`null` disconnects), nothing otherwise. */
export const linkEdit = (before: PartnerLinkValue, now: PartnerLinkValue) =>
  KEYS.every((k) => before[k] === now[k]) ? {} : { partner_id: now.partner_id, lead_id: now.lead_id, deal_id: now.deal_id };

/** A refusal of the link from the server, on its field: the partner (or lead) or the deal. */
export function linkProblem(e: unknown): { record?: string; deal?: string } | null {
  if (!(e instanceof ApiError)) return null;
  const record = (e.fields.partner_id ?? e.fields.lead_id)?.[0];
  const deal = e.fields.deal_id?.[0];
  return record || deal ? { record, deal } : null;
}

/** A record as the Partner select holds it: `partner:<id>` or `lead:<id>`. */
const keyOf = (v: PartnerLinkValue) => (v.partner_id ? `partner:${v.partner_id}` : v.lead_id ? `lead:${v.lead_id}` : "");
const fromKey = (key: string): Pick<PartnerLinkValue, "partner_id" | "lead_id"> => {
  const [kind, id] = key.split(":");
  return { partner_id: kind === "partner" ? (id ?? null) : null, lead_id: kind === "lead" ? (id ?? null) : null };
};

/** The partners and leads to pick from, 25 at a time (F32), leads marked. */
function useRecordOptions() {
  const list = useInfinite("GET /api/v1/partnerships/work/records");
  const options = list.rows.map((r) => [`${r.kind}:${r.id}`, r.kind === "lead" ? `${r.name} · Lead` : r.name] as [string, string]);
  return { options, ...paging(list) };
}

/** Tasks' and Projects' Partner filter: every partner and lead the person sees, or all. */
export function PartnerFilter({ value, onChange }: { value: PartnerLinkValue; onChange: (v: PartnerLinkValue) => void }) {
  const records = useRecordOptions();
  return (
    <FilterSelect
      label="Partner"
      value={keyOf(value)}
      onChange={(key) => onChange(key ? { ...fromKey(key), deal_id: null } : NO_LINK)}
      options={[["", "All"], ...records.options]}
      more={records.more}
      onMore={records.onMore}
    />
  );
}

/** The filter as a list's query: `partner_id` or `lead_id`, or nothing. */
export const filterOf = (v: PartnerLinkValue) => ({ ...(v.partner_id && { partner_id: v.partner_id }), ...(v.lead_id && { lead_id: v.lead_id }) });

/** The record's open and live deals. */
function DealSelect({ value, onChange, valueLabel }: { value: PartnerLinkValue; onChange: (deal: string | null) => void; valueLabel?: string }) {
  const filters = value.partner_id ? { partner_id: value.partner_id } : { lead_id: value.lead_id ?? undefined };
  const list = useInfinite("GET /api/v1/partnerships/work/deals", { filters });
  return (
    <SelectField
      value={value.deal_id ?? ""}
      onChange={(v) => onChange(v || null)}
      options={[["", "None"], ...list.rows.map((d) => [d.deal_id, `${d.number} ${d.title}`] as [string, string])]}
      valueLabel={valueLabel}
      {...paging(list)}
    />
  );
}

/**
 * The fields themselves, for a form to place among its own.
 * @param view  the saved link as the server named it (an edit), so a record the person cannot see is said so
 */
export function PartnerLinkFields({
  value,
  onChange,
  view = null,
  problem = null,
}: {
  value: PartnerLinkValue;
  onChange: (v: PartnerLinkValue) => void;
  view?: PartnerLinkView | null;
  problem?: { record?: string; deal?: string } | null;
}) {
  const may = useMayConnect();
  const records = useRecordOptions();
  const connected = Boolean(value.partner_id || value.lead_id);
  const [shown, setShown] = useState(connected);
  const disconnect = () => {
    onChange(NO_LINK);
    setShown(false);
  };
  if (!connected && !shown) return may ? <Button icon="link" onClick={() => setShown(true)}>Connect to Partner</Button> : null;
  // Connected to a record the person may not see: kept as it is, or disconnected.
  const unseen = Boolean(view && !view.name && keyOf(linkOf(view)) === keyOf(value));
  if (unseen || !may) {
    return (
      <Field label="Partner">
        <div className="flex items-center justify-between gap-2">
          <span>A Partner You Cannot See</span>
          <Button size="sm" onClick={disconnect}>Disconnect</Button>
        </div>
      </Field>
    );
  }
  const named = view && keyOf(linkOf(view)) === keyOf(value) ? (view.lead_id ? `${view.name} · Lead` : view.name) : undefined;
  const dealNamed = view && view.deal_id && view.deal_id === value.deal_id ? `${view.deal_number} ${view.deal_title}` : undefined;
  return (
    <>
      <Field label="Partner" state={problem?.record ? "bad" : undefined} message={problem?.record}>
        <SelectField
          value={keyOf(value)}
          onChange={(key) => onChange({ ...fromKey(key), deal_id: null })}
          options={records.options}
          more={records.more}
          onMore={records.onMore}
          valueLabel={named}
        />
      </Field>
      {connected && (
        <Field label="Deal" optional state={problem?.deal ? "bad" : undefined} message={problem?.deal}>
          {/* Keyed by its record, so a new partner starts the list of deals again. */}
          <DealSelect key={keyOf(value)} value={value} valueLabel={dealNamed} onChange={(deal) => onChange({ ...value, deal_id: deal })} />
        </Field>
      )}
      <Button size="sm" onClick={disconnect}>Disconnect</Button>
    </>
  );
}

/** A task's or an event's Partner row: the record and its deal, opening its 360; or that it cannot be seen. */
export function PartnerLinkLine({ link }: { link: PartnerLinkView }) {
  if (!link.name) return <span>A Partner You Cannot See</span>;
  const to = hrefFor("partnerships", link.partner_id ? "partners" : "leads", { id: link.partner_id ?? link.lead_id });
  return (
    <span data-copy="content">
      <Link className="font-semibold text-primary underline" to={to}>{link.name}</Link>
      {link.deal_title && ` · ${link.deal_title}`}
    </span>
  );
}
