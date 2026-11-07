import partners from "@mycity/contract/schemas/partners.js";
import { invalidate, useMutation } from "@/api/hooks";
import { Button, Field, FormFooter, TextAreaField, toast, useContractForm } from "@mycity/ui";
import { failed } from "../lib";

/** Close Partner (docs/guides/partnerships.md §6.6): why; its open and live deals are lost with it. */
export function ClosePartner({ id, close }: { id: string; close: () => void }) {
  const f = useContractForm({ reason: "" }, partners.PartnerClose);
  const shut = useMutation("POST /api/v1/partnerships/partners/:id/close");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await shut.run({ params: { id }, body: { reason: f.values.reason.trim() } });
      invalidate("/api/v1/partnerships");
      close();
      toast("Partner closed");
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <>
      <Field label="Why" {...f.status("reason")}><TextAreaField {...f.field("reason")} placeholder="Left the platform" /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="danger" onClick={submit}>Close Partner</Button>
      </FormFooter>
    </>
  );
}
