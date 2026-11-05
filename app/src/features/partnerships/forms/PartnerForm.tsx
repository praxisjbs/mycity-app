import { useState } from "react";
import { invalidate, useMutation } from "@/api/hooks";
import "@/api/types/partnerships";
import type { PersonRef } from "@/api/types/common";
import { useRouter } from "@/lib/router";
import { EmployeePicker } from "@/features/shared/pickers";
import { places } from "@/features/shared/places";
import { AddressField, Field, MoneyField, SelectField, TextField, toast, useContractForm, Wizard, type PlaceValue } from "@mycity/ui";
import { opts } from "../lib";

const INDUSTRIES = ["Banking", "Telecoms", "Government", "Healthcare", "Hospitality", "Entertainment", "Retail", "Fintech", "Aviation", "FMCG", "Other"];
const TYPES = ["Strategic", "Sponsorship", "Government", "Media", "Hospitality", "Community"];

/** New Partner, on the mock until M7 PR 3. */
export function PartnerForm({ close }: { close: () => void }) {
  const { navigate } = useRouter();
  const [owner, setOwner] = useState<PersonRef[]>([]);
  const [tried, setTried] = useState(false);
  const f = useContractForm(
    { name: "", legal_name: "", industry: "", type: "", value: "", hq: null as PlaceValue | null, website: "" },
    { name: (v) => (!v.trim() ? "Name the partner" : null), industry: (v) => (!v ? "Pick the industry" : null), type: (v) => (!v ? "Pick the type" : null), hq: (v) => (!v ? "Pick a location" : null) },
  );
  const save = useMutation("POST /api/v1/partnerships/partners");
  const submit = async () => {
    setTried(true);
    if (!f.check() || !owner.length) return;
    try {
      // Checked above: the headquarters is picked.
      const p = await save.run({ body: { ...f.values, hq: f.values.hq!, value: f.values.value || "0.00", owner_id: owner[0].employee_id } });
      invalidate("/api/v1/partnerships");
      close();
      toast(`${p.name} added at Prospect identified`);
      navigate(`/partnerships?tab=partners&id=${p.partner_id}`);
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <Wizard
      finish="Add Partner"
      busy={save.pending}
      onFinish={() => submit()}
      onCancel={close}
      steps={[
        {
          title: "Partner",
          check: () => f.check(["name", "industry", "type"]),
          body: (
            <>
              <Field label="Partner" {...f.field("name")}><TextField {...f.field("name")} placeholder="Zenith Bank" /></Field>
              <Field label="Legal Name" optional><TextField {...f.field("legal_name")} /></Field>
              <Field label="Industry" {...f.field("industry")}><SelectField placeholder="Pick one" options={opts(INDUSTRIES)} {...f.field("industry")} /></Field>
              <Field label="Partnership Type" {...f.field("type")}><SelectField placeholder="Pick one" options={opts(TYPES)} {...f.field("type")} /></Field>
            </>
          ),
        },
        {
          title: "Details",
          body: (
            <>
              <Field label="Expected Value" optional><MoneyField {...f.field("value")} /></Field>
              <Field label="Headquarters" {...f.status("hq")}><AddressField {...f.field("hq")} places={places} level="area" placeholder="Victoria Island" /></Field>
              <Field label="Website" optional><TextField {...f.field("website")} placeholder="example.com" /></Field>
              <Field label="Lead Owner" state={tried && !owner.length ? "bad" : undefined} message={tried && !owner.length ? "Pick the owner" : undefined}><EmployeePicker value={owner} onChange={setOwner} /></Field>
            </>
          ),
        },
      ]}
    />
  );
}
