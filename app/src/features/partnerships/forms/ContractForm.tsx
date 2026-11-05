import { invalidate, useInfinite, useMutation } from "@/api/hooks";
import "@/api/types/partnerships";
import type { Contract } from "@/api/types/partnerships";
import { paging } from "@/features/shared/wire";
import { Button, Field, FormFooter, MoneyField, SelectField, TextField, toast, useContractForm } from "@mycity/ui";

/** New Contract, on the mock until M7 PR 6 brings Generate Agreement. */
export function ContractForm({ close }: { close: () => void }) {
  const partners = useInfinite("GET /api/v1/partnerships/partners");
  const f = useContractForm({ partner_id: "", title: "", kind: "Contract", value: "" }, { partner_id: (v) => (!v ? "Pick the partner" : null), title: (v) => (!v.trim() ? "Name the document" : null), value: (v) => (!(Number(v) > 0) ? "Enter the value" : null) });
  const save = useMutation("POST /api/v1/partnerships/contracts");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: { ...f.values, kind: f.values.kind as Contract["kind"] } });
      invalidate("/api/v1/partnerships/contracts");
      close();
      toast("Draft created. It goes to review next");
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Field label="Partner" {...f.field("partner_id")}><SelectField placeholder="Pick the partner" options={partners.rows.map((p) => [p.partner_id, p.name])} {...paging(partners)} {...f.field("partner_id")} /></Field>
      <Field label="Document" {...f.field("title")}><TextField {...f.field("title")} placeholder="e.g. Activation agreement" /></Field>
      <Field label="Type"><SelectField options={[["Contract", "Contract"], ["MOU", "MOU"]]} {...f.field("kind")} /></Field>
      <Field label="Value" {...f.field("value")}><MoneyField {...f.field("value")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Create Draft</Button>
      </FormFooter>
    </>
  );
}
