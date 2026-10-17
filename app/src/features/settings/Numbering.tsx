import settings from "@mycity/contract/schemas/settings.js";
import type { NumberingScheme, NumberingSchemeSave } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { Button, CheckboxField, ChoiceField, DataView, Field, Form, FormFooter, Grid, KpiGrid, KpiCard, NumberField, PageHeader, Pill, TextField, toast, todayIso, useContractForm, useModal } from "@mycity/ui";

const RESET: Record<NumberingScheme["reset"], string> = { never: "Never", yearly: "Each Year", monthly: "Each Month" };
const SEPARATORS: Array<[NumberingSchemeSave["separator"], string]> = [["-", "-"], ["/", "/"], [".", "."], ["_", "_"], ["", "None"]];

/** The next number a scheme would give, as the server formats it (shared/numbering/numbering.js format). */
function preview(s: { prefix: string; padding: number; separator: string; reset: NumberingScheme["reset"]; include_period: boolean }, seq: number) {
  const today = todayIso();
  const period = s.reset === "never" ? null : s.reset === "yearly" ? today.slice(0, 4) : today.slice(0, 7);
  const parts = [s.prefix.toUpperCase()];
  if (s.include_period && period) parts.push(period.replace("-", s.separator || "-"));
  if (s.padding > 0) parts.push(String(seq).padStart(s.padding, "0"));
  return parts.join(s.separator);
}

/**
 * Settings · Documents & Numbering (docs/guides/foundation.md §10): the scheme of
 * every numbered document type and the next number each would give. A change
 * applies to the next number; a number already issued never changes.
 */
export function NumberingTab() {
  const { can } = useAuth();
  const modal = useModal();
  const summary = useApi("GET /api/v1/settings/numbering/summary");
  const list = usePaged("GET /api/v1/settings/numbering");
  const canEdit = can("settings", "edit");
  return (
    <>
      <PageHeader title="Documents & Numbering" sub="How each document is numbered" />
      {summary.data && (
        <KpiGrid>
          <KpiCard title="Document Types" value={summary.data.types} />
          <KpiCard title="Numbers Issued" value={summary.data.issued.toLocaleString("en-NG")} />
          <KpiCard title="Reset Each Period" value={summary.data.resetting} />
        </KpiGrid>
      )}
      <DataView
        className="mt-3"
        title="Numbering"
        list={list}
        search="Search Documents"
        rowKey={(n: NumberingScheme) => n.doc_type}
        noun="document type"
        onRowClick={canEdit ? (n) => modal.open({ title: n.label, body: (close) => <SchemeForm scheme={n} close={close} /> }) : undefined}
        columns={[
          { key: "doc_type", label: "Document", sortable: true, render: (n) => <b>{n.label}</b> },
          { key: "next", label: "Next Number", render: (n) => <span className="font-mono tabular-nums">{n.next}</span> },
          { key: "prefix", label: "Prefix", sortable: true, desktop: true, render: (n) => n.prefix || <Pill>None</Pill> },
          { key: "reset", label: "Starts Again", render: (n: NumberingScheme) => RESET[n.reset] },
          { key: "issued", label: "Issued", align: "n", desktop: true, render: (n) => n.issued.toLocaleString("en-NG") },
        ]}
      />
    </>
  );
}

function SchemeForm({ scheme, close }: { scheme: NumberingScheme; close: () => void }) {
  const save = useMutation("PUT /api/v1/settings/numbering/:doc_type");
  const f = useContractForm(
    { prefix: scheme.prefix, padding: scheme.padding, separator: scheme.separator as NumberingSchemeSave["separator"], reset: scheme.reset, include_period: scheme.include_period },
    settings.NumberingSchemeSave,
  );
  const v = f.values;
  const submit = async () => {
    try {
      await save.run({ params: { doc_type: scheme.doc_type }, body: v });
      invalidate("/api/v1/settings/numbering");
      close();
      toast(`${scheme.label} numbering saved`);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Something went wrong");
    }
  };
  return (
    <Form onSubmit={f.submit(submit)}>
      <p className="mb-3 text-sm" data-copy="content">
        Next: <b className="font-mono tabular-nums">{preview(v, scheme.reset === v.reset ? scheme.issued + 1 : 1)}</b>
      </p>
      <Grid cols={2}>
        <Field label="Prefix" optional {...f.status("prefix")}>
          <TextField {...f.field("prefix")} placeholder="EXP" maxLength={8} />
        </Field>
        <Field label="Digits" {...f.status("padding")}>
          <NumberField value={String(v.padding)} onChange={(x) => f.set("padding", Number(x || 0))} onBlur={f.field("padding").onBlur} name="padding" />
        </Field>
      </Grid>
      <Field label="Separator" {...f.status("separator")}>
        <ChoiceField value={v.separator} onChange={(x) => f.set("separator", x)} options={SEPARATORS} />
      </Field>
      <Field label="Starts Again" {...f.status("reset")}>
        <ChoiceField value={v.reset} onChange={(x) => f.set("reset", x)} options={Object.entries(RESET) as Array<[NumberingScheme["reset"], string]>} />
      </Field>
      <Field label="Period" {...f.status("include_period")}>
        <CheckboxField label="Put the year or month in the number" value={v.include_period} onChange={(x) => f.set("include_period", x)} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit" busy={save.pending}>
          Save Numbering
        </Button>
      </FormFooter>
    </Form>
  );
}
