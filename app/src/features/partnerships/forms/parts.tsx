import type { ListValue, PersonRef } from "@mycity/contract/contract.gen.ts";
import type { ReactNode } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { EmployeePicker } from "@/features/shared/pickers";
import { places } from "@/features/shared/places";
import { AddressField, ChoiceField, DateField, DateRangeField, Field, MoneyField, MoreFields, NumberField, PhoneField, PlacesField, SelectField, TextAreaField, TextField, type FieldState, type PlaceValue } from "@mycity/ui";
import { SCOPES, useCategoryOptions, useListOptions } from "../lib";

/**
 * The fields New Lead, New Partner, New Deal and their edits share (docs/guides/partnerships.md §10.1:
 * Organisation, Contact, Deal, and Advanced behind its row). Each part is bound to its own
 * `useContractForm` with the contract's own schema (LeadFields or PartnerFields, ContactInput,
 * DealFields), so a field is checked as it is filled by the rules the API keeps.
 */

/** What every part's form gives it: the binding and the setter (useContractForm's). */
export interface Bound {
  values: Record<string, unknown>;
  field: (k: never) => object;
  status: (k: never) => object;
  set: (k: never, v: never) => void;
}
const b = (f: Bound) => f as unknown as {
  values: Record<string, unknown>;
  field: (k: string) => unknown;
  status: (k: string) => { state: FieldState; message?: string };
  set: (k: string, v: unknown) => void;
};
/** One field's binding, typed for the control it is spread on. */
type Binding<V> = { value: V; onChange: (v: V) => void; onBlur: () => void; name: string; state: FieldState; message?: string };
const txt = (f: Bound, k: string) => b(f).field(k) as Binding<string>;
const plc = (f: Bound, k: string) => b(f).field(k) as Binding<PlaceValue | null>;

/** The person signed in, as a picker holds a person. */
export function useMeAsPerson(): PersonRef | null {
  const { me } = useAuth();
  return me ? { employee_id: me.employee_id, display_name: me.display_name, job_title: me.job_title ?? null, department: me.department ?? null, photo_url: me.photo_url ?? null } : null;
}

/** The region: a scope, and for Cities the cities picked (F27). */
function RegionField({ f }: { f: Bound }) {
  const x = b(f);
  const region = (x.values.region ?? { scope: "national" }) as { scope: string; cities?: PlaceValue[] };
  return (
    <>
      <Field label="Region" {...x.status("region")}>
        <ChoiceField value={region.scope} onChange={(scope: string) => x.set("region", { scope, cities: scope === "cities" ? (region.cities ?? []) : undefined })} options={SCOPES} />
      </Field>
      {region.scope === "cities" && (
        <Field label="Cities" {...x.status("region")}>
          <PlacesField value={region.cities ?? []} onChange={(cities) => x.set("region", { scope: "cities", cities })} places={places} level="city" placeholder="Lagos" />
        </Field>
      )}
    </>
  );
}

/** The owner: a person picked from the staff register, kept as their id. */
export function OwnerField({ f, label = "Owner", name = "owner_id", initial }: { f: Bound; label?: string; name?: string; initial?: PersonRef | null }) {
  const x = b(f);
  const picked = (x.values[`${name}_person`] as PersonRef[] | undefined) ?? (initial ? [initial] : []);
  return (
    <Field label={label} {...x.status(name)}>
      <EmployeePicker
        value={picked}
        onChange={(people) => {
          x.set(`${name}_person`, people);
          x.set(name, people[0]?.employee_id ?? "");
        }}
        placeholder="Search people"
      />
    </Field>
  );
}

/** Organisation: Name, Category, Region, Industry, Owner; Advanced behind its row. */
export function OrganisationPart({ f, kind, owner }: { f: Bound; kind: "lead" | "partner"; owner?: PersonRef | null }) {
  const x = b(f);
  const categories = useCategoryOptions();
  const sources = useListOptions("lead_source");
  return (
    <>
      <Field label="Name" {...x.status("name")}><TextField {...txt(f, "name")} placeholder="House of Hevix" /></Field>
      <Field label="Category" {...x.status("partner_category_id")}>
        <SelectField {...txt(f, "partner_category_id")} options={categories.options} more={categories.more} onMore={categories.onMore} placeholder="Choose One" />
      </Field>
      <RegionField f={f} />
      <Field label="Industry" optional {...x.status("industry")}><TextField {...txt(f, "industry")} placeholder="Events" /></Field>
      <OwnerField f={f} label={kind === "lead" ? "Lead Owner" : "Owner"} initial={owner} />
      <MoreFields label="Advanced">
        {kind === "partner" && <Field label="Legal Name" optional {...x.status("legal_name")}><TextField {...txt(f, "legal_name")} /></Field>}
        <Field label="Website" optional {...x.status("website")}><TextField {...txt(f, "website")} placeholder="hevix.ng" /></Field>
        {kind === "partner" && (
          <Field label="Headquarters" optional {...x.status("headquarters")}><AddressField {...plc(f, "headquarters")} places={places} level="area" /></Field>
        )}
        {kind === "partner" && <Field label="Partner Since" optional {...x.status("since")}><DateField {...txt(f, "since")} /></Field>}
        {kind === "lead" && (
          <Field label="Source" optional {...x.status("source")}><SelectField {...txt(f, "source")} options={[["", "None"], ...sources]} placeholder="Choose One" /></Field>
        )}
        {kind === "lead" && (
          <Field label="Impact Rating" optional {...x.status("impact_rating")}>
            <SelectField {...txt(f, "impact_rating")} options={[["", "None"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]]} placeholder="Choose One" />
          </Field>
        )}
        {kind === "lead" && <Field label="Impact Note" optional {...x.status("impact_note")}><TextField {...txt(f, "impact_note")} /></Field>}
        {kind === "lead" && <Field label="Comments" optional {...x.status("comments")}><TextAreaField {...txt(f, "comments")} /></Field>}
      </MoreFields>
    </>
  );
}

/** Contact: Name, Position, Email, Phone. */
export function ContactPart({ f }: { f: Bound }) {
  const x = b(f);
  const phones = (x.values.phones as string[] | undefined) ?? [];
  return (
    <>
      <Field label="First Name" {...x.status("first_name")}><TextField {...txt(f, "first_name")} autoComplete="off" /></Field>
      <Field label="Last Name" {...x.status("last_name")}><TextField {...txt(f, "last_name")} autoComplete="off" /></Field>
      <Field label="Position" optional {...x.status("job_title")}><TextField {...txt(f, "job_title")} placeholder="Founder" /></Field>
      <Field label="Email" optional {...x.status("email")}><TextField {...txt(f, "email")} inputMode="email" autoComplete="off" placeholder="name@company.ng" /></Field>
      <Field label="Phone" optional {...x.status("phones")}>
        <PhoneField value={phones[0] ?? ""} onChange={(v: string) => x.set("phones", v ? [v, ...phones.slice(1)] : phones.slice(1))} placeholder="803 123 4567" />
      </Field>
    </>
  );
}

/** A deal's dates and venue as an event: one period, one place picked. */
function EventFields({ f }: { f: Bound }) {
  const x = b(f);
  return (
    <>
      <Field label="Event Dates" optional {...x.status("event_ends_on")}>
        <DateRangeField
          value={{ from: String(x.values.event_starts_on ?? ""), to: String(x.values.event_ends_on ?? "") }}
          onChange={(r) => {
            x.set("event_starts_on", r.from);
            x.set("event_ends_on", r.to);
          }}
        />
      </Field>
      <Field label="Venue" optional {...x.status("venue")}><AddressField {...plc(f, "venue")} places={places} /></Field>
    </>
  );
}

/** Deal: Title, Objective, Stage, Projected Value, Expected Close, Event Dates, Venue; Advanced behind its row. */
export function DealPart({ f, stages, owner, extra }: { f: Bound; stages: ListValue[]; owner?: boolean | PersonRef | null; extra?: ReactNode }) {
  const x = b(f);
  return (
    <>
      <Field label="Title" {...x.status("title")}><TextField {...txt(f, "title")} placeholder="December Festival Ticketing" /></Field>
      <Field label="Objective" optional {...x.status("objective")}><TextAreaField {...txt(f, "objective")} /></Field>
      <Field label="Stage" {...x.status("stage")}><SelectField {...txt(f, "stage")} options={stages.map((s) => [s.code, s.label] as [string, string])} placeholder="Choose One" /></Field>
      <Field label="Projected Value" help="The owner's estimate of what the deal is worth." optional {...x.status("estimated_value")}><MoneyField {...txt(f, "estimated_value")} /></Field>
      <Field label="Expected Close" optional {...x.status("expected_close_on")}><DateField {...txt(f, "expected_close_on")} /></Field>
      <EventFields f={f} />
      {owner !== undefined && owner !== false && <OwnerField f={f} label="Deal Owner" initial={typeof owner === "object" ? owner : null} />}
      <MoreFields label="Advanced">
        <Field label="Event Title" optional {...x.status("event_title")}><TextField {...txt(f, "event_title")} /></Field>
        <Field label="Expected Attendance" optional {...x.status("expected_attendance")}><NumberField {...txt(f, "expected_attendance")} /></Field>
        <Field label="Next Action" optional {...x.status("next_action")}><TextField {...txt(f, "next_action")} placeholder="Send the deck" /></Field>
        <Field label="Next Action Date" optional {...x.status("next_action_on")}><DateField {...txt(f, "next_action_on")} /></Field>
        <Field label="Comments" optional {...x.status("comments")}><TextAreaField {...txt(f, "comments")} /></Field>
        {extra}
      </MoreFields>
    </>
  );
}

/** A deal form's starting values (DealFields), the stage the first of the list. */
export function dealStart(stage: string, ownerId: string) {
  return {
    title: "",
    objective: "",
    stage,
    estimated_value: "",
    expected_close_on: "",
    event_starts_on: "",
    event_ends_on: "",
    venue: null as PlaceValue | null,
    event_title: "",
    expected_attendance: "",
    next_action: "",
    next_action_on: "",
    comments: "",
    owner_id: ownerId,
  };
}

/** A contact form's starting values (ContactInput). */
export const contactStart = () => ({ first_name: "", last_name: "", job_title: "", email: "", phones: [] as string[] });

/** The deal as its request carries it: empty values left out (the form's own UI keys too). */
export function dealBody(v: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, value] of Object.entries(v)) {
    if (k.endsWith("_person")) continue;
    if (value === "" || value === null || value === undefined) continue;
    out[k] = k === "expected_attendance" ? Number(value) : value;
  }
  return out;
}
