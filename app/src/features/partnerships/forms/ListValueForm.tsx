import { useMemo, useState } from "react";
import partner_pipeline from "@mycity/contract/schemas/partner_pipeline.js";
import type { ListValue } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useMutation } from "@/api/hooks";
import { Button, Field, Form, FormError, FormFooter, HelpTerm, SelectField, TextField, toast, useContractForm } from "@mycity/ui";
import { MEANING_LABEL, refusal } from "../lib";

type Values = { label: string; meaning: string };

const MEANINGS = Object.entries(MEANING_LABEL) as Array<[string, string]>;

/**
 * Add and Edit on one of MyCity's lists (docs/guides/partnerships.md §6.3): a stage with what it counts as, or an
 * impact, a lead source or a document kind with its name alone. A stage's meaning is the fixed code the counts
 * switch on, so the stage may be renamed freely.
 */
export function ListValueForm({ list, noun, value, close }: { list: string; noun: string; value?: ListValue; close: () => void }) {
  const stage = list === "partnership_stage";
  const create = useMutation("POST /api/v1/partnerships/lists/:list");
  const change = useMutation("PATCH /api/v1/partnerships/lists/:list/:code");
  const [error, setError] = useState<string | null>(null);
  const start = useMemo<Values>(() => ({ label: value?.label ?? "", meaning: value?.meaning ?? "" }), [value]);
  const bodyOf = (v: Values) =>
    value
      ? { ...(v.label.trim() !== start.label ? { label: v.label.trim() } : {}), ...(stage && v.meaning && v.meaning !== start.meaning ? { meaning: v.meaning } : {}) }
      : { label: v.label.trim(), ...(stage && v.meaning ? { meaning: v.meaning } : {}) };
  const checked = useMemo(
    () => ({
      safeParse: (v: unknown) => {
        const x = v as Values;
        if (stage && !value && !x.meaning) return { success: false as const, error: { issues: [{ path: ["meaning"], message: "Pick one", code: "custom" }] } };
        return (value ? partner_pipeline.ListValueUpdate : partner_pipeline.ListValueCreate).safeParse(bodyOf(x));
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value, start, stage],
  );
  const f = useContractForm<Values>(start, checked as never);

  const submit = async () => {
    setError(null);
    if (!f.check()) return;
    const body = bodyOf(f.values);
    if (value && Object.keys(body).length === 0) return close();
    try {
      if (value) await change.run({ params: { list, code: value.code } as never, body: body as never });
      else await create.run({ params: { list } as never, body: body as never });
      invalidate(`/api/v1/partnerships/lists/${list}`);
      close();
      toast(value ? `${noun} saved` : `${noun} added`);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      setError(refusal(e, "Not saved. Check your connection and try again."));
    }
  };

  return (
    <Form onSubmit={submit}>
      <Field label="Name" {...f.status("label")}>
        <TextField {...f.field("label")} placeholder={stage ? "Proposal Sent" : "Brand Visibility"} />
      </Field>
      {stage && (
        <Field label={<HelpTerm help="The fixed meaning counts and reports use, so a stage can be renamed without breaking them.">Counts As</HelpTerm>} {...f.status("meaning")}>
          <SelectField {...f.field("meaning")} options={MEANINGS} placeholder="Choose One" />
        </Field>
      )}
      <FormError>{error}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit">
          {value ? `Save ${noun}` : `Add ${noun}`}
        </Button>
      </FormFooter>
    </Form>
  );
}
