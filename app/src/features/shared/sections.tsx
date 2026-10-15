import type { ReactNode } from "react";
import { api } from "@/api/client";
import { useApi, type PagedResult } from "@/api/hooks";
import "@/api/types/organisation";
import type { BarRow } from "@/api/types/home";
import "@/api/types/shared";
import { Button, KeyValue, Card, CardHeader, toast, SearchInput, HelpTerm } from "@mycity/ui";
import { Bars, Chain, Timeline } from "@/components/ui/data";
import { Pager, Table, type Column } from "@/components/ui/Table";
import { toBars } from "@/features/home/blocks";

/**
 * The building blocks the module screens share: the explanation card, the
 * approval chain, bars and a trail, and the server-paged table with search.
 */

export function KvCard({ title, items, info, right }: { title: string; items: Array<[ReactNode, ReactNode]>; info?: string; right?: ReactNode }) {
  return (
    <Card>
      <CardHeader title={info ? <HelpTerm help={info}>{title}</HelpTerm> : title} right={right} />
      <KeyValue items={items} />
    </Card>
  );
}

export function ChainCard({ steps, note, title }: { steps: Array<{ label: string; state?: "done" | "now" | null }>; note?: string; title?: string }) {
  return (
    <Card className="mb-3">
      {title && <CardHeader title={title} />}
      <Chain steps={steps.map((s) => ({ label: s.label, state: s.state ?? undefined }))} />
      {note && <p className="mt-[11px] text-[11.5px] text-subtle-foreground">{note}</p>}
    </Card>
  );
}

export function BarsCard({ title, rows, note, info, right }: { title: string; rows: BarRow[]; note?: string; info?: string; right?: ReactNode }) {
  return (
    <Card>
      <CardHeader title={info ? <HelpTerm help={info}>{title}</HelpTerm> : title} right={right} />
      <Bars rows={toBars(rows)} note={note} />
    </Card>
  );
}

export function TrailCard({ title, items }: { title: string; items: Array<{ title: string; when: string; text?: string | null; tone?: "hi" | "ok" | null }> }) {
  return (
    <Card>
      <CardHeader title={title} />
      <Timeline items={items.map((x) => ({ title: x.title, when: x.when, text: x.text ?? undefined, tone: x.tone ?? undefined }))} />
    </Card>
  );
}

/** Export goes to the worker; the file arrives in the Mailbox (FRONTEND_GUIDE §4: never a client-side dump of rows). */
export function ExportButton({ source, filters, label = "Export" }: { source: string; filters?: Record<string, unknown>; label?: string }) {
  return (
    <Button
      icon="doc"
      onClick={async () => {
        await api.call("POST /api/v1/exports", { body: { source, filters: filters ?? {} } });
        toast("Export queued. The file arrives in your Mailbox.");
      }}
    >
      {label}
    </Button>
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
  columns: Column<R>[];
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
    <Table
      title={title}
      right={
        (search || right) && (
          <span className="flex flex-wrap items-center justify-end gap-2">
            {search && <SearchInput value={list.q} onChange={list.setQ} placeholder={search} className="w-[220px] max-md:w-full" />}
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
      empty={empty ?? (list.q ? { title: "Nothing matches", text: "Try another search." } : undefined)}
      wide={wide}
      footer={<Pager page={list.page} onPage={list.setPage} noun={noun} nounPlural={nounPlural} />}
    />
  );
}

/** The buttons row at the bottom of a form in the modal. */
export function ModalFoot({ children }: { children: ReactNode }) {
  return <div className="-mx-[18px] mt-2 -mb-4 flex flex-wrap items-center justify-end gap-2 border-t border-border px-[18px] py-3">{children}</div>;
}

/** Department options from the organisation's own list (never typed into a screen). */
export function useDepartmentOptions(all = "All Departments"): Array<[string, string]> {
  const d = useApi("GET /api/v1/departments", { query: {} });
  return [["", all], ...(d.data?.data ?? []).map((x) => [x.name, x.name] as [string, string])];
}
