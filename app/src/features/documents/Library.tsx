/**
 * Document Centre · Library (#113, docs/guides/document-centre.md §2, §6, §10): every business
 * document the reader may already open from its own module, and the company's own papers, in one
 * list across the page. Four figures that set the list's filter, a search that reaches inside files
 * and filters the server answers, and a Download icon at each row's end. A pressed document opens as
 * a page of its own (`?id=`, Back to Library; F31 amended 17/11/2026): its preview, with its details
 * and View File, Download and Open Record beside it.
 * A company document is uploaded here (Upload Document), and its uploader or a keeper of the library
 * changes its details, replaces its file and archives it; another module's document is only read.
 * Download Letterhead gives the blank letterhead as PDF or Word.
 */
import { useState } from "react";
import type { LibraryDocument } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { saveFile, useFileBlob } from "@/api/download";
import { saveExport } from "@/api/exports";
import { invalidate, useApi, useInfinite, useMutation, usePaged } from "@/api/hooks";
import { useMe } from "@/auth/AuthProvider";
import { useFileViewer, viewableFile } from "@/features/shared/files";
import { useKept } from "@/features/shared/kept";
import { paging } from "@/features/shared/wire";
import { useRouter } from "@/lib/router";
import { useTrailTitle } from "@/lib/trail";
import { hasCapability } from "@/shell/access";
import { useScreenAction, useUrlAction } from "@/shell/screen-action";
import {
  ActionGroup,
  BackButton,
  Button,
  Card,
  CardHeader,
  DataView,
  DesktopOnly,
  Details,
  DocumentPreview,
  EmptyState,
  FilterSelect,
  formatDate,
  FormFooter,
  Grid,
  HelpTerm,
  IconButton,
  KeyValue,
  KpiCard,
  LoadingRows,
  Menu,
  PageHeader,
  PhoneOnly,
  Pill,
  toast,
  useConfirm,
  useIsPhone,
  useModal,
  type MenuItem,
  type StatusTone,
} from "@mycity/ui";
import { DetailsForm, UploadForm, VersionForm } from "./CompanyForms";

const HERE = "/documents?tab=library";
const EXPIRING_HELP = "Documents that end within 60 days, or have already ended.";
const SIGNED_HELP = "Signed, sent or filed. A signed document is never replaced.";

type Status = NonNullable<LibraryDocument["status"]>;
type Added = "this_month" | "last_90_days" | "this_year";

interface Filters {
  area: string;
  doc_type: string;
  /** Expiring or Signed; Archived (for those who keep the library) is the `archived` filter. */
  status: "" | "expiring" | "signed" | "archived";
  added: "" | Added;
  category_id: string;
  tag: string;
}
const NO_FILTERS: Filters = { area: "", doc_type: "", status: "", added: "", category_id: "", tag: "" };

const STATUS: Record<Status, [StatusTone, string]> = { expiring: ["warn", "Expiring"], signed: ["ok", "Signed"], archived: ["neutral", "Archived"] };
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
  ...(f.status && f.status !== "archived" && { status: f.status }),
  ...(f.status === "archived" && { archived: "true" as const }),
  ...(f.added && { added: f.added }),
  ...(f.category_id && { category_id: f.category_id }),
  ...(f.tag && { tag: f.tag }),
});

/** Every read of the library, refreshed after a change. */
const refresh = () => invalidate("/api/v1/library");

/** The vault's own file route, where `vault.canRead` decides once more. */
const fileUrl = (d: LibraryDocument) => `/api/v1/documents/${d.document_id}/content`;
const fileName = (d: LibraryDocument) => d.original_name ?? d.title;

export function Library({ id }: { id: string | null }) {
  return id ? <DocumentPage key={id} id={id} /> : <LibraryList />;
}

function LibraryList() {
  const { navigate } = useRouter();
  const me = useMe();
  const modal = useModal();
  // Kept while a document has its page, so Back to Library returns to the list as it was left.
  const [filters, setFilters] = useKept<Filters>("library.filters", NO_FILTERS);
  const summary = useApi("GET /api/v1/library/documents/summary");
  const options = useApi("GET /api/v1/library/filters");
  const list = usePaged("GET /api/v1/library/documents", { filters: queryOf(filters) });
  const mayUpload = Boolean(me.grants.documents?.includes("create"));
  const keeps = hasCapability(me, "documents.manage");
  const openOne = (documentId: string) => navigate(`${HERE}&id=${documentId}`);
  const s = summary.data;
  const filtered = Object.values(filters).filter(Boolean).length;
  const refine = () =>
    modal.open({
      title: "Filter Documents",
      body: (close) => <FilterSheet value={filters} options={options.data ?? null} keeps={keeps} onApply={setFilters} close={close} />,
    });
  const add = () =>
    modal.open({
      title: "Upload Document",
      body: (close) => (
        <UploadForm
          close={close}
          onSaved={(d) => {
            refresh();
            openOne(d.document_id);
          }}
        />
      ),
    });
  const letterhead = (format: "pdf" | "docx") => async () => {
    try {
      await saveExport(api.call("POST /api/v1/library/letterhead", { body: { format } }));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Letterhead not made. Try again.");
    }
  };
  const askLetterhead = () =>
    modal.open({
      title: "Download Letterhead",
      body: (close) => (
        <FormFooter>
          <Button icon="download" onClick={async () => (await letterhead("docx")(), close())}>
            Word File
          </Button>
          <Button variant="primary" icon="download" onClick={async () => (await letterhead("pdf")(), close())}>
            PDF File
          </Button>
        </FormFooter>
      ),
    });
  useScreenAction(mayUpload ? { label: "Upload Company Document", onSelect: add } : null);
  useUrlAction("new", mayUpload ? add : null);
  useUrlAction("letterhead", askLetterhead);
  return (
    <>
      <PageHeader
        title="Library"
        sub="Every document you may open"
        actions={
          <>
            <Menu
              trigger={(p) => (
                <Button {...p} icon="download">
                  Download Letterhead
                </Button>
              )}
              label="Download Letterhead"
              items={[
                { label: "PDF File", icon: "doc", onSelect: letterhead("pdf") },
                { label: "Word File", icon: "doc", onSelect: letterhead("docx") },
              ]}
            />
            {mayUpload && (
              <DesktopOnly>
                <Button variant="primary" icon="upload" onClick={add}>
                  Upload Document
                </Button>
              </DesktopOnly>
            )}
          </>
        }
      />
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
        <Grid cols={3} className="mt-3">
          <FilterFields value={filters} options={options.data ?? null} keeps={keeps} onChange={setFilters} />
        </Grid>
      </DesktopOnly>
      <PhoneOnly>
        <Button icon="filter" className="mt-3 w-full" onClick={refine}>
          {filtered ? `Filters (${filtered})` : "Filter Documents"}
        </Button>
      </PhoneOnly>
      <DataView<LibraryDocument>
        className="mt-3"
        title="Documents"
        list={list}
        search="Search documents"
        rowKey={(d) => d.document_id}
        noun="document"
        onRowClick={(d) => openOne(d.document_id)}
        empty={
          list.q || filtered
            ? { title: "No Documents Found", text: "Try another search or filter.", icon: "doc" }
            : { title: "No Documents Yet", icon: "doc" }
        }
        columns={[
          {
            key: "title",
            label: "Document",
            sortable: true,
            render: (d) => (
              <span className="grid gap-0.5" data-copy="content">
                <span className="font-medium">{d.title}</span>
                {d.matched_text && <span className="text-subtle-foreground line-clamp-2 text-sm">{d.matched_text}</span>}
              </span>
            ),
          },
          { key: "status", label: "Status", badge: true, render: pill },
          { key: "type", label: "Type", render: (d) => d.type_label },
          { key: "belongs", label: "Belongs To", render: (d) => <span data-copy="content">{belongsTo(d)}</span> },
          { key: "created_at", label: "Added", sortable: true, render: (d) => formatDate(d.created_at) },
          { key: "expires_on", label: "Expires", sortable: true, desktop: true, render: (d) => (d.expires_on ? formatDate(d.expires_on) : null) },
          {
            key: "download",
            label: "",
            desktop: true,
            className: "w-px text-right",
            render: (d) => (
              // The row opens the document's page; Download is its own press, so it stops here.
              <span className="flex justify-end" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                <IconButton icon="download" size="sm" label={`Download ${d.title}`} onClick={() => saveFile(fileUrl(d), fileName(d))} />
              </span>
            ),
          },
        ]}
      />
    </>
  );
}

type FilterOptions = { areas: Array<{ area: string; label: string }>; types: Array<{ doc_type: string; label: string; area: string }> };

/** The six filters. Type offers the picked area's types; changing the area clears a type outside it. */
function FilterFields({ value, options, keeps, onChange }: { value: Filters; options: FilterOptions | null; keeps: boolean; onChange: (next: Filters) => void }) {
  const categories = useInfinite("GET /api/v1/library/categories", { filters: {} });
  const tags = useInfinite("GET /api/v1/library/tags", { filters: {} });
  const areas = options?.areas ?? [];
  const types = (options?.types ?? []).filter((t) => !value.area || t.area === value.area);
  const setArea = (area: string) => {
    const kept = !area || (options?.types ?? []).some((t) => t.doc_type === value.doc_type && t.area === area);
    onChange({ ...value, area, doc_type: kept ? value.doc_type : "" });
  };
  const statuses: Array<[string, string]> = keeps ? [...STATUSES, ["archived", "Archived"]] : STATUSES;
  return (
    <>
      <FilterSelect label="Area" value={value.area} onChange={setArea} options={[["", "Every Area"], ...areas.map((a) => [a.area, a.label] as [string, string])]} />
      <FilterSelect
        label="Type"
        value={value.doc_type}
        onChange={(doc_type) => onChange({ ...value, doc_type })}
        options={[["", "Every Type"], ...types.map((t) => [t.doc_type, t.label] as [string, string])]}
      />
      <FilterSelect label="Status" value={value.status} onChange={(status) => onChange({ ...value, status: status as Filters["status"] })} options={statuses} />
      <FilterSelect label="Added" value={value.added} onChange={(added) => onChange({ ...value, added: added as Filters["added"] })} options={ADDED} />
      <FilterSelect
        label="Category"
        value={value.category_id}
        onChange={(category_id) => onChange({ ...value, category_id })}
        options={[["", "Every Category"], ...categories.rows.map((c) => [c.document_category_id, c.name] as [string, string])]}
        {...paging(categories)}
      />
      <FilterSelect
        label="Tag"
        value={value.tag}
        onChange={(tag) => onChange({ ...value, tag })}
        options={[["", "Every Tag"], ...tags.rows.map((t) => [t.tag, t.tag] as [string, string])]}
        {...paging(tags)}
      />
    </>
  );
}

/** A phone's filters, in a sheet: picked there, applied by Show Documents. */
function FilterSheet({ value, options, keeps, onApply, close }: { value: Filters; options: FilterOptions | null; keeps: boolean; onApply: (next: Filters) => void; close: () => void }) {
  const [draft, setDraft] = useState<Filters>(value);
  const apply = (next: Filters) => {
    onApply(next);
    close();
  };
  return (
    <>
      <div className="grid gap-3">
        <FilterFields value={draft} options={options} keeps={keeps} onChange={setDraft} />
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

/** A document's own page: Back to Library, its name, then the file beside its details. */
function DocumentPage({ id }: { id: string }) {
  const { navigate } = useRouter();
  const files = useFileViewer();
  return (
    <>
      <BackButton label="Back to Library" onBack={() => navigate(HERE)} />
      <DocumentRecord id={id} onView={files.view} />
      {files.viewer}
    </>
  );
}

/**
 * One document: the file on the wider side, and its details with Download, View File and Open Record
 * on the narrower, a company document's own actions in its menu. On a phone the details come first,
 * Download full width at their foot.
 */
function DocumentRecord({ id, onView }: { id: string; onView: ReturnType<typeof useFileViewer>["view"] }) {
  const { navigate } = useRouter();
  const phone = useIsPhone();
  const modal = useModal();
  const confirm = useConfirm();
  const read = useApi("GET /api/v1/library/documents/:id", { params: { id } });
  const archive = useMutation("POST /api/v1/library/documents/:id/archive");
  const restore = useMutation("POST /api/v1/library/documents/:id/restore");
  const d = read.data;
  useTrailTitle(d?.title);
  if (read.error) {
    const gone = read.error instanceof ApiError && read.error.status === 404;
    return (
      <Card>
        <EmptyState bare level={2} title={gone ? "Document Not Found" : "Could Not Open"} text={gone ? "It was removed, or is not yours to open." : "Try again in a moment."} icon="doc" />
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
  const url = fileUrl(d);
  const name = fileName(d);
  const link = d.record?.link ?? null;
  const company = d.company;
  const saved = (next: LibraryDocument) => {
    refresh();
    if (next.document_id !== d.document_id) navigate(`${HERE}&id=${next.document_id}`);
  };
  const edit = () => modal.open({ title: "Edit Details", body: (close) => <DetailsForm doc={d} close={close} onSaved={saved} /> });
  const replace = () => modal.open({ title: "Upload New Version", body: (close) => <VersionForm doc={d} close={close} onSaved={saved} /> });
  const putAway = async () => {
    if (!(await confirm({ title: "Archive Document", body: `${d.title} leaves the library. Restore it at any time.`, confirmLabel: "Archive Document", destructive: true }))) return;
    await archive.run({ params: { id: d.document_id }, body: {} });
    refresh();
    toast("Document archived");
  };
  const bringBack = async () => {
    await restore.run({ params: { id: d.document_id }, body: {} });
    refresh();
    toast("Document restored");
  };
  const actions: MenuItem[] = company
    ? [
        ...(company.may_edit && !company.archived_at
          ? [
              { label: "Edit Details", icon: "edit" as const, onSelect: edit },
              { label: "Upload New Version", icon: "upload" as const, onSelect: replace },
            ]
          : []),
        ...(company.may_archive ? [company.archived_at ? { label: "Restore Document", icon: "undo" as const, onSelect: bringBack } : { label: "Archive Document", icon: "book" as const, danger: true, onSelect: putAway }] : []),
      ]
    : [];
  const viewable = viewableFile(d.mime);
  const video = d.mime.startsWith("video/");
  const buttons = (
    <ActionGroup>
      <div className="grid gap-2">
        <Button variant="primary" block icon="download" onClick={() => saveFile(url, name)}>
          Download
        </Button>
        {viewable && (
          <Button block icon="eye" onClick={() => onView(url, { name, mime: d.mime, at: `Added ${formatDate(d.created_at)}` })}>
            View File
          </Button>
        )}
        {link && (
          <Button block icon="external" onClick={() => navigate(link)}>
            Open Record
          </Button>
        )}
      </div>
    </ActionGroup>
  );
  const details = (
    <>
      <KeyValue
        items={[
          ["Type", d.type_label],
          [company ? "Category" : "Belongs To", <span key="b" data-copy="content">{belongsTo(d) ?? "–"}</span>],
          ...(d.number ? [["Number", d.number] as [string, string]] : []),
          ["Added", `${formatDate(d.created_at)}${d.added_by_name ? `, ${d.added_by_name}` : ""}`],
          [<HelpTerm key="e" help={EXPIRING_HELP}>Expires</HelpTerm>, d.expires_on ? formatDate(d.expires_on) : "None"],
          ["Size", `${sizeOf(d.bytes)}${d.page_count ? `, ${d.page_count} ${d.page_count === 1 ? "page" : "pages"}` : ""}`],
          ...(d.version > 1 ? [["Version", String(d.version)] as [string, string]] : []),
          ...(company && company.tags.length ? [["Tags", <span key="t" data-copy="content">{company.tags.join(", ")}</span>] as [string, JSX.Element]] : []),
          ...(company?.description ? [["Description", <span key="n" data-copy="content">{company.description}</span>] as [string, JSX.Element]] : []),
        ]}
      />
      <Details items={[["File Name", <span key="f" data-copy="content">{name}</span>]]} />
    </>
  );
  const facts = (
    <Card>
      <CardHeader
        title="Details"
        right={
          <>
            {pill(d)}
            {actions.length > 0 && <Menu trigger={(p) => <IconButton {...p} icon="dots" label="Document Actions" />} label="Document Actions" items={actions} />}
          </>
        }
      />
      {phone ? (
        <>
          {details}
          <div className="mt-4">{buttons}</div>
        </>
      ) : (
        <>
          {buttons}
          <div className="mt-4">{details}</div>
        </>
      )}
    </Card>
  );
  const file =
    viewable && !video ? (
      <Preview url={url} name={name} mime={d.mime} bytes={d.bytes} height={phone ? "md" : "lg"} />
    ) : (
      <Card>
        <EmptyState bare level={2} title="No Preview" text={video ? "Press View File to watch it." : "Download the file to read it."} icon="doc" />
      </Card>
    );
  return (
    <>
      <PageHeader title={<span data-copy="content">{d.title}</span>} />
      {phone ? (
        <div className="grid gap-3">
          {facts}
          {file}
        </div>
      ) : (
        <Grid cols="2/1">
          {file}
          {facts}
        </Grid>
      )}
    </>
  );
}

/** The file itself: a PDF's pages drawn in the app, a picture as it is. */
function Preview({ url, name, mime, bytes, height }: { url: string; name: string; mime: string; bytes: number; height: "md" | "lg" }) {
  const { blob, href, failed } = useFileBlob(url);
  if (failed) {
    return (
      <Card>
        <EmptyState bare level={2} title="Preview Unavailable" text="Download the file to read it." icon="doc" />
      </Card>
    );
  }
  if (!href) {
    return (
      <Card>
        <EmptyState bare level={2} title="Opening" text="This takes a moment." icon="doc" />
      </Card>
    );
  }
  return <DocumentPreview name={name} mime={mime} sizeBytes={bytes} href={href} file={blob} height={height} />;
}
