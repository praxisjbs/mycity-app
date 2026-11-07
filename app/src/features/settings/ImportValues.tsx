import type { ImportValueField, ImportValueList } from "@mycity/contract/contract.gen.ts";
import type { PersonRef } from "@/api/types/common";
import { EmployeePicker } from "@/features/shared/pickers";
import { places } from "@/features/shared/places";
import { AddressField, Card, CardHeader, EmptyState, Field, SelectField } from "@mycity/ui";

/**
 * Settings · Imports, the Map Values step (docs/guides/foundation.md §5, Map Values): each distinct
 * value of a list, person or place column, once, with its row count, mapped to a list value, a
 * person or a city, created when the import commits, or left empty. What the importer would match
 * on its own is chosen already; the person corrects what it got wrong.
 */

/** One value's choice, as PUT /imports/:id/values takes it. */
export type ValueTarget = { to: string | null } | { create: true };
/** Every value's choice, by field and the value as the file spells it. */
export type ValueChoices = Record<string, Record<string, ValueTarget>>;

const CREATE = "+create";
const EMPTY = "";

/** What each value starts at: what was chosen before, else what it matches, else created (when it may be), else empty. */
export function initialChoices(list: ImportValueList): ValueChoices {
  return Object.fromEntries(
    list.fields.map((f) => [
      f.field,
      Object.fromEntries(
        f.values.map((v) => {
          const t: ValueTarget = v.target
            ? v.target.create
              ? { create: true }
              : { to: v.target.to ?? null }
            : v.suggested
              ? { to: v.suggested }
              : f.create_missing
                ? { create: true }
                : { to: null };
          return [v.value, t];
        }),
      ),
    ]),
  );
}

/** A value's label: its spelling and how many rows hold it. */
const labelOf = (value: string, rows: number) => `${value} (${rows})`;

function ListChoice({ field, value, target, onChange }: { field: ImportValueField; value: string; target: ValueTarget | undefined; onChange: (t: ValueTarget) => void }) {
  const options: Array<[string, string]> = [
    [EMPTY, "Leave Empty"],
    ...(field.create_missing ? [[CREATE, `Create ${value}`] as [string, string]] : []),
    ...field.choices.map((o) => [o.value, o.label] as [string, string]),
  ];
  const current = !target ? EMPTY : "create" in target ? CREATE : (target.to ?? EMPTY);
  return (
    <SelectField
      value={current}
      searchable={options.length > 8}
      onChange={(v) => onChange(v === CREATE ? { create: true } : { to: v || null })}
      options={options}
    />
  );
}

function PersonChoice({ value, label, onChange }: { value: string | null; label: string | null; onChange: (t: ValueTarget) => void }) {
  const picked: PersonRef[] = value ? [{ employee_id: value, display_name: label ?? "" }] : [];
  return <EmployeePicker value={picked} onChange={(people) => onChange({ to: people[0]?.employee_id ?? null })} placeholder="No Owner" />;
}

function PlaceChoice({ value, onChange }: { value: string | null; onChange: (t: ValueTarget) => void }) {
  return <AddressField level="city" places={places} value={value ? { token: value } : null} onChange={(p) => onChange({ to: p?.token ?? null })} placeholder="Pick a city" />;
}

export function ImportValues({ list, choices, onChange }: { list: ImportValueList; choices: ValueChoices; onChange: (next: ValueChoices) => void }) {
  if (list.fields.length === 0) return <EmptyState title="Nothing To Map" text="This sheet has no values to match." icon="check" />;
  const set = (field: string, value: string, t: ValueTarget) => onChange({ ...choices, [field]: { ...(choices[field] ?? {}), [value]: t } });
  return (
    <div className="grid gap-3">
      {list.fields.map((f) => (
        <Card key={f.field}>
          <CardHeader title={f.label} />
          {f.values.length === 0 && <p className="text-sm text-subtle-foreground">No values in this column.</p>}
          {f.values.map((v) => {
            const t = choices[f.field]?.[v.value];
            const to = t && "to" in t ? t.to : null;
            // A person or a place picked here carries its label once; until then, what the server matched.
            const label = to && to === v.target?.to ? v.target_label : to && to === v.suggested ? v.suggested_label : null;
            return (
              <Field key={v.value} label={labelOf(v.value, v.rows)}>
                {f.kind === "list" ? (
                  <ListChoice field={f} value={v.value} target={t} onChange={(next) => set(f.field, v.value, next)} />
                ) : f.kind === "person" ? (
                  <PersonChoice value={to} label={label} onChange={(next) => set(f.field, v.value, next)} />
                ) : (
                  <PlaceChoice value={to} onChange={(next) => set(f.field, v.value, next)} />
                )}
              </Field>
            );
          })}
        </Card>
      ))}
    </div>
  );
}
