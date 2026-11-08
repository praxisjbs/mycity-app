import leads from "@mycity/contract/schemas/leads.js";
import partners from "@mycity/contract/schemas/partners.js";
import pipeline from "@mycity/contract/schemas/partner_pipeline.js";
import { useEffect, useRef, useState } from "react";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import { Banner, Button, toast, useContractForm, Wizard, type PlaceValue } from "@mycity/ui";
import { failed, useCategoryDefaults, useFieldDefs, useHoldsMoney, useStages } from "../lib";
import { ContactPart, contactStart, customForCreate, DealPart, dealBody, dealStart, OrganisationPart, useMeAsPerson, type Bound, type CustomDraft } from "./parts";

/** A likely duplicate of what is being entered (§6.2): advisory, never blocking. */
export function DuplicateNotice({ name, email, onNewDeal }: { name: string; email?: string; onNewDeal?: (partnerId: string) => void }) {
  const asked = name.trim().length >= 3 || Boolean(email && email.includes("@"));
  const query = { ...(name.trim().length >= 3 && { name: name.trim() }), ...(email && email.includes("@") && { email }) };
  const dup = useApi("GET /api/v1/partnerships/duplicates", { query, enabled: asked });
  const top = dup.data?.candidates[0];
  if (!top) return null;
  return (
    <Banner
      tone="warn"
      className="mb-3"
      action={top.type === "partner" && onNewDeal ? <Button size="sm" onClick={() => onNewDeal(top.id)}>New Deal</Button> : undefined}
    >
      {`Already here: ${top.name}, ${top.number}.`}
    </Banner>
  );
}

/**
 * New Lead (docs/guides/partnerships.md §3 step 1, §10.1): the organisation, its primary contact and
 * the deal being pursued, a step each, each checked by its own contract schema (LeadFields,
 * ContactInput, DealFields). The deal opens at the first stage unless an open one is picked.
 */
export function LeadForm({ close, onCreated, onNewDeal }: { close: () => void; onCreated?: (leadId: string) => void; onNewDeal?: (partnerId: string) => void }) {
  const me = useMeAsPerson();
  const { stages } = useStages();
  const open = stages.filter((s) => !["signed", "active", "closed_lost"].includes(s.meaning ?? ""));
  const key = useRef(crypto.randomUUID());
  const [step, setStep] = useState(0);
  const money = useHoldsMoney();
  const org = useContractForm(
    {
      name: "",
      partner_category_id: "",
      region: { scope: "national" } as { scope: string; cities?: PlaceValue[] },
      industry: "",
      owner_id: me?.employee_id ?? "",
      website: "",
      source: "",
      impact: [] as string[],
      impact_rating: "",
      impact_note: "",
      comments: "",
      custom: {} as CustomDraft,
    },
    leads.LeadFields,
  );
  const category = org.values.partner_category_id || null;
  const leadDefs = useFieldDefs("lead", category);
  const dealDefs = useFieldDefs("deal", category);
  const defaults = useCategoryDefaults(category);
  const contact = useContractForm(contactStart(), partners.ContactInput);
  const deal = useContractForm(dealStart(open[0]?.code ?? "", me?.employee_id ?? ""), pipeline.DealFields);
  useEffect(() => {
    if (!deal.values.stage && open[0]) deal.set("stage", open[0].code);
  }, [open, deal]);
  const save = useMutation("POST /api/v1/partnerships/leads");
  const submit = async () => {
    const v = org.values;
    try {
      const made = await save.run({
        idempotencyKey: key.current,
        body: {
          ...(dealBody(v as Record<string, unknown>) as Record<string, never>),
          region: v.region,
          custom: customForCreate(leadDefs, v.custom),
          contact: dealBody(contact.values as Record<string, unknown>) as never,
          deal: { ...(dealBody(deal.values as Record<string, unknown>, { money, custom: dealDefs }) as Record<string, never>), owner_id: v.owner_id },
        } as never,
      });
      invalidate("/api/v1/partnerships");
      close();
      toast("Lead added");
      onCreated?.(made.lead.lead_id);
    } catch (e) {
      const to = (step: number) => () => setStep(step);
      const fields = (e as { fields?: Record<string, unknown> }).fields ?? {};
      if (Object.keys(fields).some((k) => k.startsWith("contact."))) to(1)();
      else if (Object.keys(fields).some((k) => k.startsWith("deal."))) to(2)();
      else to(0)();
      failed(contact, "contact.")(e);
      failed(deal, "deal.")(e);
      if (!Object.keys(fields).some((k) => k.startsWith("contact.") || k.startsWith("deal."))) failed(org)(e);
    }
  };
  return (
    <Wizard
      finish="Add Lead"
      busy={save.pending}
      step={step}
      onStepChange={setStep}
      onFinish={submit}
      onCancel={close}
      steps={[
        {
          title: "Organisation",
          check: () => org.check(),
          body: (
            <>
              <DuplicateNotice name={org.values.name} onNewDeal={onNewDeal} />
              <OrganisationPart f={org as unknown as Bound} kind="lead" owner={me} custom={leadDefs} />
            </>
          ),
        },
        { title: "Contact", check: () => contact.check(), body: <ContactPart f={contact as unknown as Bound} /> },
        {
          title: "Deal",
          check: () => deal.check(),
          body: <DealPart f={deal as unknown as Bound} stages={open} terms={{ money, categoryRate: defaults?.commission ?? null, custom: dealDefs, validityNone: "Category Default" }} />,
        },
      ]}
    />
  );
}
