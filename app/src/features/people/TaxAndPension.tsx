import { useState } from "react";
import organisation from "@mycity/contract/schemas/organisation.js";
import type { RentDeclaration } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import type { Employee360 as Record360 } from "@/api/types/organisation";
import { upload } from "@/api/upload";
import { useMe } from "@/auth/AuthProvider";
import { places, placeValue } from "@/features/shared/places";
import {
  AddressField,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  FileRow,
  FormFooter,
  formatDate,
  formatMonth,
  Grid,
  HelpTerm,
  KeyValue,
  LoadingRows,
  Money,
  MoneyField,
  MonthField,
  PhoneField,
  type PlaceValue,
  SelectField,
  TextField,
  toast,
  todayIso,
  toMoneyString,
  UploadField,
  useConfirm,
  useContractForm,
  useModal,
} from "@mycity/ui";

/**
 * People · Employees, the record's Tax and Pension tab (docs/guides/payroll.md §6.12 rule 15, §13.1 items 41, 44 and 46;
 * docs/guides/foundation.md): what payroll reads in advanced mode, kept with the person. The numbers, the NHF choice and the
 * State are set on Edit Record's Tax and Pension step; here they are read, beside the rent the person declared for each tax
 * year, which rent relief takes off their PAYE. Every value is masked as employee.statutory: the tab shows only to a
 * viewer whose role sees it, and the API refuses the rest. Declare Rent needs `people` edit.
 */

const STATE_LABELS = organisation.STATE_LABELS as Record<string, string>;
const RENT_HELP = "The rent the person paid for a tax year. Rent relief takes a share of it off their PAYE.";
const notRecorded = (v: string | null) => v ?? "Not recorded";

/** The tab: the person's numbers, their choice and their State, then their declared rent by year. */
export function TaxAndPension({ employee: e }: { employee: Record360 }) {
  const me = useMe();
  const modal = useModal();
  const canEdit = Boolean(me.grants.people?.includes("edit"));
  const list = useApi("GET /api/v1/employees/:id/rent-declarations", { params: { id: e.employee_id } });
  const declare = (d?: RentDeclaration) =>
    modal.open({ title: d ? `Change Rent ${d.year}` : "Declare Rent", wide: true, body: (close) => <RentForm employeeId={e.employee_id} declaration={d} close={close} /> });
  const declarations = list.data?.data ?? [];
  return (
    <Grid cols={2}>
      <Card>
        <CardHeader title="Tax and Pension" />
        <KeyValue
          items={[
            ["Tax ID", notRecorded(e.tax_id)],
            ["Pension PIN", notRecorded(e.pension_pin)],
            ["Pension Administrator", notRecorded(e.pension_administrator)],
            ["NHF Number", notRecorded(e.nhf_number)],
            ["Contributes to NHF", e.nhf_contributes ? "Yes" : "No"],
            ["State of Residence", e.state_of_residence ? STATE_LABELS[e.state_of_residence] : "Not recorded"],
          ]}
        />
      </Card>
      <Card>
        <CardHeader
          title="Rent Relief"
          help={RENT_HELP}
          actions={
            canEdit && (
              <Button size="sm" onClick={() => declare()}>
                Declare Rent
              </Button>
            )
          }
        />
        {list.loading ? (
          <LoadingRows />
        ) : declarations.length === 0 ? (
          <EmptyState bare icon="doc" title="No Rent Declared" />
        ) : (
          declarations.map((d) => <Declared key={d.employee_rent_declaration_id} declaration={d} canEdit={canEdit} onChange={() => declare(d)} />)
        )}
      </Card>
    </Grid>
  );
}

/** One year's declaration, as the card reads it, with Change and Remove for someone who may edit the record. */
function Declared({ declaration: d, canEdit, onChange }: { declaration: RentDeclaration; canEdit: boolean; onChange: () => void }) {
  const confirm = useConfirm();
  const drop = useMutation("DELETE /api/v1/employees/:id/rent-declarations/:year");
  const remove = async () => {
    if (!(await confirm({ title: "Remove Declaration", body: `The rent declared for ${d.year} comes off.`, confirmLabel: "Remove Declaration", cancelLabel: "Keep It", destructive: true }))) return;
    try {
      await drop.run({ params: { id: d.employee_id, year: d.year } });
      invalidate("/api/v1/employees");
      toast(`Rent for ${d.year} removed`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Not removed. Try again.");
    }
  };
  const landlordId = [d.landlord_phone, d.landlord_tax_id && `Tax ID ${d.landlord_tax_id}`, d.landlord_nin && `NIN ${d.landlord_nin}`].filter(Boolean).join(" · ");
  return (
    <div className="mt-2">
      <KeyValue
        items={[
          ["Year", String(d.year)],
          ["Rent Paid", d.rent_paid ? <Money key="rent" value={d.rent_paid} /> : "Restricted"],
          ["Covers", `${formatMonth(d.covers_from)} to ${formatMonth(d.covers_to)}`],
          [<HelpTerm key="share" help="The rent paid, shared over the months it covers: the part that falls in this year.">{"This Year's Share"}</HelpTerm>, d.year_rent ? <Money key="share" value={d.year_rent} /> : "Restricted"],
          ["Tenant", notRecorded(d.tenant_name)],
          ["Landlord", [d.landlord_name, landlordId].filter(Boolean).join(" · ")],
          ["Property", notRecorded(d.property_address)],
          ["Evidence", d.evidence_document_id ? "On File" : "None"],
          ["Entered", `${d.entered_by_name ?? "System"} · ${formatDate(d.updated_at.slice(0, 10))}`],
        ]}
      />
      {canEdit && (
        <FormFooter>
          <Button variant="danger" onClick={remove}>
            Remove Rent
          </Button>
          <Button onClick={onChange}>Change Rent</Button>
        </FormFooter>
      )}
    </div>
  );
}

type RentValues = {
  year: string;
  rent_paid: string;
  covers_from: string;
  covers_to: string;
  tenant_name: string;
  landlord_name: string;
  landlord_phone: string;
  landlord_tax_id: string;
  landlord_nin: string;
  property_address: PlaceValue | null;
};
type Held = { id: string; name: string } | null;

/**
 * Declare Rent, or Change a year's declaration (the Guidelines 2026, paras 9.2 to 9.6): the rent the person paid and the
 * months it covers, the legal tenant, the landlord with a mobile number, a Tax ID or a NIN, the property's address (picked,
 * F27) and the evidence of payment through the upload engine. This year or the next.
 */
function RentForm({ employeeId, declaration: d, close }: { employeeId: string; declaration?: RentDeclaration; close: () => void }) {
  const thisYear = Number(todayIso().slice(0, 4));
  const years: Array<readonly [string, string]> = [thisYear, thisYear + 1].map((y) => [String(y), String(y)] as const);
  const [held, setHeld] = useState<Held>(d?.evidence_document_id ? { id: d.evidence_document_id, name: "Evidence on File" } : null);
  const body = (v: RentValues) => ({
    rent_paid: v.rent_paid === "" ? "" : toMoneyString(v.rent_paid),
    covers_from: v.covers_from,
    covers_to: v.covers_to,
    tenant_name: v.tenant_name,
    landlord_name: v.landlord_name,
    ...(v.landlord_phone && { landlord_phone: v.landlord_phone }),
    ...(v.landlord_tax_id && { landlord_tax_id: v.landlord_tax_id }),
    ...(v.landlord_nin && { landlord_nin: v.landlord_nin }),
    ...(v.property_address && { property_address: v.property_address }),
    ...(held && { evidence_document_id: held.id }),
  });
  const f = useContractForm<RentValues>(
    {
      year: String(d?.year ?? thisYear),
      rent_paid: d?.rent_paid ?? "",
      covers_from: d?.covers_from ?? `${thisYear}-01-01`,
      covers_to: d?.covers_to ?? `${thisYear}-12-01`,
      tenant_name: d?.tenant_name ?? "",
      landlord_name: d?.landlord_name ?? "",
      landlord_phone: d?.landlord_phone ?? "",
      landlord_tax_id: d?.landlord_tax_id ?? "",
      landlord_nin: d?.landlord_nin ?? "",
      property_address: placeValue(d?.property_address_place),
    },
    { safeParse: (v: RentValues) => organisation.RentDeclarationSave.safeParse(body(v)) },
  );
  const save = useMutation("PUT /api/v1/employees/:id/rent-declarations/:year");
  const [missing, setMissing] = useState(false);
  const submit = async () => {
    setMissing(!held);
    if (!f.check() || !held) return;
    try {
      await save.run({ params: { id: employeeId, year: Number(f.values.year) }, body: body(f.values) as never });
      invalidate("/api/v1/employees");
      close();
      toast(`Rent for ${f.values.year} declared`);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) f.setServerErrors(err.fields);
      else toast.error(err instanceof ApiError ? err.message : "Not declared. Try again.");
    }
  };
  return (
    <>
      {!d && (
        <Field label="Year" {...f.status("year")}>
          <SelectField options={years} {...f.field("year")} />
        </Field>
      )}
      <Field label="Rent Paid" {...f.status("rent_paid")}>
        <MoneyField {...f.field("rent_paid")} />
      </Field>
      <Grid cols={2}>
        <Field label="Covers From" {...f.status("covers_from")}>
          <MonthField {...f.field("covers_from")} />
        </Field>
        <Field label="Covers To" {...f.status("covers_to")}>
          <MonthField {...f.field("covers_to")} min={f.values.covers_from || undefined} />
        </Field>
      </Grid>
      <Field label="Legal Tenant" {...f.status("tenant_name")}>
        <TextField {...f.field("tenant_name")} maxLength={200} />
      </Field>
      <Field label="Landlord" {...f.status("landlord_name")}>
        <TextField {...f.field("landlord_name")} maxLength={200} />
      </Field>
      <Grid cols={2}>
        <Field label="Landlord Phone" optional {...f.status("landlord_phone")}>
          <PhoneField {...f.field("landlord_phone")} />
        </Field>
        <Field label="Landlord Tax ID" optional {...f.status("landlord_tax_id")}>
          <TextField {...f.field("landlord_tax_id")} autoComplete="off" />
        </Field>
      </Grid>
      <Field label="Landlord NIN" optional {...f.status("landlord_nin")}>
        <TextField {...f.field("landlord_nin")} inputMode="numeric" autoComplete="off" onChange={(t: string) => f.set("landlord_nin", t.replace(/\D/g, "").slice(0, 11))} />
      </Field>
      <Field label="Property Address" {...f.status("property_address")}>
        <AddressField {...f.field("property_address")} places={places} />
      </Field>
      <Field label="Evidence" state={missing && !held ? "bad" : undefined} message={missing && !held ? "Upload the evidence" : undefined}>
        {held ? (
          <FileRow
            name={held.name}
            action={
              <Button size="sm" onClick={() => setHeld(null)}>
                Replace File
              </Button>
            }
          />
        ) : (
          <UploadField
            upload={upload}
            purpose="document"
            accept=".pdf,image/*"
            multiple={false}
            compact
            onUploaded={(docs) => {
              setHeld(docs[0] ? { id: docs[0].document_id, name: docs[0].file_name } : null);
              setMissing(false);
            }}
          />
        )}
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>
          {d ? "Save Rent" : "Declare Rent"}
        </Button>
      </FormFooter>
    </>
  );
}
