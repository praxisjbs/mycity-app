import { useState } from "react";
import { invalidate, useMutation } from "@/api/hooks";
import { upload } from "@/api/upload";
import { Button, Field, FormError, FormFooter, toast, UploadField } from "@mycity/ui";
import { fail } from "../lib";

/** Convert to Partner (docs/guides/partnerships.md §6.4): a deal signed outside the hub, with its signed copy. */
export function ConvertLead({ id, close, onConverted }: { id: string; close: () => void; onConverted: (partnerId: string) => void }) {
  const [copy, setCopy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const convert = useMutation("POST /api/v1/partnerships/leads/:id/convert");
  const submit = async () => {
    if (!copy) {
      setProblem("Attach the signed copy");
      return;
    }
    try {
      const made = await convert.run({ params: { id }, body: { signed_copy_document_id: copy } });
      invalidate("/api/v1/partnerships");
      close();
      toast("Now a partner");
      onConverted(made.partner_id);
    } catch (e) {
      fail(e);
    }
  };
  return (
    <>
      <Field label="Signed Copy">
        <UploadField purpose="attachment" upload={upload} multiple={false} accept=".pdf,.jpg,.jpeg,.png" kinds="PDF or a photo" compact onUploaded={(docs) => (setProblem(null), setCopy(docs[0]?.document_id ?? null))} />
      </Field>
      {problem && <FormError>{problem}</FormError>}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Convert to Partner</Button>
      </FormFooter>
    </>
  );
}
