import { useState } from "react";
import { invalidate, useMutation } from "@/api/hooks";
import { upload } from "@/api/upload";
import { Button, CheckboxField, Field, FormError, FormFooter, toast, UploadField } from "@mycity/ui";
import { fail } from "../lib";

/**
 * Convert to Partner (docs/guides/partnerships.md §6.4): a deal signed outside the hub, with its signed
 * copy; a deal with no projected value is ticked as signed with no money value (`unvalued`, QA F53).
 */
export function ConvertLead({ id, unvalued = false, close, onConverted }: { id: string; unvalued?: boolean; close: () => void; onConverted: (partnerId: string) => void }) {
  const [copy, setCopy] = useState<string | null>(null);
  const [noMoney, setNoMoney] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const convert = useMutation("POST /api/v1/partnerships/leads/:id/convert");
  const submit = async () => {
    if (!copy) {
      setProblem("Attach the signed copy");
      return;
    }
    if (unvalued && !noMoney) {
      setProblem("Add the deal's value on Edit Deal, or tick No Money Value.");
      return;
    }
    try {
      const made = await convert.run({ params: { id }, body: { signed_copy_document_id: copy, ...(unvalued && noMoney && { non_monetary: true }) } });
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
      {unvalued && <CheckboxField label="No Money Value" value={noMoney} onChange={(on) => (setProblem(null), setNoMoney(on))} />}
      {problem && <FormError>{problem}</FormError>}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Convert to Partner</Button>
      </FormFooter>
    </>
  );
}
