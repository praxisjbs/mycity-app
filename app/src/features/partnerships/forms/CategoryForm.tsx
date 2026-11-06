import { useMemo } from "react";
import partner_pipeline from "@mycity/contract/schemas/partner_pipeline.js";
import type { CategoryDetail } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useMutation } from "@/api/hooks";
import { Button, CheckboxField, Field, Form, FormError, FormFooter, FormRow, HelpTerm, NumberField, TextAreaField, TextField, toast, useContractForm } from "@mycity/ui";
import { useState } from "react";
import { refusal } from "../lib";

type Values = { name: string; description: string; commission: string; validity: string; vendor: boolean };

/**
 * New Category and Edit Category (docs/guides/partnerships.md §6.3, §10.1): a partnership type's name, what it
 * says of itself, the commission and validity its deals start from, and whether Analytics counts its leads
 * as vendor leads. Retiring and restoring are the record's own buttons.
 */
export function CategoryForm({ category, close, onSaved }: { category?: CategoryDetail; close: () => void; onSaved?: (c: CategoryDetail) => void }) {
  const create = useMutation("POST /api/v1/partnerships/categories");
  const change = useMutation("PATCH /api/v1/partnerships/categories/:id");
  const [error, setError] = useState<string | null>(null);
  const start = useMemo<Values>(
    () => ({
      name: category?.name ?? "",
      description: category?.description ?? "",
      commission: category?.default_commission_pct ? String(Number(category.default_commission_pct)) : "",
      validity: category?.default_validity_days ? String(category.default_validity_days) : "",
      vendor: category?.counts_as_vendor ?? false,
    }),
    [category],
  );

  /** What the API takes: a blank is left out on New, and clears the value on Edit. */
  const bodyOf = (v: Values) => {
    const base = { name: v.name.trim(), counts_as_vendor: v.vendor };
    if (!category) {
      return {
        ...base,
        ...(v.description.trim() ? { description: v.description.trim() } : {}),
        ...(v.commission ? { default_commission_pct: v.commission } : {}),
        ...(v.validity ? { default_validity_days: Number(v.validity) } : {}),
      };
    }
    return {
      ...(v.name !== start.name ? { name: base.name } : {}),
      ...(v.description !== start.description ? { description: v.description.trim() || null } : {}),
      ...(v.commission !== start.commission ? { default_commission_pct: v.commission || null } : {}),
      ...(v.validity !== start.validity ? { default_validity_days: v.validity ? Number(v.validity) : null } : {}),
      ...(v.vendor !== start.vendor ? { counts_as_vendor: v.vendor } : {}),
    };
  };
  const checked = useMemo(
    () => ({ safeParse: (v: unknown) => (category ? partner_pipeline.CategoryUpdate : partner_pipeline.CategoryCreate).safeParse(bodyOf(v as Values)) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [category, start],
  );
  const f = useContractForm<Values>(start, checked);

  const submit = async () => {
    setError(null);
    if (!f.check()) return;
    const body = bodyOf(f.values);
    if (category && Object.keys(body).length === 0) return close();
    try {
      const saved = category
        ? await change.run({ params: { id: category.partner_category_id }, body: body as never })
        : await create.run({ body: body as never });
      invalidate("/api/v1/partnerships/categories");
      close();
      toast(category ? "Category saved" : "Category added");
      onSaved?.(saved);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      if (!(e instanceof ApiError && Object.keys(e.fields).length)) setError(refusal(e, "Not saved. Check your connection and try again."));
    }
  };

  return (
    <Form onSubmit={submit}>
      <Field label="Name" {...f.status("name")}>
        <TextField {...f.field("name")} placeholder="Hospitality" />
      </Field>
      <Field label="Description" optional {...f.status("description")}>
        <TextAreaField {...f.field("description")} rows={2} />
      </Field>
      <FormRow>
        <Field label="Default Commission" optional help="The rate a new deal in this category starts from. A deal may differ." {...f.status("commission")}>
          <NumberField {...f.field("commission")} decimal placeholder="8" />
        </Field>
        <Field label="Default Validity" optional help="Days a signed deal runs when it names no other." {...f.status("validity")}>
          <NumberField {...f.field("validity")} placeholder="30" />
        </Field>
      </FormRow>
      <CheckboxField
        value={f.values.vendor}
        onChange={(v) => f.set("vendor", v)}
        label={<HelpTerm help="Analytics counts leads in this category as vendor leads.">Counts as Vendor</HelpTerm>}
      />
      <FormError>{error}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit">
          {category ? "Save Category" : "Add Category"}
        </Button>
      </FormFooter>
    </Form>
  );
}
