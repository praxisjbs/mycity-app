/**
 * Document Centre · Library (#113, docs/guides/document-centre.md §2, §6, §10): every business
 * document the reader may already open from its own module, in one list. Four figures that set the
 * list's filter, a search and filters the server answers, and a document beside the list on a wide
 * desktop and in a full sheet on a phone (ListDetail, F31) with its preview, View File, Download and
 * the way to the record it belongs to. It only reads: a document's own module stays its owner.
 */
import { useState } from "react";
import type { LibraryDocument } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { saveFile, useFileBlob } from "@/api/download";
import { useApi, usePaged } from "@/api/hooks";
import { useFileViewer, viewableFile } from "@/features/shared/files";
import { useRouter } from "@/lib/router";
import { useTrailTitle } from "@/lib/trail";
import {
  Button,
  Card,
  CardHeader,
  DataView,
  DesktopOnly,
  DocumentPreview,
  EmptyState,
  FilterSelect,
  formatDate,
  FormFooter,
  Grid,
  HelpTerm,
  KeyValue,
  KpiCard,
  ListDetail,
  LoadingRows,
  PageHeader,
  PhoneOnly,
  Pill,
  useModal,
  useSideBySide,
  type StatusTone,
} from "@mycity/ui";

const HERE = "/documents?tab=library";
const EXPIRING_HELP = "Documents that end within 60 days, or have already ended.";
const SIGNED_HELP = "Signed, sent or filed. A signed document is never replaced.";

type Status = NonNullable<LibraryDocument["status"]>;
type Added = "this_month" | "last_90_days" | "this_year";

interface Filters {
  area: string;
  doc_type: string;
  status: "" | Status;
  added: "" | Added;
}
const NO_FILTERS: Filters = { area: "", doc_type: "", status: "", added: "" };

const STATUS: Record<Status, [StatusTone, string]> = { expiring: ["warn", "Expiring"], signed: ["ok", "Signed"] };
const STATUSES: Array<[string, string]> = [["", "Any Status"], ["expiring", "Expiring Soon"], ["signed", "Signed"]];
const ADDED: Array<[string, string]> = [["", "Any Time"], ["this_month", "This Month"], ["last_90_days", "Last 90 Days"], ["this_year", "This Year"]];

const pill = (d: LibraryDocument) => (d.status ? <Pill tone={STATUS[d.status][0]}>{STATUS[d.status][1]}</Pill> : null);
/** Whom or what a document belongs to: the record's name, then its number. */
const belongsTo = (d: LibraryDocument) => (d.record ? [d.record.label, d.record.ref].filter(Boolean).join(", ") || null : null);
const sizeOf = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const counted = (n: number | undefined) => (n === undefined ? "–" : String(n));

/** The filters as the list's query carries them: empty ones left out. */
const queryOf = (f: Filters) => ({
  ...(f.area && { area: f.area }),
  ...(f.doc_type && { doc_type: f.doc_type }),
  ...(f.status && { status: f.status }),
  ...(f.added && { added: f.added }),
});

export function Library({ id }: { id: string | null }) {
  const { navigate } = useRouter();
  const modal = useModal();
  const files = useFileViewer();
  const beside = useSideBySide();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const summary = useApi("GET /api/v1/library/documents/summary");
  const options = useApi("GET /api/v1/library/filters");
  const list = usePaged("GET /api/v1/library/documents", { filters: queryOf(filters) });
  const openOne = (documentId: string) => navigate(`${HERE}&id=${documentId}`);
  // Beside the list the first document shows unasked; on a phone nothing opens until a row is tapped (F31).
  const shown = id ?? (beside ? (list.rows[0]?.document_id ?? null) : null);
  const s = summary.data;
  const filtered = Object.values(filters).filter(Boolean).length;
  const refine = () =>
    modal.open({
      title: "Filter Documents",
      body: (close) => <FilterSheet value={filters} options={options.data ?? null} onApply={setFilters} close={close} />,
    });
  return (
    <>
      <PageHeader title="Library" sub="Every document you may open" />
      <Grid cols="4m2">
        <KpiCard title="All Documents" value={counted(s?.documents)} onOpen={() => setFilters(NO_FILTERS)} />
        <KpiCard title="Added This Month" value={counted(s?.added_this_month)} onOpen={() => setFilters({ ...NO_FILTERS, added: "this_month" })} />
        <KpiCard
          title="Expiring Soon"
          value={counted(s?.expiring)}
          tone={s?.expiring ? "warn" : undefined}
          help={EXPIRING_HELP}
          onOpen={() => setFilters({ ...NO_FILTERS, status: "expiring" })}
        />
        <KpiCard title="Signed" value={counted(s?.signed)} help={SIGNED_HELP} onOpen={() => setFilters({ ...NO_FILTERS, status: "signed" })} />
      </Grid>
      <DesktopOnly>
        <Grid cols={4} className="mt-3">
          <FilterFields value={filters} options={options.data ?? null} onChange={setFilters} />
        </Grid>
      </DesktopOnly>
      <PhoneOnly>
        <Button icon="filter" className="mt-3 w-full" onClick={refine}>
          {filtered ? `Filters (${filtered})` : "Filter Documents"}
        </Button>
      </PhoneOnly>
      <ListDetail
        className="mt-3"
        open={Boolean(id)}
        onClose={() => navigate(HERE)}
        title="Document"
        full
        list={
          <DataView<LibraryDocument>
            title="Documents"
            list={list}
            search="Search documents"
            rowKey={(d) => d.document_id}
            noun="document"
            onRowClick={(d) => openOne(d.document_id)}
            selectedKey={beside ? shown : null}
            empty={
              list.q || filtered
                ? { title: "No Documents Found", text: "Try another search or filter.", icon: "doc" }
                : { title: "No Documents Yet", icon: "doc" }
            }
            columns={[
              { key: "title", label: "Document", sortable: true, render: (d) => <span className="font-medium" data-copy="content">{d.title}</span> },
              { key: "status", label: "Status", badge: true, render: pill },
              { key: "type", label: "Type", render: (d) => d.type_label },
              { key: "belongs", label: "Belongs To", render: (d) => <span data-copy="content">{belongsTo(d)}</span> },
              { key: "created_at", label: "Added", sortable: true, render: (d) => formatDate(d.created_at) },
              { key: "expires_on", label: "Expires", sortable: true, desktop: true, render: (d) => (d.expires_on ? formatDate(d.expires_on) : null) },
            ]}
          />
        }
        detail={shown && <DocumentPanel key={shown} id={shown} onView={files.view} onGone={() => navigate(HERE)} />}
      />
      {files.viewer}
    </>
  );
}

type FilterOptions = { areas: Array<{ area: string; label: string }>; types: Array<{ doc_type: string; label: string; area: string }> };

/** The four filters. Type offers the picked area's types; changing the area clears a type outside it. */
function FilterFields({ value, options, onChange }: { value: Filters; options: FilterOptions | null; onChange: (next: Filters) => void }) {
  const areas = options?.areas ?? [];
  const types = (options?.types ?? []).filter((t) => !value.area || t.area === value.area);
  const setArea = (area: string) => {
    const kept = !area || (options?.types ?? []).some((t) => t.doc_type === value.doc_type && t.area === area);
    onChange({ ...value, area, doc_type: kept ? value.doc_type : "" });
  };
  return (
    <>
      <FilterSelect label="Area" value={value.area} onChange={setArea} options={[["", "Every Area"], ...areas.map((a) => [a.area, a.label] as [string, string])]} />
      <FilterSelect
        label="Type"
        value={value.doc_type}
        onChange={(doc_type) => onChange({ ...value, doc_type })}
        options={[["", "Every Type"], ...types.map((t) => [t.doc_type, t.label] as [string, string])]}
      />
      <FilterSelect label="Status" value={value.status} onChange={(status) => onChange({ ...value, status: status as Filters["status"] })} options={STATUSES} />
      <FilterSelect label="Added" value={value.added} onChange={(added) => onChange({ ...value, added: added as Filters["added"] })} options={ADDED} />
    </>
  );
}

/** A phone's filters, in a sheet: picked there, applied by Show Documents. */
function FilterSheet({ value, options, onApply, close }: { value: Filters; options: FilterOptions | null; onApply: (next: Filters) => void; close: () => void }) {
  const [draft, setDraft] = useState<Filters>(value);
  const apply = (next: Filters) => {
    onApply(next);
    close();
  };
  return (
    <>
      <div className="grid gap-3">
        <FilterFields value={draft} options={options} onChange={setDraft} />
      </div>
      <FormFooter>
        <Button onClick={() => apply(NO_FILTERS)}>Clear Filters</Button>
        <Button variant="primary" onClick={() => apply(draft)}>
          Show Documents
        </Button>
      </FormFooter>
    </>
  );
}

/** One document: its preview, its facts, and View File, Download and Open Record. */
function DocumentPanel({ id, onView, onGone }: { id: string; onView: ReturnType<typeof useFileViewer>["view"]; onGone: () => void }) {
  const { navigate } = useRouter();
  const read = useApi("GET /api/v1/library/documents/:id", { params: { id } });
  const d = read.data;
  useTrailTitle(d?.title);
  if (read.error) {
    const gone = read.error instanceof ApiError && read.error.status === 404;
    return (
      <Card>
        <EmptyState bare title={gone ? "Document Not Found" : "Could Not Open"} text={gone ? "It was removed, or is not yours to open." : "Try again in a moment."} icon="doc" action={<Button onClick={onGone}>Back to Library</Button>} />
      </Card>
    );
  }
  if (!d) {
    return (
      <Card>
        <LoadingRows />
      </Card>
    );
  }
  const url = `/api/v1/documents/${d.document_id}/content`;
  const name = d.original_name ?? d.title;
  const link = d.record?.link ?? null;
  return (
    <div className="grid gap-3">
      <Card>
        <CardHeader record title={d.title} right={pill(d)} />
        <KeyValue
          items={[
            ["Type", d.type_label],
            ["Belongs To", <span key="b" data-copy="content">{belongsTo(d) ?? "–"}</span>],
            ...(d.number ? [["Number", d.number] as [string, string]] : []),
            ["Added", `${formatDate(d.created_at)}${d.added_by_name ? `, ${d.added_by_name}` : ""}`],
            [<HelpTerm key="e" help={EXPIRING_HELP}>Expires</HelpTerm>, d.expires_on ? formatDate(d.expires_on) : "None"],
            ["Size", `${sizeOf(d.bytes)}${d.page_count ? `, ${d.page_count} ${d.page_count === 1 ? "page" : "pages"}` : ""}`],
            ...(d.version > 1 ? [["Version", String(d.version)] as [string, string]] : []),
          ]}
        />
        <FormFooter>
          {link && (
            <Button icon="external" onClick={() => navigate(link)}>
              Open Record
            </Button>
          )}
          {viewableFile(d.mime) && (
            <Button icon="eye" onClick={() => onView(url, { name, mime: d.mime, at: `Added ${formatDate(d.created_at)}` })}>
              View File
            </Button>
          )}
          <Button variant="primary" icon="download" onClick={() => saveFile(url, name)}>
            Download
          </Button>
        </FormFooter>
      </Card>
      {viewableFile(d.mime) && !d.mime.startsWith("video/") && <Preview url={url} name={name} mime={d.mime} bytes={d.bytes} />}
    </div>
  );
}

/** The file itself: a PDF's pages drawn in the app, a picture as it is. */
function Preview({ url, name, mime, bytes }: { url: string; name: string; mime: string; bytes: number }) {
  const { blob, href, failed } = useFileBlob(url);
  if (failed) {
    return (
      <Card>
        <EmptyState bare title="Preview Unavailable" text="Download the file to read it." icon="doc" />
      </Card>
    );
  }
  if (!href) {
    return (
      <Card>
        <EmptyState bare title="Opening" text="This takes a moment." icon="doc" />
      </Card>
    );
  }
  return <DocumentPreview name={name} mime={mime} sizeBytes={bytes} href={href} file={blob} />;
}
