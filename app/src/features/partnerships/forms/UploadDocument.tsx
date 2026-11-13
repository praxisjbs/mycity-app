import partners from "@mycity/contract/schemas/partners.js";
import { invalidate, useMutation } from "@/api/hooks";
import { upload } from "@/api/upload";
import { Button, ComboField, Field, FormFooter, toast, UploadField, useContractForm } from "@mycity/ui";
import { failed, useListSuggestions } from "../lib";

/**
 * Upload Document (docs/guides/partnerships.md §2, §6.3): a file for a lead or a partner, with its kind,
 * typed or picked from MyCity's document kinds; a kind they do not hold joins them.
 */
export function UploadDocument({ record, close }: { record: { type: "lead" | "partner"; id: string }; close: () => void }) {
  const kinds = useListSuggestions("partner_document_kind");
  const f = useContractForm({ document_id: "", kind: "", ...(record.type === "partner" ? { partner_id: record.id } : { lead_id: record.id }) }, partners.PartnerDocumentAttach);
  const attach = useMutation("POST /api/v1/partnerships/documents");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await attach.run({ body: f.values as never });
      invalidate("/api/v1/partnerships/documents");
      close();
      toast("Document uploaded");
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <>
      <Field label="Kind" {...f.status("kind")}><ComboField {...f.field("kind")} list={kinds} option={(k) => k.label} placeholder="Service Agreement" /></Field>
      <Field label="File" {...f.status("document_id")}>
        <UploadField purpose="attachment" upload={upload} multiple={false} compact onUploaded={(docs) => f.set("document_id", docs[0]?.document_id ?? "")} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Upload Document</Button>
      </FormFooter>
    </>
  );
}
