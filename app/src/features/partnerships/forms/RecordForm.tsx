import type { LeadDetail, PartnerDetail } from "@mycity/contract/contract.gen.ts";
import leads from "@mycity/contract/schemas/leads.js";
import partners from "@mycity/contract/schemas/partners.js";
import { invalidate, useMutation } from "@/api/hooks";
import { placeValue } from "@/features/shared/places";
import { Button, FormFooter, toast, useContractForm, type PlaceValue } from "@mycity/ui";
import { failed } from "../lib";
import { OrganisationPart, type Bound } from "./parts";

const regionOf = (r: { scope: string | null; cities: Array<Parameters<typeof placeValue>[0]> }) => ({
  scope: r.scope ?? "national",
  cities: r.scope === "cities" ? (r.cities.map(placeValue).filter(Boolean) as PlaceValue[]) : undefined,
});
const orNull = (v: unknown) => (v === "" || v === undefined ? null : v);

/** Edit Lead (docs/guides/partnerships.md §6.4): its own fields, checked by LeadFields; an emptied field is cleared. */
export function EditLead({ lead, close }: { lead: LeadDetail; close: () => void }) {
  const f = useContractForm(
    {
      name: lead.name,
      partner_category_id: lead.partner_category_id ?? "",
      region: regionOf(lead.region_view),
      industry: lead.industry ?? "",
      owner_id: lead.owner?.employee_id ?? "",
      owner_id_person: lead.owner ? [lead.owner] : [],
      website: lead.website ?? "",
      source: lead.source ?? "",
      impact_rating: lead.impact_rating ?? "",
      impact_note: lead.impact_note ?? "",
      comments: lead.comments ?? "",
    },
    leads.LeadFields,
  );
  const save = useMutation("PATCH /api/v1/partnerships/leads/:id");
  const submit = async () => {
    if (!f.check()) return;
    const v = f.values;
    try {
      await save.run({
        params: { id: lead.lead_id },
        body: { name: v.name, partner_category_id: v.partner_category_id, region: v.region as never, owner_id: v.owner_id, industry: orNull(v.industry), website: orNull(v.website), source: orNull(v.source), impact_rating: orNull(v.impact_rating), impact_note: orNull(v.impact_note), comments: orNull(v.comments) } as never,
      });
      invalidate("/api/v1/partnerships");
      close();
      toast("Lead saved");
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <>
      <OrganisationPart f={f as unknown as Bound} kind="lead" owner={lead.owner} />
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Save Lead</Button>
      </FormFooter>
    </>
  );
}

/** Edit Partner (docs/guides/partnerships.md §6.6): its own fields, checked by PartnerFields; an emptied field is cleared. */
export function EditPartner({ partner, close }: { partner: PartnerDetail; close: () => void }) {
  const f = useContractForm(
    {
      name: partner.name,
      legal_name: partner.legal_name ?? "",
      partner_category_id: partner.partner_category_id ?? "",
      region: regionOf(partner.region_view),
      industry: partner.industry ?? "",
      owner_id: partner.owner?.employee_id ?? "",
      owner_id_person: partner.owner ? [partner.owner] : [],
      website: partner.website ?? "",
      headquarters: placeValue(partner.headquarters),
      since: partner.since ?? "",
    },
    partners.PartnerFields,
  );
  const save = useMutation("PATCH /api/v1/partnerships/partners/:id");
  const submit = async () => {
    if (!f.check()) return;
    const v = f.values;
    try {
      await save.run({
        params: { id: partner.partner_id },
        body: { name: v.name, partner_category_id: v.partner_category_id, region: v.region as never, owner_id: v.owner_id, legal_name: orNull(v.legal_name), industry: orNull(v.industry), website: orNull(v.website), headquarters: v.headquarters ?? null, since: orNull(v.since) } as never,
      });
      invalidate("/api/v1/partnerships");
      close();
      toast("Partner saved");
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <>
      <OrganisationPart f={f as unknown as Bound} kind="partner" owner={partner.owner} />
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Save Partner</Button>
      </FormFooter>
    </>
  );
}
