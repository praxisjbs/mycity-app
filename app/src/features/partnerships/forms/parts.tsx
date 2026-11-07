import type { DealDetail, Field as CustomField, ListValue, PersonRef } from "@mycity/contract/contract.gen.ts";
import type { ReactNode } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { EmployeePicker } from "@/features/shared/pickers";
import { places } from "@/features/shared/places";
import {
  AddressField,
  Button,
  CheckboxField,
  ChoiceField,
  DateField,
  DateRangeField,
  Field,
  Grid,
  IconButton,
  MoneyField,
  MoreFields,
  NumberField,
  PhoneField,
  PlacesField,
  SelectField,
  TextAreaField,
  TextField,
  type FieldState,
  type PlaceValue,
} from "@mycity/ui";
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

/** Organisation: Name, Category, Region, Industry, Owner; Advanced behind its row, with the custom fields given. */
export function OrganisationPart({ f, kind, owner, custom }: { f: Bound; kind: "lead" | "partner"; owner?: PersonRef | null; custom?: CustomField[] }) {
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
        {kind === "lead" && <ImpactFields f={f} />}
        {kind === "lead" && <Field label="Comments" optional {...x.status("comments")}><TextAreaField {...txt(f, "comments")} /></Field>}
        {custom && <CustomFieldsPart defs={custom} f={f} />}
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

/**
 * Deal: Title, Objective, Stage, Projected Value, Expected Close, Event Dates, Venue; Deal Options on New
 * Deal and Edit Deal; Advanced behind its row: the event's title and attendance, next action, impact,
 * commission (with `partnerships.money`), validity, team, comments and the custom fields given.
 */
export function DealPart({
  f,
  stages,
  owner,
  extra,
  terms,
}: {
  f: Bound;
  stages: ListValue[];
  owner?: boolean | PersonRef | null;
  extra?: ReactNode;
  /** The deal's terms: options and team (New Deal, Edit Deal), commission with the capability, validity and the custom fields. */
  terms?: { options?: boolean; money: boolean; categoryRate: string | null; custom: CustomField[]; validityNone: string };
}) {
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
      {terms?.options && <OptionsPart f={f} money={terms.money} />}
      <MoreFields label="Advanced">
        <Field label="Event Title" optional {...x.status("event_title")}><TextField {...txt(f, "event_title")} /></Field>
        <Field label="Expected Attendance" optional {...x.status("expected_attendance")}><NumberField {...txt(f, "expected_attendance")} /></Field>
        <Field label="Next Action" optional {...x.status("next_action")}><TextField {...txt(f, "next_action")} placeholder="Send the deck" /></Field>
        <Field label="Next Action Date" optional {...x.status("next_action_on")}><DateField {...txt(f, "next_action_on")} /></Field>
        {terms && <ImpactFields f={f} />}
        {terms?.money && <CommissionField f={f} categoryRate={terms.categoryRate} />}
        {terms && <ValidityField f={f} none={terms.validityNone} />}
        {terms?.options && <TeamField f={f} />}
        <Field label="Comments" optional {...x.status("comments")}><TextAreaField {...txt(f, "comments")} /></Field>
        {terms && <CustomFieldsPart defs={terms.custom} f={f} />}
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
    impact: [] as string[],
    impact_rating: "",
    impact_note: "",
    commission_pct: "",
    validity_kind: "",
    validity_until: "",
    member_ids: [] as string[],
    member_ids_person: [] as PersonRef[],
    options: [] as OptionDraft[],
    custom: {} as CustomDraft,
  };
}

/** A contact form's starting values (ContactInput). */
export const contactStart = () => ({ first_name: "", last_name: "", job_title: "", email: "", phones: [] as string[] });

/** The form's own keys, never sent: a picker's people, the validity choice, the drafts sent in their wire form. */
const UI_KEYS = new Set(["validity_kind", "validity_until", "options", "custom"]);

/**
 * The record or the deal as its request carries it: empty values left out (the form's own UI keys too);
 * with `deal`, its validity, options (commission only with `money`) and custom values in their wire form.
 */
export function dealBody(v: Record<string, unknown>, deal?: { money: boolean; custom: CustomField[] }) {
  const out: Record<string, unknown> = {};
  for (const [k, value] of Object.entries(v)) {
    if (k.endsWith("_person") || UI_KEYS.has(k)) continue;
    if (isBlank(value)) continue;
    out[k] = k === "expected_attendance" ? Number(value) : value;
  }
  if (deal) {
    const validity = validityOnWire(v);
    if (validity) out.validity = validity;
    const options = optionsOnWire((v.options as OptionDraft[] | undefined) ?? [], deal.money);
    if (options.length) out.options = options;
    const custom = customForCreate(deal.custom, v.custom as CustomDraft | undefined);
    if (custom) out.custom = custom;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Impact, custom fields and a deal's terms (§6.3, §6.5, §6.6, §10.1)
 * ------------------------------------------------------------------ */

/** Several of a list's values, each a tick (Impact; a Pick Many custom field). */
function ManyField({ value, onChange, options }: { value: string[]; onChange: (v: string[]) => void; options: Array<[string, string]> }) {
  return (
    <span className="flex flex-col">
      {options.map(([code, text]) => (
        <CheckboxField key={code} label={text} value={value.includes(code)} onChange={(on) => onChange(on ? [...value, code] : value.filter((x) => x !== code))} />
      ))}
    </span>
  );
}

/** Impact: the values it serves, a rating and a note (Advanced). */
export function ImpactFields({ f }: { f: Bound }) {
  const x = b(f);
  const impacts = useListOptions("partnership_impact");
  return (
    <>
      {impacts.length > 0 && (
        <Field label="Impact" optional {...x.status("impact")}>
          <ManyField value={(x.values.impact as string[] | undefined) ?? []} onChange={(v) => x.set("impact", v)} options={impacts} />
        </Field>
      )}
      <Field label="Impact Rating" optional {...x.status("impact_rating")}>
        <SelectField {...txt(f, "impact_rating")} options={[["", "None"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]]} placeholder="Choose One" />
      </Field>
      <Field label="Impact Note" optional {...x.status("impact_note")}><TextField {...txt(f, "impact_note")} /></Field>
    </>
  );
}

type CustomValue = string | number | boolean | string[] | null;
/** A record's custom values as a form holds them: every text a string, a yes or no a boolean, Pick Many a list. */
export type CustomDraft = Record<string, CustomValue>;

/** The custom fields a record of its category is given, in use, each drawn by its type (§6.3); behind Advanced. */
export function CustomFieldsPart({ defs, f }: { defs: CustomField[]; f: Bound }) {
  const x = b(f);
  const draft = (x.values.custom as CustomDraft | undefined) ?? {};
  const setOne = (key: string, v: CustomValue) => x.set("custom", { ...draft, [key]: v });
  return (
    <>
      {defs
        .filter((d) => d.active)
        .map((d) => {
          const v = draft[d.key];
          const asText = typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
          const bind = { value: asText, onChange: (t: string) => setOne(d.key, t), onBlur: () => undefined, name: `custom-${d.key}` };
          const pickOptions = ((d.options as string[] | null) ?? []).map((o) => [o, o] as [string, string]);
          return (
            <Field key={d.key} label={d.label} optional>
              {d.field_type === "long_text" ? (
                <TextAreaField {...bind} />
              ) : d.field_type === "number" ? (
                <NumberField {...bind} decimal signed />
              ) : d.field_type === "money" ? (
                <MoneyField {...bind} />
              ) : d.field_type === "date" ? (
                <DateField {...bind} />
              ) : d.field_type === "pick" ? (
                <SelectField {...bind} options={[["", "None"], ...pickOptions]} placeholder="Choose One" />
              ) : d.field_type === "multi_pick" ? (
                <ManyField value={Array.isArray(v) ? v : []} onChange={(list) => setOne(d.key, list)} options={pickOptions} />
              ) : d.field_type === "yes_no" ? (
                <SelectField value={v === true ? "yes" : v === false ? "no" : ""} onChange={(t) => setOne(d.key, t === "yes" ? true : t === "no" ? false : null)} options={[["", "None"], ["yes", "Yes"], ["no", "No"]]} placeholder="Choose One" />
              ) : (
                <TextField {...bind} placeholder={d.field_type === "url" ? "https://" : undefined} />
              )}
            </Field>
          );
        })}
    </>
  );
}

const isBlank = (v: unknown) => v === "" || v === null || v === undefined || (Array.isArray(v) && v.length === 0);

/** A custom value as the API takes it: a number typed is a number; nothing typed is nothing. */
function customOnWire(d: CustomField, v: CustomValue | undefined): CustomValue | undefined {
  if (isBlank(v)) return undefined;
  if (d.field_type === "number") return Number(v);
  return v as CustomValue;
}

/** New: the custom values given, each by its field's type; left out when none is. */
export function customForCreate(defs: CustomField[], draft: CustomDraft | undefined): CustomDraft | undefined {
  const out: CustomDraft = {};
  for (const d of defs) {
    const v = customOnWire(d, draft?.[d.key]);
    if (v !== undefined && d.active) out[d.key] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Edit: only the values that changed, an emptied one as null so the API clears it; retired fields untouched. */
export function customForEdit(defs: CustomField[], draft: CustomDraft | undefined, had: Record<string, unknown>): CustomDraft | undefined {
  const out: CustomDraft = {};
  for (const d of defs) {
    if (!d.active) continue;
    const v = customOnWire(d, draft?.[d.key]) ?? null;
    const was = had[d.key] ?? null;
    if (JSON.stringify(v) !== JSON.stringify(was)) out[d.key] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A deal's commission rate, with `partnerships.money`; its help says when it differs from the category's. */
export function CommissionField({ f, categoryRate }: { f: Bound; categoryRate: string | null }) {
  const x = b(f);
  const typed = String(x.values.commission_pct ?? "");
  const differs = !!typed && !!categoryRate && Number(typed) !== Number(categoryRate);
  return (
    <Field label="Commission %" optional help={differs ? `Differs from the category's ${Number(categoryRate)}%.` : undefined} {...x.status("commission_pct")}>
      <NumberField {...txt(f, "commission_pct")} decimal placeholder={categoryRate ? String(Number(categoryRate)) : "8"} />
    </Field>
  );
}

/** How long a signed deal runs: 30 days, 60 days or until a date; else the category's days (§6.6). */
export function ValidityField({ f, none }: { f: Bound; none: string }) {
  const x = b(f);
  const kind = String(x.values.validity_kind ?? "");
  return (
    <>
      <Field label="Validity" optional {...x.status("validity")}>
        <ChoiceField value={kind} onChange={(v: string) => x.set("validity_kind", v)} options={[["", none], ["30", "30 Days"], ["60", "60 Days"], ["until", "Until a Date"]]} />
      </Field>
      {kind === "until" && (
        <Field label="Valid Until" {...x.status("validity")}><DateField {...txt(f, "validity_until")} /></Field>
      )}
    </>
  );
}

/** The validity choice on the wire: `{ days }`, `{ until }`, or nothing (the category's, or none on an edit). */
export function validityOnWire(v: Record<string, unknown>): { days: 30 | 60 } | { until: string } | null {
  if (v.validity_kind === "30" || v.validity_kind === "60") return { days: Number(v.validity_kind) as 30 | 60 };
  if (v.validity_kind === "until" && v.validity_until) return { until: String(v.validity_until) };
  return null;
}

/** A deal's validity as its form opens it. */
export function validityStart(d: Pick<DealDetail, "validity_days" | "valid_until"> | null) {
  if (d?.validity_days === 30 || d?.validity_days === 60) return { validity_kind: String(d.validity_days), validity_until: "" };
  if (d?.valid_until && !d.validity_days) return { validity_kind: "until", validity_until: d.valid_until };
  return { validity_kind: "", validity_until: "" };
}

/** The deal's team beside its owner (§6.5): people picked from the staff register. */
export function TeamField({ f }: { f: Bound }) {
  const x = b(f);
  const picked = (x.values.member_ids_person as PersonRef[] | undefined) ?? [];
  return (
    <Field label="Team" optional {...x.status("member_ids")}>
      <EmployeePicker
        multiple
        value={picked}
        onChange={(people) => {
          x.set("member_ids_person", people);
          x.set("member_ids", people.map((p) => p.employee_id));
        }}
        placeholder="Search people"
      />
    </Field>
  );
}

/** One priced line of a deal as its form holds it (DealOptionInput, strings as typed). */
export interface OptionDraft {
  position: number;
  label: string;
  original_price: string;
  discount_pct: string;
  deal_price: string;
  price_note: string;
  commission_amount: string;
  merchant_take: string;
}
const EMPTY_OPTION = { label: "", original_price: "", discount_pct: "", deal_price: "", price_note: "", commission_amount: "", merchant_take: "" };

/** A deal's options as its form opens them. */
export const optionsStart = (d: Pick<DealDetail, "options"> | null): OptionDraft[] =>
  (d?.options ?? []).map((o, i) => ({
    position: i + 1,
    label: o.label,
    original_price: o.original_price ?? "",
    discount_pct: o.discount_pct ?? "",
    deal_price: o.deal_price ?? "",
    price_note: o.price_note ?? "",
    commission_amount: o.commission_amount ?? "",
    merchant_take: o.merchant_take ?? "",
  }));

/** The options as the API takes them: renumbered 1 to 5, empty values left out, commission only with the capability. */
export function optionsOnWire(rows: OptionDraft[], money: boolean) {
  return rows.map((o, i) => {
    const out: Record<string, string | number> = { position: i + 1, label: o.label.trim() };
    for (const k of ["original_price", "discount_pct", "deal_price", "price_note"] as const) if (o[k].trim()) out[k] = o[k].trim();
    if (money) for (const k of ["commission_amount", "merchant_take"] as const) if (o[k].trim()) out[k] = o[k].trim();
    return out;
  });
}

/**
 * Deal Options (§6.6, §10.1): up to five priced lines, as MyCity's Deal Merchant Agreement prices them.
 * MyCity's Commission and the Merchant's Take show with `partnerships.money`; left empty, the API
 * works them out from the deal's rate.
 */
export function OptionsPart({ f, money }: { f: Bound; money: boolean }) {
  const x = b(f);
  const rows = (x.values.options as OptionDraft[] | undefined) ?? [];
  const setRows = (next: OptionDraft[]) => x.set("options", next.map((o, i) => ({ ...o, position: i + 1 })));
  const setOne = (i: number, k: keyof OptionDraft, v: string) => setRows(rows.map((o, j) => (j === i ? { ...o, [k]: v } : o)));
  return (
    <Field label="Deal Options" optional {...x.status("options")}>
      <div className="flex flex-col gap-3">
        {rows.map((o, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-card border border-border p-3">
            <Grid cols={2}>
              <Field label={`Option ${i + 1}`}><TextField name={`option-${i}-label`} value={o.label} onChange={(v) => setOne(i, "label", v)} placeholder="Regular" /></Field>
              <Field label="Price Note" optional><TextField name={`option-${i}-price_note`} value={o.price_note} onChange={(v) => setOne(i, "price_note", v)} placeholder="Free Entry" /></Field>
              <Field label="Original Price" optional><MoneyField name={`option-${i}-original_price`} value={o.original_price} onChange={(v) => setOne(i, "original_price", v)} /></Field>
              <Field label="Discount %" optional><NumberField name={`option-${i}-discount_pct`} value={o.discount_pct} onChange={(v) => setOne(i, "discount_pct", v)} decimal /></Field>
              <Field label="Deal Price" optional><MoneyField name={`option-${i}-deal_price`} value={o.deal_price} onChange={(v) => setOne(i, "deal_price", v)} /></Field>
              {money && <Field label="MyCity's Commission" optional><MoneyField name={`option-${i}-commission_amount`} value={o.commission_amount} onChange={(v) => setOne(i, "commission_amount", v)} /></Field>}
              {money && <Field label="Merchant's Take" optional><MoneyField name={`option-${i}-merchant_take`} value={o.merchant_take} onChange={(v) => setOne(i, "merchant_take", v)} /></Field>}
            </Grid>
            <span className="flex justify-end">
              <IconButton icon="trash" label={`Remove Option ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))} />
            </span>
          </div>
        ))}
        {rows.length < 5 && (
          <span>
            <Button size="sm" icon="plus" onClick={() => setRows([...rows, { position: rows.length + 1, ...EMPTY_OPTION }])}>
              Add Option
            </Button>
          </span>
        )}
      </div>
    </Field>
  );
}
