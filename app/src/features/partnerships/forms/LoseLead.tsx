import leads from "@mycity/contract/schemas/leads.js";
import { invalidate, useMutation } from "@/api/hooks";
import { Button, Field, FormFooter, TextAreaField, toast, useContractForm } from "@mycity/ui";
import { failed } from "../lib";

/** Close as Lost (docs/guides/partnerships.md §6.4): why, and the deal moves to Closed Lost. */
export function LoseLead({ id, close }: { id: string; close: () => void }) {
  const f = useContractForm({ reason: "" }, leads.LeadLose);
  const lose = useMutation("POST /api/v1/partnerships/leads/:id/lose");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await lose.run({ params: { id }, body: { reason: f.values.reason.trim() } });
      invalidate("/api/v1/partnerships");
      close();
      toast("Lead closed as lost");
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <>
      <Field label="Why" {...f.status("reason")}><TextAreaField {...f.field("reason")} placeholder="Chose another app" /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="danger" onClick={submit}>Close as Lost</Button>
      </FormFooter>
    </>
  );
}
