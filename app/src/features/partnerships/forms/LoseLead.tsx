import { invalidate, useMutation } from "@/api/hooks";
import "@/api/types/partnerships";
import { Button, Field, FormFooter, rules, TextAreaField, toast, useContractForm } from "@mycity/ui";

/** Close as Lost, on the mock until M7 PR 3. */
export function LoseLead({ id, close }: { id: string; close: () => void }) {
  const f = useContractForm({ reason: "" }, { reason: rules.required("Give a reason") });
  const reason = f.values.reason;
  const lose = useMutation("POST /api/v1/partnerships/leads/:id/lose");
  return (
    <>
      <Field label="Why" {...f.field("reason")}><TextAreaField {...f.field("reason")} placeholder="Partner withdrew" /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={lose.pending} onClick={async () => { if (!f.check()) return; await lose.run({ params: { id }, body: { reason } }); invalidate("/api/v1/partnerships/leads"); close(); toast("Lead closed as lost"); }}>Close as Lost</Button>
      </FormFooter>
    </>
  );
}
