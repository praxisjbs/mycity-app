import { useMemo, useState } from "react";
import partner_pipeline from "@mycity/contract/schemas/partner_pipeline.js";
import type { CategoryDetail, ChecklistItem } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useMutation } from "@/api/hooks";
import { Button, ChoiceField, Field, Form, FormError, FormFooter, NumberField, TextAreaField, TextField, toast, useContractForm } from "@mycity/ui";
import { refusal } from "../lib";

type Values = { title: string; description: string; due_from: string; due_days: string };

const DUE: Array<[string, string]> = [
  ["signing", "After Signing"],
  ["event_start", "Before the Event"],
];

/**
 * Add Item and Edit Item on a category's delivery checklist (docs/guides/partnerships.md §6.7): what MyCity
 * delivers once a deal of the category is signed, and when it falls due, in days after signing or before the
 * event starts. Each active item becomes a Workspace task for the deal's owner; changing the list later never
 * changes a deal already signed.
 */
export function ChecklistForm({ category, item, close }: { category: CategoryDetail; item?: ChecklistItem; close: () => void }) {
  const create = useMutation("POST /api/v1/partnerships/categories/:id/checklist");
  const change = useMutation("PATCH /api/v1/partnerships/checklist-items/:id");
  const [error, setError] = useState<string | null>(null);
  const start = useMemo<Values>(
    () => ({ title: item?.title ?? "", description: item?.description ?? "", due_from: item?.due_from ?? "signing", due_days: item ? String(item.due_days) : "7" }),
    [item],
  );
  const bodyOf = (v: Values) => {
    const days = v.due_days === "" ? Number.NaN : Number(v.due_days);
    if (!item) return { title: v.title.trim(), ...(v.description.trim() ? { description: v.description.trim() } : {}), due_from: v.due_from, due_days: days };
    return {
      ...(v.title.trim() !== start.title ? { title: v.title.trim() } : {}),
      ...(v.description !== start.description ? { description: v.description.trim() || null } : {}),
      ...(v.due_from !== start.due_from ? { due_from: v.due_from } : {}),
      ...(v.due_days !== start.due_days ? { due_days: days } : {}),
    };
  };
  const checked = useMemo(
    () => ({ safeParse: (v: unknown) => (item ? partner_pipeline.ChecklistItemUpdate : partner_pipeline.ChecklistItemCreate).safeParse(bodyOf(v as Values)) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item, start],
  );
  const f = useContractForm<Values>(start, checked);

  const submit = async () => {
    setError(null);
    if (!f.check()) return;
    const body = bodyOf(f.values);
    if (item && Object.keys(body).length === 0) return close();
    try {
      if (item) await change.run({ params: { id: item.partner_category_checklist_item_id }, body: body as never });
      else await create.run({ params: { id: category.partner_category_id }, body: body as never });
      invalidate("/api/v1/partnerships/categories");
      close();
      toast(item ? "Item saved" : "Item added");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else setError(refusal(e, "Not saved. Check your connection and try again."));
    }
  };

  return (
    <Form onSubmit={submit}>
      <Field label="Item" {...f.status("title")}>
        <TextField {...f.field("title")} placeholder="Event registration" />
      </Field>
      <Field label="Details" optional {...f.status("description")}>
        <TextAreaField {...f.field("description")} rows={3} />
      </Field>
      <Field label="Due" {...f.status("due_from")}>
        <ChoiceField {...f.field("due_from")} options={DUE} />
      </Field>
      <Field label="Days" {...f.status("due_days")}>
        <NumberField {...f.field("due_days")} placeholder="7" />
      </Field>
      <FormError>{error}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit">
          {item ? "Save Item" : "Add Item"}
        </Button>
      </FormFooter>
    </Form>
  );
}
