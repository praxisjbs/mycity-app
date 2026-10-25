import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { upload } from "@/api/upload";
import { saveFile } from "@/api/download";
import { useSearchParams } from "@/lib/router";
import { useScreenAction } from "@/shell/screen-action";
import type { ImportBatch, Importer, ImportRowRecord } from "@mycity/contract/contract.gen.ts";
import {
  Button,
  Card,
  CardHeader,
  DataView,
  DesktopOnly,
  EmptyState,
  Field,
  FilterSelect,
  formatDateTime,
  KeyValue,
  KpiGrid,
  PageHeader,
  PhoneOnly,
  Pill,
  SelectField,
  Switch,
  Tick,
  toast,
  UploadField,
  useConfirm,
  useModal,
  Wizard,
} from "@mycity/ui";

/**
 * Settings · Imports (`imports`, M0). The wizard for any importer a module
 * registers, opened with `?importer=<key>` from the screen that owns the
 * records, and the history of every batch with its counts, its error file and
 * Revert (docs/guides/foundation.md §5, §10).
 *
 * The screen knows nothing about what is being imported: the columns, the
 * choices and the rules all come from `GET /imports/importers`.
 */

const STATUS: Record<string, { tone: "ok" | "warn" | "err" | "neutral" | "info"; text: string }> = {
  uploaded: { tone: "info", text: "Uploaded" },
  mapped: { tone: "info", text: "Mapped" },
  previewed: { tone: "warn", text: "Previewed" },
  committed: { tone: "ok", text: "Committed" },
  reverted: { tone: "neutral", text: "Reverted" },
  failed: { tone: "err", text: "Failed" },
};

const ROW_STATUS: Record<string, { tone: "ok" | "warn" | "err" | "neutral"; text: string }> = {
  ok: { tone: "ok", text: "Ready" },
  warning: { tone: "warn", text: "Saved With Note" },
  error: { tone: "err", text: "Not Imported" },
  duplicate: { tone: "err", text: "Duplicate" },
  unchanged: { tone: "neutral", text: "Unchanged" },
  skipped: { tone: "neutral", text: "Skipped" },
};

/** The rows the Preview step lists: the ones to look at, or the ones that change a record. */
type RowView = "problem" | "change";
const ROW_VIEWS: Array<[RowView, string]> = [
  ["problem", "Problems"],
  ["change", "Changes"],
];

/** The rows of the sheet the header may be on: the first 20, as the engine looks. */
const HEADER_ROWS: Array<[string, string]> = Array.from({ length: 20 }, (_, i) => [String(i), `Row ${i + 1}`]);

const count = (n: number | undefined) => String(n ?? 0);

/** The rows a person should look at: errors and duplicates block, warnings save with something missing. */
const problemsOf = (stats: ImportBatch["stats"]) =>
  Number(stats.error ?? 0) + Number(stats.duplicate ?? 0) + Number(stats.warning ?? 0);

export function Imports() {
  const [params, setParams] = useSearchParams();
  const modal = useModal();
  const confirm = useConfirm();
  const list = usePaged("GET /api/v1/imports");
  const importers = useApi("GET /api/v1/imports/importers");
  const asked = params.get("importer");

  const start = useMemo(
    () => (key?: string) =>
      modal.open({
        title: "Import Records",
        full: true,
        wide: true,
        body: (close) => (
          <ImportWizard
            importers={importers.data?.importers ?? []}
            preferred={key ?? null}
            close={() => {
              close();
              setParams({ importer: null });
              invalidate("/api/v1/imports");
            }}
          />
        ),
        onClose: () => setParams({ importer: null }),
      }),
    [modal, importers.data, setParams],
  );

  useScreenAction({ label: "Start Import", onSelect: () => start() });

  // People · Employees opens this screen with ?importer=employees.
  useEffect(() => {
    if (asked && importers.data) start(asked);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opening once per asked importer
  }, [asked, importers.data]);

  const openBatch = (b: ImportBatch) =>
    modal.open({
      title: b.number,
      body: <BatchDetail batch={b} confirm={confirm} />,
    });

  const columns = [
    { key: "number", label: "Reference", render: (b: ImportBatch) => b.number },
    { key: "importer", label: "Import", render: (b: ImportBatch) => b.importer_label },
    { key: "file", label: "File", desktop: true, render: (b: ImportBatch) => b.file_name },
    { key: "who", label: "Who", desktop: true, render: (b: ImportBatch) => b.created_by_name },
    {
      key: "created_at",
      label: "When",
      sortable: true,
      render: (b: ImportBatch) => formatDateTime(b.created_at),
    },
    { key: "created", label: "Created", align: "n" as const, render: (b: ImportBatch) => count(b.stats.create) },
    { key: "updated", label: "Updated", align: "n" as const, desktop: true, render: (b: ImportBatch) => count(b.stats.update) },
    { key: "problems", label: "Problems", align: "n" as const, desktop: true, render: (b: ImportBatch) => String(problemsOf(b.stats)) },
    {
      key: "status",
      label: "Status",
      render: (b: ImportBatch) => <Pill tone={STATUS[b.status]?.tone ?? "neutral"}>{STATUS[b.status]?.text ?? b.status}</Pill>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Imports"
        actions={
          <Button variant="primary" icon="plus" onClick={() => start()}>
            Start Import
          </Button>
        }
      />
      <DataView
        list={list}
        columns={columns}
        rowKey={(b) => b.import_batch_id}
        caption="Imports"
        title="History"
        search="Find Import"
        noun="import"
        onRowClick={openBatch}
        empty={{ title: "No Imports Yet", text: "A sheet you import appears here.", icon: "doc" }}
      />
    </>
  );
}

/* ───────────── one batch ───────────── */

function BatchDetail({ batch, confirm }: { batch: ImportBatch; confirm: ReturnType<typeof useConfirm> }) {
  const revert = useMutation("POST /api/v1/imports/:id/revert");
  const [done, setDone] = useState(batch.status === "reverted");
  return (
    <>
      <KeyValue
        items={[
          ["Import", batch.importer_label],
          ["File", batch.file_name],
          ["Uploaded By", batch.created_by_name ?? ""],
          ["When", formatDateTime(batch.created_at)],
          ["Status", <Pill tone={STATUS[batch.status]?.tone ?? "neutral"}>{STATUS[batch.status]?.text ?? batch.status}</Pill>],
        ]}
      />
      <Counts stats={batch.stats} className="mt-3" />
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          icon="download"
          onClick={() => saveFile(`/api/v1/imports/${batch.import_batch_id}/report`, `${batch.number}.xlsx`)}
        >
          Download Errors
        </Button>
        {batch.status === "committed" && !done && (
          <Button
            variant="danger"
            icon="undo"
            busy={revert.pending}
            onClick={async () => {
              if (!(await confirm({ title: "Revert Import", body: "Records it created are archived and records it changed go back.", destructive: true }))) return;
              try {
                const out = await revert.run({ params: { id: batch.import_batch_id } });
                setDone(true);
                invalidate("/api/v1/imports");
                toast(`${out.archived} archived, ${out.restored} put back`);
              } catch (e) {
                // Refused whole when a record changed since or is in use: the reason names the rows.
                toast(e instanceof Error ? e.message : "Not reverted. Try again.");
              }
            }}
          >
            Revert
          </Button>
        )}
      </div>
    </>
  );
}

function Counts({ stats, className }: { stats: ImportBatch["stats"]; className?: string }) {
  const blocking = Number(stats.error ?? 0) + Number(stats.duplicate ?? 0);
  const problems = problemsOf(stats);
  return (
    <KpiGrid
      className={className}
      cols={4}
      items={[
        { key: "rows", title: "Rows", value: count(stats.rows) },
        { key: "create", title: "To Create", value: count(stats.create), tone: "ok" },
        { key: "update", title: "To Update", value: count(stats.update), tone: "info" },
        {
          key: "unchanged",
          title: "Unchanged",
          value: count(stats.unchanged),
          help: "A row already in the system with nothing different in it. Importing it again changes nothing.",
        },
        { key: "problems", title: "Problems", value: String(problems), tone: blocking > 0 ? "err" : problems > 0 ? "warn" : undefined },
      ]}
    />
  );
}

/* ───────────── the wizard ───────────── */

function ImportWizard({ importers, preferred, close }: { importers: Importer[]; preferred: string | null; close: () => void }) {
  const [key, setKey] = useState(preferred ?? importers[0]?.key ?? "");
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [fields, setFields] = useState<Record<string, string | null>>({});
  const [validOnly, setValidOnly] = useState(false);
  const [ticked, setTicked] = useState<Record<string, string[]>>({});
  const [view, setView] = useState<RowView>("problem");
  const setMapping = useMutation("PUT /api/v1/imports/:id/mapping");
  const preview = useMutation("POST /api/v1/imports/:id/preview");
  const commit = useMutation("POST /api/v1/imports/:id/commit");
  const importer = importers.find((i) => i.key === key) ?? null;

  const rows = usePaged("GET /api/v1/imports/:id/rows", {
    params: { id: batch?.import_batch_id ?? "" },
    filters: { status: view },
    enabled: Boolean(batch) && batch?.status === "previewed",
  });
  const labelOf = (key: string) => importer?.fields.find((f) => f.key === key)?.label ?? key;

  /* The row of column names was not found: the person says which row it is, and the columns
     of that row are matched afresh for them to confirm. */
  const pickHeader = async (row: string) => {
    if (!batch) return;
    try {
      const next = await setMapping.run({ params: { id: batch.import_batch_id }, body: { header_row: Number(row) } });
      setBatch(next);
      setFields(Object.fromEntries(next.mapping.columns.map((c) => [String(c.index), c.field])));
    } catch (e) {
      toast(e instanceof Error ? e.message : "That row did not work");
    }
  };

  const options = useMemo(
    () => [["", "Leave Out"] as [string, string], ...(importer?.fields ?? []).map((f) => [f.key, f.label] as [string, string])],
    [importer],
  );

  if (importers.length === 0) {
    return <EmptyState title="Nothing To Import" text="You have no imports to run." icon="doc" />;
  }

  const steps = [
    {
      title: "Upload",
      body: (
        <>
          <Field label="What To Import">
            <SelectField value={key} onChange={setKey} options={importers.map((i) => [i.key, i.label] as [string, string])} />
          </Field>
          {importer && (
            <Button
              icon="download"
              className="mb-3"
              onClick={() => saveFile(`/api/v1/imports/importers/${importer.key}/template`, `${importer.key}-template.xlsx`)}
            >
              Blank Sheet
            </Button>
          )}
          <UploadField
            purpose="import_sheet"
            endpoint="/api/v1/imports"
            upload={upload}
            fields={{ importer_key: key }}
            accept=".xlsx,.csv"
            multiple={false}
            kinds="Excel or CSV"
            onUploaded={([answer]) => {
              // The route answers with the batch it started, which carries the
              // source file's document id, so the upload engine resolves on it.
              const next = answer as unknown as ImportBatch;
              if (!next?.mapping) {
                toast("Importing works once the API is connected");
                return;
              }
              setBatch(next);
              setFields(Object.fromEntries(next.mapping.columns.map((c) => [String(c.index), c.field])));
            }}
          />
          {batch && <p className="mt-3 text-sm text-subtle-foreground">{batch.file_name}</p>}
        </>
      ),
      check: () => Boolean(batch),
    },
    {
      title: "Map",
      body: (
        <div className="grid gap-2">
          <Field label="Column Names Row" help="The row of the sheet that holds the column names.">
            <SelectField
              value={batch?.header_row === null || batch?.header_row === undefined ? "" : String(batch.header_row)}
              onChange={(v) => pickHeader(v)}
              options={HEADER_ROWS}
              placeholder="Choose Row"
            />
          </Field>
          {(batch?.mapping.columns ?? []).map((c) => (
            <Field key={c.index} label={c.header || `Column ${c.index + 1}`}>
              <SelectField
                value={fields[String(c.index)] ?? ""}
                onChange={(v) => setFields((f) => ({ ...f, [String(c.index)]: v || null }))}
                options={options}
              />
            </Field>
          ))}
        </div>
      ),
      check: async () => {
        if (!batch) return false;
        try {
          const mapped = await setMapping.run({ params: { id: batch.import_batch_id }, body: { fields } });
          const out = await preview.run({ params: { id: batch.import_batch_id }, body: {} });
          setBatch({ ...mapped, ...out.batch, stats: out.stats });
          return true;
        } catch (e) {
          toast(e instanceof Error ? e.message : "That mapping did not work");
          return false;
        }
      },
    },
    {
      title: "Preview",
      body: batch && (
        <>
          <Counts stats={batch.stats} />
          <DesktopOnly>
            <DataView
              bare
              className="mt-3"
              rows={rows.rows}
              page={rows.page}
              onPage={rows.setPage}
              loading={rows.loading}
              rowKey={(r: ImportRowRecord) => r.import_row_id}
              caption={view === "change" ? "Rows that change a record" : "Rows with problems"}
              noun="row"
              actions={<FilterSelect label="Show" value={view} onChange={(v) => setView(v as RowView)} options={ROW_VIEWS} />}
              columns={[
                { key: "n", label: "Row", align: "n" as const, render: (r: ImportRowRecord) => String(r.row_number) },
                {
                  key: "s",
                  label: "Status",
                  render: (r: ImportRowRecord) => (
                    <Pill tone={ROW_STATUS[r.status]?.tone ?? "neutral"}>{ROW_STATUS[r.status]?.text ?? r.status}</Pill>
                  ),
                },
                {
                  key: "c",
                  label: "Changes",
                  render: (r: ImportRowRecord) => Object.keys(r.diff ?? {}).map(labelOf).join(", "),
                },
                { key: "p", label: "Problem", render: (r: ImportRowRecord) => r.problems.map((p) => p.message).join("; ") },
              ]}
              empty={
                view === "change"
                  ? { title: "Nothing Changes", text: "No record already here is changed by this sheet.", icon: "check" }
                  : { title: "Every Row Is Fine", text: "Nothing needs fixing before you commit.", icon: "check" }
              }
            />
          </DesktopOnly>
          <PhoneOnly>
            <Button
              className="mt-3"
              icon="download"
              onClick={() => saveFile(`/api/v1/imports/${batch.import_batch_id}/report`, `${batch.number}.xlsx`)}
            >
              Download Errors
            </Button>
          </PhoneOnly>
        </>
      ),
      check: () => true,
    },
    {
      title: "Commit",
      body: batch && (
        <>
          <Counts stats={batch.stats} />
          {Object.entries(batch.stats.missing ?? {}).filter(([, values]) => values.length > 0).map(([field, values]) => (
            <Card key={field} className="mt-3">
              <CardHeader title={`New ${labelOf(field)}`} />
              {values.map((v) => (
                <Tick
                  key={v}
                  label={v}
                  checked={(ticked[field] ?? []).includes(v)}
                  onChange={(on) =>
                    setTicked((t) => ({
                      ...t,
                      [field]: on ? [...(t[field] ?? []), v] : (t[field] ?? []).filter((x) => x !== v),
                    }))
                  }
                />
              ))}
            </Card>
          ))}
          {/* A row whose new value is left unticked fails at commit, so the switch shows then too. */}
          {(Number(batch.stats.error ?? 0) + Number(batch.stats.duplicate ?? 0) > 0 ||
            Object.values(batch.stats.missing ?? {}).some((v) => v.length > 0)) && (
            <Switch
              className="mt-3"
              label="Commit Valid Rows"
              checked={validOnly}
              onChange={setValidOnly}
            />
          )}
        </>
      ),
      check: () => true,
    },
  ];

  return (
    <Wizard
      steps={steps}
      finish="Commit Import"
      busy={commit.pending}
      onCancel={close}
      onFinish={async () => {
        if (!batch) return;
        try {
          const out = await commit.run({
            params: { id: batch.import_batch_id },
            body: { valid_only: validOnly, create_missing: ticked },
          });
          toast(`${out.stats.create} created, ${out.stats.update} updated`);
          close();
        } catch (e) {
          // A refused commit keeps every row's result: the counts and the rows are read again,
          // so the person sees what to fix, or turns on Commit Valid Rows, and tries again.
          toast(e instanceof Error ? e.message : "That import did not commit");
          if (e instanceof ApiError && e.code === "IMPORT_HAS_ERRORS") {
            const fresh = await api.call("GET /api/v1/imports/:id", { params: { id: batch.import_batch_id } });
            setBatch(fresh);
            setView("problem");
          }
        }
      }}
    />
  );
}
