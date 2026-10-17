import { useState } from "react";
import { invalidate, useApi, usePaged } from "@/api/hooks";
import { upload } from "@/api/upload";
import { saveFile, useFileUrl } from "@/api/download";
import type { DocumentRow } from "@mycity/contract/contract.gen.ts";
import {
  Button,
  Card,
  CardHeader,
  DataView,
  DesktopOnly,
  DocumentPreview,
  EmptyState,
  Field,
  formatDate,
  Grid,
  KeyValue,
  PageHeader,
  PhoneOnly,
  Pill,
  StatStrip,
  TapList,
  TextField,
  toast,
  UploadField,
  useModal,
} from "@mycity/ui";

/**
 * ESS · My Documents (#14, `my-documents`). The employee's own vault: what is
 * held, what is signed, what expires soon and what People have asked for and
 * has not been given yet (docs/guides/ess.md §10).
 */

const STATUS: Record<DocumentRow["status"], { tone: "ok" | "warn" | "err" | "neutral"; text: string }> = {
  signed: { tone: "ok", text: "Signed" },
  verified: { tone: "ok", text: "Verified" },
  expiring: { tone: "warn", text: "Expiring" },
  awaiting_verification: { tone: "warn", text: "Awaiting Check" },
  missing: { tone: "err", text: "Missing" },
};

const pill = (d: DocumentRow) => <Pill tone={STATUS[d.status].tone}>{STATUS[d.status].text}</Pill>;

export function MyDocumentsPage() {
  const list = usePaged("GET /api/v1/ess/documents");
  const summary = useApi("GET /api/v1/ess/documents/summary");
  const modal = useModal();
  const [chosen, setChosen] = useState<DocumentRow | null>(null);

  const add = (row?: DocumentRow) =>
    modal.open({
      title: "Upload Document",
      body: (close) => (
        <UploadForm
          row={row ?? null}
          close={() => {
            close();
            invalidate("/api/v1/ess/documents");
          }}
        />
      ),
    });

  const open = (d: DocumentRow) => {
    setChosen(d);
    modal.open({
      title: d.name,
      body: (
        <>
          <KeyValue
            items={[
              ["Uploaded", d.uploaded_at ? formatDate(d.uploaded_at) : "Not uploaded"],
              ["Status", pill(d)],
              ["Expires", d.expires_on ? formatDate(d.expires_on) : "None"],
              ...(d.number ? [["Reference", d.number] as [string, string]] : []),
            ]}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {d.document_id && (
              <Button
                icon="download"
                onClick={() => saveFile(`/api/v1/documents/${d.document_id}/content`, d.name)}
              >
                Download
              </Button>
            )}
            {!d.document_id && (
              <Button variant="primary" icon="plus" onClick={() => add(d)}>
                Upload Document
              </Button>
            )}
          </div>
        </>
      ),
    });
  };

  const s = summary.data;
  const columns = [
    { key: "name", label: "Document", sortable: true, render: (d: DocumentRow) => d.name },
    {
      key: "uploaded_at",
      label: "Uploaded",
      sortable: true,
      render: (d: DocumentRow) => (d.uploaded_at ? formatDate(d.uploaded_at) : null),
    },
    { key: "status", label: "Status", render: pill },
    {
      key: "expires",
      label: "Expires",
      desktop: true,
      render: (d: DocumentRow) => (d.expires_on ? formatDate(d.expires_on) : null),
    },
  ];

  return (
    <>
      <PageHeader
        title="My Documents"
        actions={
          <Button variant="primary" icon="plus" onClick={() => add()}>
            Upload Document
          </Button>
        }
      />
      <StatStrip
        items={[
          { label: "Documents", value: String(s?.documents ?? 0) },
          { label: "Signed", value: String(s?.signed ?? 0), tone: "ok" },
          { label: "Verified", value: String(s?.verified ?? 0), tone: "ok" },
          { label: "Expiring", value: String(s?.expiring ?? 0), tone: "warn" },
          { label: "Missing", value: String(s?.missing ?? 0), tone: "err" },
        ]}
      />
      <PhoneOnly>
        <TapList
          items={list.rows.map((d) => ({
            key: d.row_key,
            title: d.name,
            sub: d.uploaded_at ? `Uploaded ${formatDate(d.uploaded_at)}` : "Not uploaded",
            right: pill(d),
            onClick: () => open(d),
          }))}
        />
      </PhoneOnly>
      <DesktopOnly>
        <Grid cols="1/1.5">
          <DataView
            list={list}
            columns={columns}
            rowKey={(d) => d.row_key}
            caption="Vault"
            title="Vault"
            noun="document"
            onRowClick={open}
            selectedKey={chosen?.row_key ?? null}
            empty={{ title: "Nothing Here Yet", text: "Documents you upload appear here.", icon: "doc" }}
          />
          <Preview row={chosen} />
        </Grid>
      </DesktopOnly>
    </>
  );
}

/** The chosen document, as the browser draws it. */
function Preview({ row }: { row: DocumentRow | null }) {
  const href = useFileUrl(row?.document_id ? `/api/v1/documents/${row.document_id}/content` : null);
  if (!row || !row.document_id) {
    return (
      <Card>
        <CardHeader title="Preview" />
        <EmptyState bare title="Pick a Document" text="Its preview opens here." icon="doc" />
      </Card>
    );
  }
  if (!href) {
    return (
      <Card>
        <CardHeader title="Preview" />
        <EmptyState bare title="Opening" text="This takes a moment." icon="doc" />
      </Card>
    );
  }
  return (
    <DocumentPreview
      name={row.name}
      mime={row.mime ?? "application/octet-stream"}
      sizeBytes={row.bytes ?? undefined}
      href={href}
    />
  );
}

function UploadForm({ row, close }: { row: DocumentRow | null; close: () => void }) {
  const [title, setTitle] = useState(row?.name ?? "");
  return (
    <>
      <Field label="What Is It" state={title ? "good" : undefined}>
        <TextField value={title} onChange={setTitle} placeholder="NDPA certificate" />
      </Field>
      <UploadField
        purpose="document"
        endpoint="/api/v1/ess/documents"
        upload={upload}
        fields={{
          ...(title ? { title } : {}),
          ...(row?.document_request_id ? { document_request_id: row.document_request_id } : {}),
        }}
        accept=".pdf,image/*"
        multiple={false}
        kinds="PDF or a picture"
        onUploaded={() => {
          toast("Uploaded. People will check it");
          close();
        }}
      />
    </>
  );
}
