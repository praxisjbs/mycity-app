import partners from "@mycity/contract/schemas/partners.js";
import pipeline from "@mycity/contract/schemas/partner_pipeline.js";
import { useEffect, useRef, useState } from "react";
import { upload } from "@/api/upload";
import { invalidate, useMutation } from "@/api/hooks";
import { CheckboxField, Field, toast, UploadField, useContractForm, Wizard, type PlaceValue } from "@mycity/ui";
import { failed, useStages } from "../lib";
import { DuplicateNotice } from "./LeadForm";
import { ContactPart, contactStart, DealPart, dealBody, dealStart, OrganisationPart, useMeAsPerson, type Bound } from "./parts";

/**
 * New Partner (docs/guides/partnerships.md §6.6, §10.1): an organisation whose relationship is already
 * signed: the organisation, its primary contact and its signed deal, with the signed copy or Signed
 * Before the Hub. Each step is checked by its own contract schema (PartnerFields, ContactInput,
 * DealFields).
 */
export function PartnerForm({ close, onCreated }: { close: () => void; onCreated?: (partnerId: string) => void }) {
  const me = useMeAsPerson();
  const { stages } = useStages();
  const signed = stages.filter((s) => s.meaning === "signed" || s.meaning === "active");
  const key = useRef(crypto.randomUUID());
  const [step, setStep] = useState(0);
  const [evidence, setEvidence] = useState<{ copy: string | null; before: boolean }>({ copy: null, before: false });
  const [problem, setProblem] = useState<string | null>(null);
  const org = useContractForm(
    { name: "", legal_name: "", partner_category_id: "", region: { scope: "national" } as { scope: string; cities?: PlaceValue[] }, industry: "", owner_id: me?.employee_id ?? "", website: "", headquarters: null as PlaceValue | null, since: "" },
    partners.PartnerFields,
  );
  const contact = useContractForm(contactStart(), partners.ContactInput);
  const deal = useContractForm(dealStart(signed[0]?.code ?? "", me?.employee_id ?? ""), pipeline.DealFields);
  useEffect(() => {
    if (!deal.values.stage && signed[0]) deal.set("stage", signed[0].code);
  }, [signed, deal]);
  const save = useMutation("POST /api/v1/partnerships/partners");
  const submit = async () => {
    if (!evidence.copy && !evidence.before) {
      setProblem("Attach the signed copy");
      return;
    }
    const v = org.values;
    try {
      const made = await save.run({
        idempotencyKey: key.current,
        body: {
          ...(dealBody(v as Record<string, unknown>) as Record<string, never>),
          region: v.region,
          contact: dealBody(contact.values as Record<string, unknown>) as never,
          deal: { ...(dealBody(deal.values as Record<string, unknown>) as Record<string, never>), owner_id: v.owner_id },
          ...(evidence.copy ? { signed_copy_document_id: evidence.copy } : { signed_before_hub: true }),
        } as never,
      });
      invalidate("/api/v1/partnerships");
      close();
      toast("Partner added");
      onCreated?.(made.partner.partner_id);
    } catch (e) {
      const fields = Object.keys((e as { fields?: Record<string, unknown> }).fields ?? {});
      setStep(fields.some((k) => k.startsWith("contact.")) ? 1 : fields.some((k) => k.startsWith("deal.") || k === "signed_copy_document_id") ? 2 : 0);
      failed(contact, "contact.")(e);
      failed(deal, "deal.")(e);
      if (!fields.some((k) => k.startsWith("contact.") || k.startsWith("deal."))) failed(org)(e);
    }
  };
  return (
    <Wizard
      finish="Add Partner"
      busy={save.pending}
      step={step}
      onStepChange={setStep}
      onFinish={submit}
      onCancel={close}
      error={problem}
      steps={[
        {
          title: "Organisation",
          check: () => org.check(),
          body: (
            <>
              <DuplicateNotice name={org.values.name} />
              <OrganisationPart f={org as unknown as Bound} kind="partner" owner={me} />
            </>
          ),
        },
        { title: "Contact", check: () => contact.check(), body: <ContactPart f={contact as unknown as Bound} /> },
        {
          title: "Signed Deal",
          check: () => deal.check(),
          body: (
            <>
              <DealPart f={deal as unknown as Bound} stages={signed} />
              <Field label="Signed Copy" optional>
                <UploadField
                  purpose="attachment"
                  upload={upload}
                  multiple={false}
                  accept=".pdf,.jpg,.jpeg,.png"
                  kinds="PDF or a photo"
                  compact
                  onUploaded={(docs) => {
                    setProblem(null);
                    setEvidence((e) => ({ ...e, copy: docs[0]?.document_id ?? null }));
                  }}
                />
              </Field>
              <CheckboxField
                value={evidence.before}
                onChange={(before) => {
                  setProblem(null);
                  setEvidence((e) => ({ ...e, before }));
                }}
                label="Signed Before the Hub"
              />
            </>
          ),
        },
      ]}
    />
  );
}
