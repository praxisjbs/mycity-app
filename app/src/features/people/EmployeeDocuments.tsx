import { useState } from "react";
import documentSchemas from "@mycity/contract/schemas/documents.js";
import type { DocumentRow } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { saveFile } from "@/api/download";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { upload } from "@/api/upload";
import { useMe } from "@/auth/AuthProvider";
import { useFileViewer, viewableFile } from "@/features/shared/files";
import {
  ActionGroup,
  Button,
  Card,
  CardHeader,
  DataView,
  Field,
  FormError,
  FormFooter,
  formatDate,
  KeyValue,
  ListDetail,
  Pill,
  StatStrip,
  TextAreaField,
  TextField,
  toast,
  UploadField,
  useContractForm,
  useModal,
  useSideBySide,
  type StatusTone,
} from "@mycity/ui";

/**
 * The employee record's Documents tab (docs/guides/foundation.md §2, §5 track B; docs/guides/offers.md
 * §2): every document held on the person, the ones People asked for and are still missing, and what
 * expires soon, on the `documents` module's routes. A row opens the document beside the list on a wide
 * desktop and in a sheet on a phone (ListDetail, F31), with View File and Download; Verify Document for
 * one awaiting a check (`people` edit). Upload Document files one on
 * their record and Request Document asks them for one (both `people` edit). A new hire's onboarding
 * uploads land here from acceptance on.
 */

const STATUS: Record<DocumentRow["status"], [StatusTone, string]> = {
  signed: ["ok", "Signed"],
  verified: ["ok", "Verified"],
  expiring: ["warn", "Expiring"],
  awaiting_verification: ["warn", "Awaiting Check"],
  missing: ["err", "Missing"],
};
const pill = (d: DocumentRow) => <Pill tone={STATUS[d.status][0]}>{STATUS[d.status][1]}</Pill>;

export function EmployeeDocuments({ id }: { id: string }) {
  const me = useMe();
  const modal = useModal();
  const files = useFileViewer();
  const mayEdit = Boolean(me.grants.people?.includes("edit"));
  const list = usePaged("GET /api/v1/employees/:id/documents", { params: { id } });
  const summary = useApi("GET /api/v1/employees/:id/documents/summary", { params: { id } });
  const refresh = () => {
    invalidate(`/api/v1/employees/${id}/documents`);
    summary.reload();
  };
  const add = (row?: DocumentRow) => modal.open({ title: "Upload Document", body: (close) => <UploadForm id={id} row={row ?? null} close={close} onSaved={refresh} /> });
  const ask = () => modal.open({ title: "Request Document", body: (close) => <RequestForm id={id} close={close} onSaved={refresh} /> });
  // The record in view: the picked row as the list now holds it; beside the list the first shows unasked (F31).
  const beside = useSideBySide();
  const [pick, setPick] = useState<string | null>(null);
  const picked = pick ? (list.rows.find((d) => d.row_key === pick) ?? null) : null;
  const shown = picked ?? (beside ? (list.rows[0] ?? null) : null);
  const s = summary.data;
  return (
    <>
      <StatStrip
        items={[
          { label: "Documents", value: String(s?.documents ?? 0) },
          { label: "Signed", value: String(s?.signed ?? 0), tone: "ok" },
          { label: "Verified", value: String(s?.verified ?? 0), tone: "ok" },
          { label: "Expiring", value: String(s?.expiring ?? 0), tone: "warn" },
          { label: "Missing", value: String(s?.missing ?? 0), tone: "err" },
        ]}
      />
      <ListDetail
        open={picked !== null}
        onClose={() => setPick(null)}
        title="Document"
        list={
      <DataView<DocumentRow>
        title="Documents"
        list={list}
        rowKey={(d) => d.row_key}
        noun="document"
        onRowClick={(d) => setPick(d.row_key)}
        selectedKey={shown ? shown.row_key : null}
        right={
          mayEdit ? (
            <ActionGroup>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" icon="mail" onClick={ask}>Request Document</Button>
                <Button size="sm" variant="primary" icon="upload" onClick={() => add()}>Upload Document</Button>
              </div>
            </ActionGroup>
          ) : undefined
        }
        empty={{ title: "No Documents Yet", icon: "doc" }}
        columns={[
          { key: "name", label: "Document", render: (d) => <span className="font-medium" data-copy="content">{d.name}</span> },
          { key: "uploaded_at", label: "Uploaded", render: (d) => (d.uploaded_at ? formatDate(d.uploaded_at) : null) },
          { key: "status", label: "Status", render: pill },
          { key: "expires", label: "Expires", desktop: true, render: (d) => (d.expires_on ? formatDate(d.expires_on) : null) },
          { key: "ref", label: "Reference", desktop: true, render: (d) => d.number },
        ]}
      />
        }
        detail={
          shown && (
            <DocumentCard
              key={shown.row_key}
              d={shown}
              mayEdit={mayEdit}
              onView={files.view}
              onUpload={() => add(shown)}
              onSaved={() => {
                setPick(null);
                refresh();
              }}
            />
          )
        }
      />
      {files.viewer}
    </>
  );
}

/** One document: its facts, View File and Download, and Verify Document while it waits for a check. */
function DocumentCard({ d, mayEdit, onView, onUpload, onSaved }: { d: DocumentRow; mayEdit: boolean; onView: ReturnType<typeof useFileViewer>["view"]; onUpload: () => void; onSaved: () => void }) {
  const verify = useMutation("POST /api/v1/documents/:id/verify");
  const url = d.document_id ? `/api/v1/documents/${d.document_id}/content` : null;
  const mime = d.mime ?? "application/octet-stream";
  const check = async () => {
    if (!d.document_id) return;
    try {
      await verify.run({ params: { id: d.document_id }, body: {} });
      onSaved();
      toast(`${d.name} verified`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Not verified. Try again.");
    }
  };
  const download = () => (url ? saveFile(url, d.name) : undefined);
  return (
    <Card>
      <CardHeader record title={d.name} right={pill(d)} />
      <KeyValue
        items={[
          ["Uploaded", d.uploaded_at ? formatDate(d.uploaded_at) : "Not uploaded"],
          ["Status", pill(d)],
          ["Expires", d.expires_on ? formatDate(d.expires_on) : "None"],
          ...(d.number ? [["Reference", d.number] as [string, string]] : []),
        ]}
      />
      <FormFooter>
        {url && <Button icon="download" onClick={download}>Download</Button>}
        {url && viewableFile(mime) && (
          <Button icon="eye" onClick={() => onView(url, { name: d.name, mime, at: d.uploaded_at ? `Uploaded ${formatDate(d.uploaded_at)}` : null })}>
            View File
          </Button>
        )}
        {mayEdit && !d.document_id && (
          <Button variant="primary" icon="upload" onClick={onUpload}>
            Upload Document
          </Button>
        )}
        {mayEdit && d.status === "awaiting_verification" && (
          <Button variant="primary" onClick={check}>
            Verify Document
          </Button>
        )}
      </FormFooter>
    </Card>
  );
}

/** Upload Document: a file filed on the person's record, or the one a request asked for. */
function UploadForm({ id, row, close, onSaved }: { id: string; row: DocumentRow | null; close: () => void; onSaved: () => void }) {
  // The text beside the file is the upload's own contract (EmployeeDocumentUpload), checked as it is typed.
  const f = useContractForm({ title: row?.name ?? "" }, documentSchemas.EmployeeDocumentUpload);
  const title = f.values.title.trim();
  return (
    <>
      <Field label="What Is It" {...f.status("title")}>
        <TextField {...f.field("title")} placeholder="Valid ID" maxLength={200} />
      </Field>
      <UploadField
        purpose="document"
        endpoint={`/api/v1/employees/${id}/documents`}
        upload={upload}
        fields={{
          ...(title ? { title } : {}),
          ...(row?.document_request_id ? { document_request_id: row.document_request_id } : {}),
        }}
        // What the vault keeps for a document, and its limit (mime-policy.js, body-limits.js).
        accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.docx,.xlsx"
        maxBytes={15 * 1024 * 1024}
        multiple={false}
        kinds="PDF, Word, Excel or a photo"
        onUploaded={() => {
          close();
          onSaved();
          toast("Document filed");
        }}
      />
    </>
  );
}

/** Request Document: the person is asked for it, and it shows as Missing until it arrives. */
function RequestForm({ id, close, onSaved }: { id: string; close: () => void; onSaved: () => void }) {
  const f = useContractForm({ name: "", note: "" }, documentSchemas.DocumentRequestCreate);
  const run = useMutation("POST /api/v1/employees/:id/document-requests");
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      await run.run({ params: { id }, body: f.values });
      close();
      onSaved();
      toast(`${f.values.name} requested`);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      setProblem(e instanceof ApiError ? e.message : "Not sent. Try again.");
    }
  };
  return (
    <>
      <Field label="Document" {...f.status("name")}>
        <TextField {...f.field("name")} placeholder="Passport photograph" maxLength={120} />
      </Field>
      <Field label="Note" optional {...f.status("note")}>
        <TextAreaField {...f.field("note")} rows={3} />
      </Field>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={save}>Request Document</Button>
      </FormFooter>
    </>
  );
}
