import { useMemo, useState } from "react";
import partner_pipeline from "@mycity/contract/schemas/partner_pipeline.js";
import type { CategoryDetail, Field as CustomField } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useMutation } from "@/api/hooks";
import { Button, ChoiceField, CheckboxField, Field, Form, FormError, FormFooter, HelpTerm, SelectField, TextAreaField, TextField, toast, useContractForm } from "@mycity/ui";
import { APPLIES_LABEL, FIELD_TYPE_LABEL, refusal } from "../lib";

type Values = { label: string; field_type: string; choices: string; applies_to: string; category: string; filterable: boolean };

const TYPES = Object.entries(FIELD_TYPE_LABEL) as Array<[string, string]>;
const PICKS = new Set(["pick", "multi_pick"]);

/** One choice a line, trimmed, none twice. */
const choicesOf = (text: string) => [...new Set(text.split("\n").map((x) => x.trim()).filter(Boolean))];

/**
 * Add Field and Edit Field (docs/guides/partnerships.md §6.3): a custom field for leads, partners or deals,
 * of one category or all. Its key is made from its label once and never changes, and its type with it; an
 * edit changes its label, its choices and whether lists filter by it. Retiring keeps its values.
 */
export function FieldForm({ category, field, close }: { category: CategoryDetail; field?: CustomField; close: () => void }) {
  const create = useMutation("POST /api/v1/partnerships/fields");
  const change = useMutation("PATCH /api/v1/partnerships/fields/:id");
  const [error, setError] = useState<string | null>(null);
  const start = useMemo<Values>(
    () => ({
      label: field?.label ?? "",
      field_type: field?.field_type ?? "text",
      choices: (field?.options ?? []).join("\n"),
      applies_to: field?.applies_to ?? "deal",
      category: field ? (field.partner_category_id ?? "") : category.partner_category_id,
      filterable: field?.filterable ?? false,
    }),
    [field, category],
  );

  const bodyOf = (v: Values) => {
    const options = choicesOf(v.choices);
    if (field) {
      return {
        ...(v.label.trim() !== start.label ? { label: v.label.trim() } : {}),
        ...(PICKS.has(field.field_type) && v.choices !== start.choices ? { options } : {}),
        ...(v.filterable !== start.filterable ? { filterable: v.filterable } : {}),
      };
    }
    return {
      label: v.label.trim(),
      field_type: v.field_type,
      applies_to: v.applies_to,
      ...(v.category ? { partner_category_id: v.category } : {}),
      ...(PICKS.has(v.field_type) ? { options } : {}),
      filterable: v.filterable,
    };
  };
  const checked = useMemo(
    () => ({ safeParse: (v: unknown) => (field ? partner_pipeline.FieldUpdate : partner_pipeline.FieldCreate).safeParse(bodyOf(v as Values)) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [field, start],
  );
  const f = useContractForm<Values>(start, checked);
  const pick = PICKS.has(field?.field_type ?? f.values.field_type);

  const submit = async () => {
    setError(null);
    if (!f.check()) return;
    const body = bodyOf(f.values);
    if (field && Object.keys(body).length === 0) return close();
    try {
      if (field) await change.run({ params: { id: field.partnership_field_id }, body: body as never });
      else await create.run({ body: body as never });
      invalidate("/api/v1/partnerships/categories");
      invalidate("/api/v1/partnerships/fields");
      close();
      toast(field ? "Field saved" : "Field added");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else setError(refusal(e, "Not saved. Check your connection and try again."));
    }
  };

  return (
    <Form onSubmit={submit}>
      <Field label="Label" {...f.status("label")}>
        <TextField {...f.field("label")} placeholder="Ticket Model" />
      </Field>
      {!field && (
        <Field label="Type" {...f.status("field_type")}>
          <SelectField {...f.field("field_type")} options={TYPES} />
        </Field>
      )}
      {pick && (
        <Field label="Choices" help="One choice on each line." {...f.status("choices")}>
          <TextAreaField {...f.field("choices")} rows={4} />
        </Field>
      )}
      {!field && (
        <>
          <Field label="Applies To" {...f.status("applies_to")}>
            <ChoiceField {...f.field("applies_to")} options={Object.entries(APPLIES_LABEL) as Array<[string, string]>} />
          </Field>
          <Field label="Category" {...f.status("category")}>
            <SelectField {...f.field("category")} options={[["", "All Categories"], [category.partner_category_id, category.name]]} />
          </Field>
        </>
      )}
      <CheckboxField
        value={f.values.filterable}
        onChange={(v) => f.set("filterable", v)}
        label={<HelpTerm help="The lists offer this field as a filter.">Filterable</HelpTerm>}
      />
      <FormError>{error}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit">
          {field ? "Save Field" : "Add Field"}
        </Button>
      </FormFooter>
    </Form>
  );
}
