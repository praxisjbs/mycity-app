import { useState } from "react";
import { useApi } from "@/api/hooks";
import { upload } from "@/api/upload";
import type { AiAttachmentKind, DocumentRef } from "@mycity/contract/contract.gen.ts";
import { Button, Field, FormFooter, HelpTerm, Icon, IconButton, RadioCards, Sub, TextField, UploadField, useContractForm, useModal, type ContractSchema, type IconName } from "@mycity/ui";

/**
 * Attach Document on Praxis AI · Ask (docs/guides/praxis-ai.md §1.10 decisions 41 and 42, §6.18,
 * §10): a paperclip beside the question box opens a modal where the person picks what the document
 * is, from the kinds they may attach, then the file (PDF or a photo, 10 MB), and Read Document asks
 * its question with the file. The kinds are what tells a person what may be attached; nothing else
 * can be. While reading is off the paperclip says so and opens nothing.
 */

/** What Read Document hands the conversation: the question asked with the file. */
export interface Attached {
  question: string;
  kind: AiAttachmentKind;
  document: DocumentRef;
}

/** Each kind's tile (§10.1): its icon and a caption of at most four words. */
const TILE: Record<AiAttachmentKind, { icon: IconName; caption: string }> = {
  invoice: { icon: "doc", caption: "Bill to pay" },
  payment_receipt: { icon: "wallet", caption: "Proof of a transfer" },
  contract: { icon: "signature", caption: "Signed or to sign" },
};

/** The file types the modal offers: what the Image Reading model reads itself (decision 42). */
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif";
const MAX_BYTES = 10 * 1024 * 1024;

type Values = { kind: string; document_id: string; question: string };

/** A kind picked and a file attached, each said on its field in at most four words (gate 12). */
const RULES: ContractSchema = {
  safeParse: (v: unknown) => {
    const x = (v ?? {}) as Partial<Values>;
    const issues = [
      ...(x.kind ? [] : [{ path: ["kind"], message: "Pick one", code: "custom" }]),
      ...(x.document_id ? [] : [{ path: ["document_id"], message: "Attach a file", code: "custom" }]),
    ];
    return issues.length ? { success: false, error: { issues } } : { success: true, data: v };
  },
};

function AttachForm({ kinds, close, onRead }: { kinds: Array<{ kind: AiAttachmentKind; label: string; question: string }>; close: () => void; onRead: (a: Attached) => Promise<unknown> | undefined }) {
  const [file, setFile] = useState<DocumentRef | null>(null);
  const f = useContractForm<Values>({ kind: kinds.length === 1 ? kinds[0]!.kind : "", document_id: "", question: "" }, RULES);
  const chosen = kinds.find((k) => k.kind === f.values.kind) ?? null;
  const read = async () => {
    if (!f.check() || !file || !chosen) return;
    close();
    await onRead({ question: f.values.question.trim() || chosen.question, kind: chosen.kind, document: file });
  };
  return (
    <>
      <Field label="What Is It?" {...f.status("kind")}>
        <RadioCards<string>
          value={f.values.kind || null}
          onChange={(v) => f.set("kind", v)}
          options={kinds.map((k) => ({ value: k.kind, label: k.label, caption: TILE[k.kind].caption, leading: <Icon name={TILE[k.kind].icon} /> }))}
        />
      </Field>
      <Field label={<HelpTerm help="PDF or a photo, up to 10 MB.">File</HelpTerm>} {...f.status("document_id")}>
        {file ? (
          <span className="flex flex-wrap items-center gap-2 text-xs">
            <Icon name="clip" size="s" />
            <span data-copy="content" className="wrap-any">{file.file_name}</span>
            <Sub className="phone:hidden">{Math.max(1, Math.round(file.size_bytes / 1024))} KB</Sub>
            <Button size="sm" onClick={async () => (setFile(null), f.set("document_id", ""))}>
              Remove
            </Button>
          </span>
        ) : (
          <UploadField
            upload={upload}
            purpose="ai_attachment"
            accept={ACCEPT}
            maxBytes={MAX_BYTES}
            multiple={false}
            compact
            onUploaded={(docs) => {
              const doc = docs[0];
              if (!doc) return;
              setFile(doc);
              f.set("document_id", doc.document_id);
            }}
          />
        )}
      </Field>
      <Field label="Question" optional {...f.status("question")}>
        <TextField {...f.field("question")} maxLength={500} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={read}>
          Read Document
        </Button>
      </FormFooter>
    </>
  );
}

/**
 * The paperclip beside the question box. Hidden from someone who may attach no kind; while reading
 * is off it says so (its Tooltip) and opens nothing.
 */
export function AttachDocument({ onRead }: { onRead: (a: Attached) => Promise<unknown> | undefined }) {
  const kinds = useApi("GET /api/v1/ai/attachment-kinds");
  const modal = useModal();
  const list = kinds.data?.kinds ?? [];
  if (!list.length) return null;
  const off = !kinds.data?.available;
  return (
    <IconButton
      icon="clip"
      label={off ? "Reading Documents Is Off" : "Attach Document"}
      aria-disabled={off || undefined}
      className="rounded-full"
      onClick={() => {
        if (off) return;
        modal.open({ title: "Attach Document", full: true, body: (close) => <AttachForm kinds={list} close={close} onRead={onRead} /> });
      }}
    />
  );
}
