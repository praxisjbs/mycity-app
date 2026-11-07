import type { DealDetail, ListValue } from "@mycity/contract/contract.gen.ts";
import pipeline from "@mycity/contract/schemas/partner_pipeline.js";
import { useState } from "react";
import { invalidate, useMutation } from "@/api/hooks";
import { upload } from "@/api/upload";
import { Button, Field, FormError, FormFooter, TextAreaField, toast, UploadField, useContractForm } from "@mycity/ui";
import { failed } from "../lib";

/**
 * After a press on the stage switcher, what the move needs (docs/guides/partnerships.md §6.5): Why,
 * for a move back, On Hold or Closed Lost; the signed copy, for a signed stage of a deal not yet
 * signed. Checked by StageMove; the API decides.
 */
export function MoveStage({ deal, to, reason, copy, close }: { deal: Pick<DealDetail, "deal_id">; to: ListValue; reason: boolean; copy: boolean; close: () => void }) {
  const f = useContractForm({ stage: to.code, reason: "", signed_copy_document_id: "" }, pipeline.StageMove);
  const [problem, setProblem] = useState<string | null>(null);
  const move = useMutation("POST /api/v1/partnerships/deals/:id/stage");
  const go = async () => {
    if (!f.check()) return;
    if (reason && f.values.reason.trim().length < 10) {
      f.setServerErrors({ reason: ["At least 10 characters"] });
      return;
    }
    if (copy && !f.values.signed_copy_document_id) {
      setProblem("Attach the signed copy");
      return;
    }
    try {
      await move.run({ params: { id: deal.deal_id }, body: { stage: to.code, ...(f.values.reason.trim() && { reason: f.values.reason.trim() }), ...(f.values.signed_copy_document_id && { signed_copy_document_id: f.values.signed_copy_document_id }) } });
      invalidate("/api/v1/partnerships");
      close();
      toast(`Moved to ${to.label}`);
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <>
      {reason && <Field label="Why" {...f.status("reason")}><TextAreaField {...f.field("reason")} placeholder="Budget opens January" /></Field>}
      {copy && (
        <Field label="Signed Copy" {...f.status("signed_copy_document_id")}>
          <UploadField purpose="attachment" upload={upload} multiple={false} accept=".pdf,.jpg,.jpeg,.png" kinds="PDF or a photo" compact onUploaded={(docs) => (setProblem(null), f.set("signed_copy_document_id", docs[0]?.document_id ?? ""))} />
        </Field>
      )}
      {problem && <FormError>{problem}</FormError>}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={go}>Move Stage</Button>
      </FormFooter>
    </>
  );
}
