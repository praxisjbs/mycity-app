import { useMemo, useState } from "react";
import proposals from "@mycity/contract/schemas/proposals.js";
import type { ProofPoint } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useMutation } from "@/api/hooks";
import { upload } from "@/api/upload";
import { Button, Field, Form, FormError, FormFooter, SelectField, TextAreaField, TextField, toast, UploadField, useContractForm } from "@mycity/ui";
import { refusal } from "../lib";

type Values = { kind: string; label: string; value: string; detail: string; source_note: string };

export const PROOF_KIND = { stat: "Figure", partner_logo: "Partner Logo", endorsement: "Endorsement", result: "Result" } as const;
const KINDS = Object.entries(PROOF_KIND) as Array<[string, string]>;
const IMAGE_MAX = 5 * 1024 * 1024;

/**
 * Add Proof Point and Edit Proof Point (docs/guides/partnerships.md §6.11): a fact about MyCity a proposal may
 * cite, as MyCity says it: a figure ("10,000+"), a partner's logo, an endorsement or a past result, with where
 * it comes from. A logo or picture is uploaded to a proof point that exists, so Edit carries the upload.
 */
export function ProofPointForm({ point, close }: { point?: ProofPoint; close: () => void }) {
  const create = useMutation("POST /api/v1/partnerships/proof-points");
  const change = useMutation("PATCH /api/v1/partnerships/proof-points/:id");
  const [error, setError] = useState<string | null>(null);
  const start = useMemo<Values>(
    () => ({ kind: point?.kind ?? "stat", label: point?.label ?? "", value: point?.value ?? "", detail: point?.detail ?? "", source_note: point?.source_note ?? "" }),
    [point],
  );
  const bodyOf = (v: Values) => {
    if (!point)
      return {
        kind: v.kind,
        label: v.label.trim(),
        ...(v.value.trim() ? { value: v.value.trim() } : {}),
        ...(v.detail.trim() ? { detail: v.detail.trim() } : {}),
        ...(v.source_note.trim() ? { source_note: v.source_note.trim() } : {}),
      };
    return {
      ...(v.label.trim() !== start.label ? { label: v.label.trim() } : {}),
      ...(v.value !== start.value ? { value: v.value.trim() || null } : {}),
      ...(v.detail !== start.detail ? { detail: v.detail.trim() || null } : {}),
      ...(v.source_note !== start.source_note ? { source_note: v.source_note.trim() || null } : {}),
    };
  };
  const checked = useMemo(
    () => ({ safeParse: (v: unknown) => (point ? proposals.ProofPointUpdate : proposals.ProofPointCreate).safeParse(bodyOf(v as Values)) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [point, start],
  );
  const f = useContractForm<Values>(start, checked);

  const submit = async () => {
    setError(null);
    if (!f.check()) return;
    const body = bodyOf(f.values);
    if (point && Object.keys(body).length === 0) return close();
    try {
      if (point) await change.run({ params: { id: point.proof_point_id }, body: body as never });
      else await create.run({ body: body as never });
      invalidate("/api/v1/partnerships/proof-points");
      close();
      toast(point ? "Proof point saved" : "Proof point added");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else setError(refusal(e, "Not saved. Check your connection and try again."));
    }
  };

  const removeImage = async () => {
    if (!point) return;
    try {
      await change.run({ params: { id: point.proof_point_id }, body: { document_id: null } });
      invalidate("/api/v1/partnerships/proof-points");
      close();
      toast("Image removed");
    } catch (e) {
      toast(refusal(e, "Not removed. Try again."));
    }
  };

  return (
    <Form onSubmit={submit}>
      <Field label="Kind" {...f.status("kind")}>
        <SelectField {...f.field("kind")} options={KINDS} disabled={Boolean(point)} />
      </Field>
      <Field label="Label" {...f.status("label")}>
        <TextField {...f.field("label")} placeholder="Network and community" />
      </Field>
      <Field label="Figure" optional {...f.status("value")}>
        <TextField {...f.field("value")} placeholder="10,000+" />
      </Field>
      <Field label="Detail" optional {...f.status("detail")}>
        <TextAreaField {...f.field("detail")} rows={2} />
      </Field>
      <Field label="Source" optional {...f.status("source_note")}>
        <TextField {...f.field("source_note")} />
      </Field>
      {point && (
        <Field label="Image" optional>
          <UploadField
            upload={upload}
            purpose="photo"
            endpoint={`/api/v1/partnerships/proof-points/${point.proof_point_id}/image`}
            multiple={false}
            accept=".png,.jpg,.jpeg,.webp"
            maxBytes={IMAGE_MAX}
            compact
            onUploaded={() => {
              invalidate("/api/v1/partnerships/proof-points");
              toast("Image saved");
            }}
          />
          {point.document && (
            <Button size="sm" variant="ghost" icon="trash" onClick={removeImage}>
              Remove Image
            </Button>
          )}
        </Field>
      )}
      <FormError>{error}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit">
          {point ? "Save Proof Point" : "Add Proof Point"}
        </Button>
      </FormFooter>
    </Form>
  );
}
