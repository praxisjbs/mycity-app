import proposals from "@mycity/contract/schemas/proposals.js";
import type { ProposalDetail } from "@mycity/contract/contract.gen.ts";
import { invalidate, useApi, useInfinite, useMutation } from "@/api/hooks";
import { upload } from "@/api/upload";
import { paging } from "@/features/shared/wire";
import { Button, Field, FormFooter, SelectField, TextAreaField, toast, UploadField, useContractForm } from "@mycity/ui";
import { failed } from "../lib";

/**
 * The studio's Brief (docs/guides/partnerships.md §6.10 step 1): New Proposal on a deal, with the
 * meeting's notes, its transcript (Markdown or text, as Google Meet exports it), a cover photograph and
 * the partner's logo, and optionally a saved template. Claude's cards follow in the worker.
 */
export function Brief({ record, close, opened }: { record: { type: "lead" | "partner"; id: string } | null; close: () => void; opened: (p: ProposalDetail) => void }) {
  const f = useContractForm(
    { deal_id: "", notes: "", transcript_document_id: "", design_template_id: "", assets: [] as Array<{ document_id: string; role: "cover" | "logo"; alt: string }> },
    proposals.ProposalStart,
  );
  const deals = useInfinite("GET /api/v1/partnerships/deals", { filters: record ? (record.type === "lead" ? { lead_id: record.id } : { partner_id: record.id }) : {} });
  const templates = useInfinite("GET /api/v1/partnerships/proposal-templates");
  const picked = useApi("GET /api/v1/partnerships/deals/:id", { params: { id: f.values.deal_id }, enabled: Boolean(f.values.deal_id) });
  const start = useMutation("POST /api/v1/partnerships/proposals");
  const options = deals.rows.filter((d) => d.status === "open" || d.status === "live").map((d) => [d.deal_id, `${d.title} · ${d.record.name}`] as [string, string]);
  const image = (role: "cover" | "logo", alt: string) => (docs: Array<{ document_id: string }>) => {
    const rest = f.values.assets.filter((a) => a.role !== role);
    f.set("assets", docs[0] ? [...rest, { document_id: docs[0].document_id, role, alt }] : rest);
  };
  const name = picked.data ? picked.data.record.name : "The partner";

  const submit = async () => {
    if (!f.check()) return;
    try {
      const body = {
        deal_id: f.values.deal_id,
        ...(f.values.notes.trim() ? { notes: f.values.notes } : {}),
        ...(f.values.transcript_document_id ? { transcript_document_id: f.values.transcript_document_id } : {}),
        ...(f.values.design_template_id ? { design_template_id: f.values.design_template_id } : {}),
        ...(f.values.assets.length ? { assets: f.values.assets } : {}),
      };
      const p = await start.run({ body });
      invalidate("/api/v1/partnerships/proposals");
      close();
      toast(`${p.number} started`);
      opened(p);
    } catch (e) {
      failed(f)(e);
    }
  };

  return (
    <>
      <Field label="Deal" {...f.status("deal_id")}>
        <SelectField {...f.field("deal_id")} options={options} placeholder="Choose One" searchable {...paging(deals)} valueLabel={picked.data?.title} />
      </Field>
      <Field label="Notes" optional {...f.status("notes")}>
        <TextAreaField {...f.field("notes")} rows={5} />
      </Field>
      <Field label="Transcript" optional {...f.status("transcript_document_id")}>
        <UploadField purpose="attachment" accept=".md,.txt,text/markdown,text/plain" maxBytes={1024 * 1024} upload={upload} multiple={false} compact onUploaded={(docs) => f.set("transcript_document_id", docs[0]?.document_id ?? "")} />
      </Field>
      <Field label="Cover Photograph" optional>
        <UploadField purpose="photo" accept="image/*" upload={upload} multiple={false} compact onUploaded={image("cover", `${name}, the proposal's cover`)} />
      </Field>
      <Field label="Partner's Logo" optional>
        <UploadField purpose="photo" accept="image/*" upload={upload} multiple={false} compact onUploaded={image("logo", `${name} logo`)} />
      </Field>
      <Field label="Template" optional {...f.status("design_template_id")}>
        <SelectField {...f.field("design_template_id")} options={templates.rows.map((t) => [t.proposal_template_id, t.name] as [string, string])} placeholder="None" {...paging(templates)} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Start Proposal</Button>
      </FormFooter>
    </>
  );
}
