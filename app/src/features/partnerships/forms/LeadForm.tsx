import { invalidate, useMutation } from "@/api/hooks";
import "@/api/types/partnerships";
import { Button, Field, FormFooter, SelectField, TextField, toast, useContractForm } from "@mycity/ui";
import { opts } from "../lib";

/** New Lead, on the mock until M7 PR 3. */
export function LeadForm({ close }: { close: () => void }) {
  const f = useContractForm({ title: "", source: "BD conversation", next_action: "" }, { title: (v) => (v.trim().length < 4 ? "Who, and what about" : null) });
  const save = useMutation("POST /api/v1/partnerships/leads");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: f.values });
      invalidate("/api/v1/partnerships/leads");
      close();
      toast("Lead added");
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Field label="Lead" {...f.field("title")}><TextField {...f.field("title")} placeholder="Zenith events sponsorship" /></Field>
      <Field label="Source"><SelectField options={opts(["BD conversation", "Referral", "Inbound email", "Event", "Website form"])} {...f.field("source")} /></Field>
      <Field label="Next Action"><TextField {...f.field("next_action")} placeholder="Send one pager" /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Add Lead</Button>
      </FormFooter>
    </>
  );
}
