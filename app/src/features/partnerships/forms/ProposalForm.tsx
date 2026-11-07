import { invalidate, useApi, useInfinite, useMutation } from "@/api/hooks";
import "@/api/types/partnerships";
import { places } from "@/features/shared/places";
import { paging } from "@/features/shared/wire";
import { Field, MoneyField, PlacesField, SelectField, TextAreaField, TextField, toast, useContractForm, Wizard, type PlaceValue } from "@mycity/ui";

/** New Proposal, on the mock until M7 PR 7 brings the Proposal Studio. */
export function ProposalForm({ close, partner }: { close: () => void; partner: string }) {
  const partners = useInfinite("GET /api/v1/partnerships/partners");
  // The partner a 360 opened this for, by name while its page of the list is not loaded yet.
  const preset = useApi("GET /api/v1/partnerships/partners/:id", { params: { id: partner }, enabled: Boolean(partner) });
  const f = useContractForm({ partner_id: partner, what: "", why_now: "", cities: [] as PlaceValue[], weeks: "12", value: "", terms: "Half on signature, half on the first activation" }, {
    partner_id: (v) => (!v ? "Pick the partner" : null),
    what: (v) => (v.trim().length < 20 ? "Describe the proposal" : null),
    why_now: (v) => (v.trim().length < 10 ? "Why now" : null),
    cities: (v) => (!v.length ? "Pick a city" : null),
    weeks: (v) => (!(Number(v) >= 1) ? "How many weeks" : null),
    value: (v) => (!(Number(v) > 0) ? "The value we ask" : null),
  });
  const save = useMutation("POST /api/v1/partnerships/proposals");
  const submit = async () => {
    if (!f.check()) return;
    try {
      const p = await save.run({ body: { ...f.values, weeks: Number(f.values.weeks) } });
      invalidate("/api/v1/partnerships/proposals");
      close();
      toast(`${p.number} drafted. Read and edit it first`);
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <Wizard
      finish="Draft Proposal"
      busy={save.pending}
      onFinish={() => submit()}
      onCancel={close}
      steps={[
        {
          title: "The Idea",
          check: () => f.check(["partner_id", "what", "why_now"]),
          body: (
            <>
              <Field label="Who It Is For" {...f.field("partner_id")}><SelectField placeholder="Pick the partner" options={partners.rows.map((p) => [p.partner_id, p.name])} valueLabel={f.values.partner_id === partner ? preset.data?.partner.name : undefined} {...paging(partners)} {...f.field("partner_id")} /></Field>
              <Field label="What We Propose" {...f.field("what")}><TextAreaField {...f.field("what")} placeholder="Four-city health activation" /></Field>
              <Field label="Why Now" {...f.field("why_now")}><TextField {...f.field("why_now")} placeholder="Fits campaign window" /></Field>
            </>
          ),
        },
        {
          title: "Scope and Value",
          check: () => f.check(["cities", "weeks", "value"]),
          body: (
            <>
              <Field label="Cities" {...f.status("cities")}><PlacesField {...f.field("cities")} places={places} /></Field>
              <Field label="Weeks" {...f.field("weeks")}><TextField {...f.field("weeks")} inputMode="numeric" onChange={(v) => f.set("weeks", v.replace(/\D/g, "").slice(0, 2))} /></Field>
              <Field label="Value We Ask" {...f.field("value")}><MoneyField {...f.field("value")} /></Field>
              <Field label="Payment Terms"><TextField {...f.field("terms")} /></Field>
            </>
          ),
        },
      ]}
    />
  );
}
