import type { DealDetail } from "@mycity/contract/contract.gen.ts";
import pipeline from "@mycity/contract/schemas/partner_pipeline.js";
import { invalidate, useMutation } from "@/api/hooks";
import { placeValue } from "@/features/shared/places";
import { Button, FormFooter, toast, useContractForm, Wizard } from "@mycity/ui";
import { failed, useStages } from "../lib";
import { DealPart, dealBody, dealStart, useMeAsPerson, type Bound } from "./parts";

/**
 * New Deal on a partner, and Edit Deal (docs/guides/partnerships.md §6.5, §6.6, §10.1): the deal's own
 * fields, checked by DealFields as they are filled. New Deal opens at the first stage unless an open
 * one is picked; the stage itself moves on the switcher, never here.
 */
export function DealForm({ close, partnerId, deal }: { close: () => void; partnerId?: string; deal?: DealDetail }) {
  const me = useMeAsPerson();
  const { stages } = useStages();
  const open = stages.filter((s) => !["signed", "active", "closed_lost"].includes(s.meaning ?? ""));
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
      }
    : dealStart(open[0]?.code ?? "", me?.employee_id ?? "");
  const f = useContractForm(start, pipeline.DealFields);
  const create = useMutation("POST /api/v1/partnerships/deals");
  const edit = useMutation("PATCH /api/v1/partnerships/deals/:id");
  const submit = async () => {
    const v = f.values as Record<string, unknown>;
    try {
      if (deal) {
        // Edit Deal: a field emptied is cleared (null); the stage moves on the switcher.
        const changes: Record<string, unknown> = {};
        for (const k of ["title", "objective", "estimated_value", "expected_close_on", "event_starts_on", "event_ends_on", "event_title", "next_action", "next_action_on", "comments", "owner_id"]) changes[k] = v[k] === "" ? null : v[k];
        changes.expected_attendance = v.expected_attendance === "" ? null : Number(v.expected_attendance);
        changes.venue = v.venue ?? null;
        if (!changes.owner_id) delete changes.owner_id;
        await edit.run({ params: { id: deal.deal_id }, body: changes as never });
        toast("Deal saved");
      } else {
        const body: Record<string, unknown> = { ...dealBody(v), partner_id: partnerId };
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
    <DealPart f={f as unknown as Bound} stages={deal ? stages.filter((s) => s.code === deal.stage) : open} owner={deal ? (deal.owner ?? null) : me} />
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

