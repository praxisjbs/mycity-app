import { invalidate, useMutation } from "@/api/hooks";
import "@/api/types/partnerships";
import { Button, DateField, Field, FormFooter, SelectField, TextAreaField, toast, todayIso, useContractForm } from "@mycity/ui";

/** Log Interaction, on the mock until M7 PR 3. */
export function LogInteraction({ id, close }: { id: string; close: () => void }) {
  const f = useContractForm({ kind: "call", happened_on: todayIso(), summary: "" }, { happened_on: (v) => (!v ? "When did it happen" : null), summary: (v) => (v.trim().length < 10 ? "Say what was agreed" : null) });
  const save = useMutation("POST /api/v1/partnerships/partners/:id/interactions");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id }, body: { kind: f.values.kind as "call", happened_on: f.values.happened_on, summary: f.values.summary.trim() } });
      invalidate("/api/v1/partnerships");
      close();
      toast("Interaction logged. The inactivity clock restarts");
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Field label="What"><SelectField options={[["call", "Call"], ["meeting", "Meeting"], ["email", "Email"], ["visit", "Visit"]]} {...f.field("kind")} /></Field>
      <Field label="When" {...f.field("happened_on")}><DateField {...f.field("happened_on")} max={todayIso()} /></Field>
      <Field label="Summary" {...f.field("summary")}><TextAreaField {...f.field("summary")} placeholder="Agreed a pilot" /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Log</Button>
      </FormFooter>
    </>
  );
}
