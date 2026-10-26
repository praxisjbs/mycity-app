import { useState } from "react";
import type { AuditEntry } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { useAuth } from "@/auth/AuthProvider";
import { saveExport } from "@/api/exports";
import { useApi, usePaged } from "@/api/hooks";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { useRouter } from "@/lib/router";
import {
  Bars,
  Button,
  Card,
  CardHeader,
  DataView,
  DateRangeField,
  DesktopOnly,
  EmptyState,
  ErrorState,
  ExportButton,
  Field,
  FilterSelect,
  formatDateTime,
  FormFooter,
  Grid,
  HelpTerm,
  KeyValue,
  LoadingRows,
  PageHeader,
  PhoneOnly,
  Pill,
  SearchInput,
  Toolbar,
  useModal,
  Who,
} from "@mycity/ui";

type Filters = { module?: string; from?: string; to?: string };
const RESTRICTED = "Your roles cannot see this value.";

/** "Public holiday" from "public_holiday". */
const typeLabel = (t: string) => (t.charAt(0).toUpperCase() + t.slice(1)).replace(/_/g, " ");
/** A long id shortened for a list; names and numbers stay whole. */
const shortId = (id: string) => (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id) ? id.slice(0, 8) : id);
const valueText = (v: unknown) => (v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : String(v));

/**
 * Settings · Audit Log (docs/guides/foundation.md §10): every write in every module,
 * who, what, which record and when, filtered at 25 a page, with the whole filtered
 * log exported as a workbook downloaded here. Values the reader's roles mask show as Restricted.
 */
export function AuditLog() {
  const modal = useModal();
  const summary = useApi("GET /api/v1/audit/summary");
  const [filters, setFilters] = useState<Filters>({});
  const list = usePaged("GET /api/v1/audit", { filters });
  const s = summary.data;
  const modules: Array<[string, string]> = [["", "Every Module"], ...(s?.modules ?? []).map((m) => [m.key, m.label] as [string, string])];
  const set = (patch: Filters) => setFilters((f) => Object.fromEntries(Object.entries({ ...f, ...patch }).filter(([, v]) => v)) as Filters);
  const exportLog = () => saveExport(api.call("POST /api/v1/audit/exports", { body: filters }));
  // Export is `settings` export, as its route asks.
  const mayExport = useAuth().can("settings", "export");

  // The log is read with Settings over everyone: a narrower scope is told so, never offered a Retry that cannot work.
  if (summary.error instanceof ApiError && summary.error.status === 403)
    return (
      <>
        <PageHeader title="Audit Log" />
        <Card>
          <EmptyState icon="lock" title="No Access" text="The audit log needs Settings access over everyone." />
        </Card>
      </>
    );
  if (summary.error) return (<><PageHeader title="Audit Log" /><Card><ErrorState error={summary.error} onRetry={summary.reload} /></Card></>);

  const filterFields = (
    <>
      <FilterSelect label="Module" value={filters.module ?? ""} onChange={(v) => set({ module: v || undefined })} options={modules} />
      <Field label="Dates" optional>
        <DateRangeField value={{ from: filters.from ?? "", to: filters.to ?? "" }} onChange={(r) => set({ from: r.from || undefined, to: r.to || undefined })} />
      </Field>
    </>
  );

  return (
    <>
      <PageHeader
        title="Audit Log"
        actions={
          mayExport ? (
            <DesktopOnly>
              <ExportButton onExport={exportLog} />
            </DesktopOnly>
          ) : undefined
        }
      />
      {s && (
        <KpiTiles
          mobileCols={2}
          items={[
            { label: "Today", value: s.today.toLocaleString("en-NG") },
            { label: "This Week", value: s.this_week.toLocaleString("en-NG") },
            { label: "This Month", value: s.this_month.toLocaleString("en-NG") },
            { label: "Sensitive", value: s.sensitive_this_month.toLocaleString("en-NG"), sub: "This month" },
          ]}
        />
      )}
      <DesktopOnly>
        <Toolbar label="Audit Log" className="mt-3">
          <SearchInput value={list.q} onChange={list.setQ} placeholder="Who or what" />
          {filterFields}
        </Toolbar>
      </DesktopOnly>
      <PhoneOnly>
        <div className="mt-3 flex gap-2">
          <SearchInput value={list.q} onChange={list.setQ} placeholder="Who or what" className="flex-1" />
          <Button
            icon="filter"
            onClick={() =>
              modal.open({
                title: "Filter",
                body: (close) => (
                  <>
                    {filterFields}
                    <FormFooter>
                      <Button onClick={() => (setFilters({}), close())}>Clear Filters</Button>
                      <Button variant="primary" onClick={close}>
                        Show Entries
                      </Button>
                    </FormFooter>
                  </>
                ),
              })
            }
          >
            Filter
          </Button>
        </div>
      </PhoneOnly>
      <DataView
        className="mt-3"
        title="Entries"
        list={list}
        rowKey={(a) => a.audit_ledger_id}
        noun="entry"
        nounPlural="entries"
        onRowClick={(a) => modal.open({ title: a.summary, wide: true, body: (close) => <EntryDetail entry={a} close={close} /> })}
        empty={{ title: "No Entries Match", text: "Try another module or dates.", icon: "srch" }}
        columns={[
          { key: "occurred_at", label: "When", sortable: true, render: (a) => formatDateTime(a.occurred_at) },
          { key: "who", label: "Who", render: (a) => (a.actor_name ? <Who name={a.actor_name} sub={a.actor_email ?? undefined} /> : "System") },
          { key: "what", label: "What", render: (a) => <b>{a.summary}</b> },
          { key: "record", label: "Record", render: (a) => `${typeLabel(a.entity_type)} · ${shortId(a.entity_id)}` },
          { key: "module", label: "Module", desktop: true, render: (a) => s?.modules.find((m) => m.key === a.module_key)?.label ?? a.module_key },
          { key: "flags", label: "", desktop: true, render: (a) => (a.masked.length ? <Pill tone="warn">Restricted</Pill> : a.is_sensitive ? <Pill tone="info">Sensitive</Pill> : null) },
        ]}
      />
      <DesktopOnly>
        <Grid cols={2} className="mt-3">
          <Card>
            <CardHeader title="Entries by Module" />
            {!s ? (
              <LoadingRows />
            ) : (
              <Bars rows={s.by_module.slice(0, 8).map((m) => ({ label: m.label, value: m.entries.toLocaleString("en-NG"), percent: Math.round((m.entries * 100) / Math.max(1, s.by_module[0]?.entries ?? 1)) }))} note="This month" />
            )}
          </Card>
        </Grid>
      </DesktopOnly>
    </>
  );
}

/** One entry: who, what, the record, and each field before and after. */
function EntryDetail({ entry, close }: { entry: AuditEntry; close: () => void }) {
  const { navigate } = useRouter();
  const keys = [...new Set([...(entry.changed_fields.length ? entry.changed_fields : []), ...Object.keys(entry.after ?? {}), ...Object.keys(entry.before ?? {})])];
  const restricted = new Set(entry.masked);
  const shown = (side: AuditEntry["before"], k: string) => {
    if (!side || !(k in side)) return null;
    const v = side[k];
    if (restricted.has(k) && (v === null || v === undefined)) return <HelpTerm help={RESTRICTED}>Restricted</HelpTerm>;
    return <span data-copy="content" className="wrap-any">{valueText(v)}</span>;
  };
  return (
    <>
      <KeyValue
        items={[
          ["When", formatDateTime(entry.occurred_at)],
          ["Who", entry.actor_name ? `${entry.actor_name}${entry.actor_email ? `, ${entry.actor_email}` : ""}` : "System"],
          ["Record", `${typeLabel(entry.entity_type)} · ${entry.entity_id}`],
          ["Action", <code key="a" className="text-xs">{entry.action}</code>],
          ["Address", entry.actor_ip],
        ]}
      />
      {keys.length > 0 && (
        <DataView
          className="mt-3"
          caption="Changes"
          rows={keys}
          rowKey={(k) => k}
          bare
          columns={[
            { key: "field", label: "Field", render: (k) => <b>{k.replace(/_/g, " ")}</b> },
            { key: "before", label: "Before", render: (k) => shown(entry.before, k) },
            { key: "after", label: "After", render: (k) => shown(entry.after, k) },
          ]}
        />
      )}
      <FormFooter>
        {entry.link && (
          <Button
            onClick={() => {
              close();
              navigate(entry.link!);
            }}
          >
            Open Record
          </Button>
        )}
        <Button variant="primary" onClick={close}>
          Close
        </Button>
      </FormFooter>
    </>
  );
}

