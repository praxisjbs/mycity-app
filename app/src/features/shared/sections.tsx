import type { ReactNode } from "react";
import { api } from "@/api/client";
import { saveExport } from "@/api/exports";
import { useInfinite, type PagedResult } from "@/api/hooks";
import "@/api/types/organisation";
import "@/api/types/shared";
import { Bars, Card, CardHeader, Chain, DataView, ExportButton, KeyValue, Pager, SearchInput, Timeline, type DataViewColumn } from "@mycity/ui";
import { paging, toBars, toTrail, type Paging, type WireBar, type WireTrailItem } from "./wire";

/**
 * The building blocks the module screens share: the explanation card, the
 * approval chain, bars and a trail, and the server-paged table with search.
 */

export function KvCard({ title, items, info, right }: { title: string; items: Array<[ReactNode, ReactNode]>; info?: string; right?: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} help={info} right={right} />
      <KeyValue items={items} />
    </Card>
  );
}

export function ChainCard({ steps, note, title }: { steps: Array<{ label: string; state?: "done" | "now" | null }>; note?: string; title?: string }) {
  return (
    <Card className="mb-3">
      {title && <CardHeader title={title} />}
      <Chain steps={steps.map((s) => ({ label: s.label, state: s.state ?? undefined }))} />
      {note && <p className="mt-2.5 text-2xs text-subtle-foreground">{note}</p>}
    </Card>
  );
}

export function BarsCard({ title, rows, note, info, right }: { title: string; rows: WireBar[]; note?: string; info?: string; right?: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} help={info} right={right} />
      <Bars rows={toBars(rows)} note={note} />
    </Card>
  );
}

export function TrailCard({ title, items }: { title: string; items: WireTrailItem[] }) {
  return (
    <Card>
      <CardHeader title={title} />
      <Timeline items={toTrail(items)} />
    </Card>
  );
}

/**
 * The shared ExportButton bound to this app's export route. The worker makes the
 * file and it downloads on this device (api/exports.ts; FRONTEND_GUIDE §4: never a
 * client-side dump of the rows on screen).
 */
export function ExportAction({ source, filters, label }: { source: string; filters?: Record<string, unknown>; label?: string }) {
  return (
    <ExportButton onExport={() => saveExport(api.call("POST /api/v1/exports", { body: { source, filters: filters ?? {} } }))}>
      {label}
    </ExportButton>
  );
}

/**
 * A server-paged table: `page` and `q` go to the API, the rows shown are the
 * page it returns, and the footer pages through them.
 */
export function PagedTable<R>({
  list, columns, title, right, search, onRowClick, noun, nounPlural, empty, wide, rowKey,
}: {
  list: PagedResult<R>;
  columns: DataViewColumn<R>[];
  rowKey: (r: R) => string;
  title?: ReactNode;
  right?: ReactNode;
  search?: string;
  onRowClick?: (r: R) => void;
  noun?: string;
  nounPlural?: string;
  empty?: { title: ReactNode; text?: ReactNode };
  wide?: boolean;
}) {
  return (
    <DataView
      title={title}
      right={
        (search || right) && (
          <span className="flex flex-wrap items-center justify-end gap-2">
            {search && <SearchInput value={list.q} onChange={list.setQ} placeholder={search} className="w-56 max-md:w-full" />}
            {right}
          </span>
        )
      }
      columns={columns}
      rows={list.rows}
      rowKey={rowKey}
      loading={list.loading}
      error={list.error}
      onRowClick={onRowClick}
      empty={empty ?? (list.q ? { title: "Nothing Matches", text: "Try another search." } : undefined)}
      wide={wide}
      /* The table's own title names its pages, so two lists on one screen are two landmarks a screen reader can tell apart. */
      footer={<Pager page={list.page} onPage={list.setPage} noun={noun} nounPlural={nounPlural} label={typeof title === "string" ? title : undefined} />}
    />
  );
}

/** Department options from the organisation's own list (never typed into a screen), 25 at a time as the menu nears its end. */
export function useDepartmentOptions(): { options: Array<[string, string]> } & Paging {
  const d = useInfinite("GET /api/v1/departments");
  return { options: d.rows.map((x) => [x.name, x.name] as [string, string]), ...paging(d) };
}
