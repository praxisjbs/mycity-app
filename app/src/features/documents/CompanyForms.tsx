/**
 * The Document Centre's own documents (docs/guides/document-centre.md §6.4, §6.5, §10): Upload
 * Document, Edit Details and Upload New Version, each in the shared modal (a sheet on a phone). The
 * file goes to the upload engine first (POST /documents, the `document` purpose); the form then
 * claims it with its details. Rules come from the contract (useContractForm): the form writes none.
 */
import { useState } from "react";
import librarySchemas from "@mycity/contract/schemas/library.js";
import type { DocumentRef, LibraryDocument } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { useInfinite, useMutation, usePaged } from "@/api/hooks";
import { upload } from "@/api/upload";
import { paging } from "@/features/shared/wire";
import {
  Button,
  ComboListField,
  DateField,
  Field,
  FileRow,
  FormError,
  FormFooter,
  SelectField,
  TextAreaField,
  TextField,
  toast,
  UploadField,
  useContractForm,
} from "@mycity/ui";

/** What the vault keeps for a document, and its limit (mime-policy.js `document`, 25 MB). */
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.docx,.xlsx";
const MAX_BYTES = 25 * 1024 * 1024;
const KINDS = "PDF, Word, Excel or a photo";
const MAX_TAGS = 8;

/** The categories the person may file in, 25 at a time as the menu scrolls (F32). */
function useCategories() {
  return useInfinite("GET /api/v1/library/categories", { filters: {} });
}

/** The tags in use, as suggestions while a tag is typed. */
function useTags() {
  return usePaged("GET /api/v1/library/tags", { filters: {} });
}

/** A server refusal on its fields, else one line above the footer. */
function refusal(e: unknown, mark: (fields: Record<string, string[]>) => void): string {
  if (e instanceof ApiError && Object.keys(e.fields).length) {
    mark(e.fields);
    return "";
  }
  return e instanceof ApiError ? e.message : "Not saved. Try again.";
}

/** The file field: the upload engine's drop zone, then the file that arrived with Replace. */
function FileField({ file, onFile, message }: { file: DocumentRef | null; onFile: (doc: DocumentRef | null) => void; message?: string }) {
  return (
    <Field label="File" state={message ? "bad" : undefined} message={message}>
      {file ? (
        <FileRow name={file.file_name} sizeBytes={file.size_bytes} action={<Button onClick={() => onFile(null)}>Replace File</Button>} />
      ) : (
        <UploadField purpose="document" upload={upload} accept={ACCEPT} maxBytes={MAX_BYTES} multiple={false} kinds={KINDS} compact onUploaded={(docs) => onFile(docs[0] ?? null)} />
      )}
    </Field>
  );
}

/** What Upload Document and Edit Details share, and the form either holds them in. */
type Shared = { document_category_id: string; tags: string[]; expires_on: string; description: string };
type SharedForm<T extends Shared> = ReturnType<typeof useContractForm<T>>;

/** The fields Upload Document and Edit Details share: category, tags, expiry and description. */
function DetailFields<T extends Shared>({ f, category }: { f: SharedForm<T>; category?: { id: string; name: string } | null }) {
  const categories = useCategories();
  const tags = useTags();
  return (
    <>
      <Field label="Category" {...f.status("document_category_id")}>
        <SelectField
          {...f.field("document_category_id")}
          placeholder="Choose One"
          options={categories.rows.map((c) => [c.document_category_id, c.name] as [string, string])}
          valueLabel={category && f.values.document_category_id === category.id ? category.name : undefined}
          {...paging(categories)}
        />
      </Field>
      <Field label="Tags" optional {...f.status("tags")}>
        <ComboListField
          value={(f.values.tags as string[] | undefined) ?? []}
          onChange={(v) => f.set("tags", v.map((t) => t.toLowerCase()) as T["tags"])}
          list={tags}
          option={(t) => t.tag}
          max={MAX_TAGS}
          placeholder="licence"
        />
      </Field>
      <Field label="Expires" optional {...f.status("expires_on")}>
        <DateField {...f.field("expires_on")} />
      </Field>
      <Field label="Description" optional {...f.status("description")}>
        <TextAreaField {...f.field("description")} rows={3} maxLength={2000} />
      </Field>
    </>
  );
}

/** Upload Document: a file, its title, category, tags, expiry and description (§6.5). */
export function UploadForm({ close, onSaved }: { close: () => void; onSaved: (d: LibraryDocument) => void }) {
  const f = useContractForm(
    { document_id: "", title: "", document_category_id: "", tags: [] as string[], expires_on: "", description: "" },
    librarySchemas.CompanyDocumentCreate,
  );
  const [file, setFile] = useState<DocumentRef | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const run = useMutation("POST /api/v1/library/documents");
  const pick = (doc: DocumentRef | null) => {
    setFile(doc);
    f.set("document_id", doc?.document_id ?? "");
    if (doc && !f.values.title) f.set("title", doc.file_name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " "));
  };
  const save = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      const made = await run.run({ body: f.values });
      close();
      onSaved(made);
      toast("Document uploaded");
    } catch (e) {
      setProblem(refusal(e, f.setServerErrors) || null);
    }
  };
  return (
    <>
      <FileField file={file} onFile={pick} message={f.status("document_id").message} />
      <Field label="Title" {...f.status("title")}>
        <TextField {...f.field("title")} placeholder="CAC Certificate" maxLength={200} />
      </Field>
      <DetailFields f={f} />
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={save}>
          Upload Document
        </Button>
      </FormFooter>
    </>
  );
}

/** Edit Details: the title, category, tags, expiry and description; an empty one is cleared. */
export function DetailsForm({ doc, close, onSaved }: { doc: LibraryDocument; close: () => void; onSaved: (d: LibraryDocument) => void }) {
  const company = doc.company!;
  const f = useContractForm(
    {
      title: doc.title,
      document_category_id: company.category.document_category_id,
      tags: company.tags,
      expires_on: doc.expires_on ?? "",
      description: company.description ?? "",
    },
    librarySchemas.CompanyDocumentUpdate,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const run = useMutation("PATCH /api/v1/library/documents/:id");
  const save = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      const saved = await run.run({ params: { id: doc.document_id }, body: f.values });
      close();
      onSaved(saved);
      toast("Details saved");
    } catch (e) {
      setProblem(refusal(e, f.setServerErrors) || null);
    }
  };
  return (
    <>
      <Field label="Title" {...f.status("title")}>
        <TextField {...f.field("title")} maxLength={200} />
      </Field>
      <DetailFields f={f} category={{ id: company.category.document_category_id, name: company.category.name }} />
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={save}>
          Save Details
        </Button>
      </FormFooter>
    </>
  );
}

/** Upload New Version: the new file takes the document's place; the old one stays in its versions. */
export function VersionForm({ doc, close, onSaved }: { doc: LibraryDocument; close: () => void; onSaved: (d: LibraryDocument) => void }) {
  const f = useContractForm({ document_id: "" }, librarySchemas.CompanyDocumentVersion);
  const [file, setFile] = useState<DocumentRef | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const run = useMutation("POST /api/v1/library/documents/:id/versions");
  const pick = (picked: DocumentRef | null) => {
    setFile(picked);
    f.set("document_id", picked?.document_id ?? "");
  };
  const save = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      const saved = await run.run({ params: { id: doc.document_id }, body: f.values });
      close();
      onSaved(saved);
      toast(`Version ${saved.version} uploaded`);
    } catch (e) {
      setProblem(refusal(e, f.setServerErrors) || null);
    }
  };
  return (
    <>
      <FileField file={file} onFile={pick} message={f.status("document_id").message} />
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={save}>
          Upload Version
        </Button>
      </FormFooter>
    </>
  );
}
