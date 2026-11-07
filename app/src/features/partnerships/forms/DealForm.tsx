import type { DealDetail, PersonRef } from "@mycity/contract/contract.gen.ts";
import pipeline from "@mycity/contract/schemas/partner_pipeline.js";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import { placeValue } from "@/features/shared/places";
import { Button, FormFooter, toast, useContractForm, Wizard } from "@mycity/ui";
import { failed, useCategoryDefaults, useFieldDefs, useHoldsMoney, useStages } from "../lib";
import { customForEdit, DealPart, dealBody, dealStart, optionsOnWire, optionsStart, useMeAsPerson, validityOnWire, validityStart, type Bound, type CustomDraft, type OptionDraft } from "./parts";

const orNull = (v: unknown) => (v === "" || v === undefined ? null : v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * New Deal on a partner, and Edit Deal (docs/guides/partnerships.md §6.5, §6.6, §10.1): the deal's own
 * fields with its Deal Options, and behind Advanced its impact, commission (with
 * `partnerships.money`), validity, team and custom fields, checked by DealFields as they are filled.
 * New Deal opens at the first stage unless an open one is picked; the stage itself moves on the
 * switcher, never here. `categoryId` is the deal's lead's or partner's category: its defaults and
 * its custom fields.
 */
export function DealForm({ close, partnerId, deal, categoryId }: { close: () => void; partnerId?: string; deal?: DealDetail; categoryId?: string | null }) {
  const me = useMeAsPerson();
  const money = useHoldsMoney();
  const { stages } = useStages();
  // Opened from a duplicate's New Deal, the form knows the partner, not its category.
  const partner = useApi("GET /api/v1/partnerships/partners/:id", { params: { id: partnerId ?? "" }, enabled: categoryId === undefined && Boolean(partnerId) });
  const category = categoryId ?? partner.data?.partner.partner_category_id ?? null;
  const defaults = useCategoryDefaults(category);
  const defs = useFieldDefs("deal", category);
  const open = stages.filter((s) => !["signed", "active", "closed_lost"].includes(s.meaning ?? ""));
  const team = (deal?.members ?? []).filter((m) => m.role !== "owner").map((m) => m.employee as PersonRef);
  const start = deal
    ? {
        ...dealStart(deal.stage, deal.owner?.employee_id ?? ""),
        title: deal.title,
        objective: deal.objective ?? "",
        estimated_value: deal.estimated_value ?? "",
        expected_close_on: deal.expected_close_on ?? "",
        event_starts_on: deal.event_starts_on ?? "",
        event_ends_on: deal.event_ends_on ?? "",
        venue: placeValue(deal.venue),
        event_title: deal.event_title ?? "",
        expected_attendance: deal.expected_attendance === null ? "" : String(deal.expected_attendance),
        next_action: deal.next_action ?? "",
        next_action_on: deal.next_action_on ?? "",
        comments: deal.comments ?? "",
        owner_id_person: deal.owner ? [deal.owner] : [],
        impact: deal.impact,
        impact_rating: deal.impact_rating ?? "",
        impact_note: deal.impact_note ?? "",
        commission_pct: deal.commission_pct ?? "",
        ...validityStart(deal),
        member_ids: team.map((p) => p.employee_id),
        member_ids_person: team,
        options: optionsStart(deal),
        custom: { ...deal.custom } as CustomDraft,
      }
    : dealStart(open[0]?.code ?? "", me?.employee_id ?? "");
  const f = useContractForm(start, pipeline.DealFields);
  const create = useMutation("POST /api/v1/partnerships/deals");
  const edit = useMutation("PATCH /api/v1/partnerships/deals/:id");
  const submit = async () => {
    const v = f.values as Record<string, unknown>;
    try {
      if (deal) {
        // Edit Deal: a field emptied is cleared (null); the terms are sent only when they changed; the stage moves on the switcher.
        const changes: Record<string, unknown> = {};
        for (const k of ["title", "objective", "estimated_value", "expected_close_on", "event_starts_on", "event_ends_on", "event_title", "next_action", "next_action_on", "comments", "owner_id", "impact_rating", "impact_note"]) changes[k] = orNull(v[k]);
        changes.expected_attendance = v.expected_attendance === "" ? null : Number(v.expected_attendance);
        changes.venue = v.venue ?? null;
        if (!changes.owner_id) delete changes.owner_id;
        if (!same(v.impact, start.impact)) changes.impact = v.impact;
        if (money && v.commission_pct !== start.commission_pct) changes.commission_pct = orNull(v.commission_pct);
        if (v.validity_kind !== start.validity_kind || v.validity_until !== start.validity_until) changes.validity = validityOnWire(v);
        if (!same(v.member_ids, start.member_ids)) changes.member_ids = v.member_ids;
        if (!same(v.options, start.options)) changes.options = optionsOnWire(v.options as OptionDraft[], money);
        const custom = customForEdit(defs, v.custom as CustomDraft, deal.custom);
        if (custom) changes.custom = custom;
        await edit.run({ params: { id: deal.deal_id }, body: changes as never });
        toast("Deal saved");
      } else {
        const body: Record<string, unknown> = { ...dealBody(v, { money, custom: defs }), partner_id: partnerId };
        if (!open.some((s) => s.code === body.stage)) delete body.stage;
        await create.run({ body: body as never });
        toast("Deal opened");
      }
      invalidate("/api/v1/partnerships");
      close();
    } catch (e) {
      failed(f)(e);
    }
  };
  const steps = (
    <DealPart
      f={f as unknown as Bound}
      stages={deal ? stages.filter((s) => s.code === deal.stage) : open}
      owner={deal ? (deal.owner ?? null) : me}
      terms={{ options: true, money, categoryRate: defaults?.commission ?? null, custom: defs, validityNone: deal ? "None" : "Category Default" }}
    />
  );
  if (deal)
    return (
      <>
        {steps}
        <FormFooter>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={() => (f.check() ? submit() : undefined)}>Save Deal</Button>
        </FormFooter>
      </>
    );
  return <Wizard finish="Open Deal" busy={create.pending} onFinish={submit} onCancel={close} steps={[{ title: "Deal", check: () => f.check(), body: steps }]} />;
}
