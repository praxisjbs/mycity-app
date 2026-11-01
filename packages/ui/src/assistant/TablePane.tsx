/**
 * @component TablePane
 * @group Assistant
 * @summary The pane's Table: every row of one read, 25 a page from the server, each row opening its record; past 200 rows it says how many there are.
 * @use In PaneTabs' table slot, fed by a read run again (GET /ai/answers/:id/reads/:n, docs/guides/praxis-ai.md §6.12): the screen passes each page as it lands and asks for the next. `onExport` is the slot Download Excel fills (PR3 of the Praxis AI Engine); without it no button is drawn.
 * @avoid A list of a screen's own (DataView with usePaged); the answer's own table under its words (the screen draws that bare DataView itself); sorting on the client.
 * @phone A card list (DataView's phone form) inside the pane sheet, the pager under it; a row is one tap target.
 * @a11y A DataView: a named table on desktop, a list of buttons on a phone; the pager is a navigation landmark; a cell with nothing shows the empty marker.
 * @status beta
 * @example <TablePane caption="Leave requests" columns={rows.columns} rows={rows.rows} numeric={rows.numeric} links={rows.links} page={rows.page} onPage={setPage} onOpenRow={show} />
 */
import { cn } from "../lib/cn";
import { formatCount } from "../lib/format";
import { DataView, type DataViewColumn } from "../data/DataView";
import type { ApiError, PageMeta } from "../data/createApi";

/** The pane pages at 25 up to this many pages (200 rows); past them it says how many rows there are (decision 14). */
export const TABLE_PAGES = 8;

export interface TablePaneProps {
  /** Names the table for screen readers: the read in words ("Leave requests"). */
  caption: string;
  /** The column headers, as the server sent them. */
  columns: string[];
  /** This page's rows, each a cell per column, already formatted for a person. */
  rows: string[][];
  /** Columns to right-align: amounts and counts. */
  numeric: number[];
  /** Each row's record, as a path; null where a row has no screen. */
  links: Array<string | null>;
  /** The server's page; the pager is drawn from it. */
  page?: PageMeta | null;
  /** A page is on its way. */
  loading?: boolean;
  /** The read failed; Try Again asks again. */
  error?: ApiError | null;
  /** Asks for a page number. */
  onPage?: (n: number) => void;
  /** Asks for the page again, behind Try Again. */
  onReload?: () => void;
  /** Opens a row (its index on this page) in the Record view. */
  onOpenRow?: (index: number) => void;
  /** Download Excel: the whole read as a workbook through the export path (filled by PR3 of the Praxis AI Engine). No button without it. */
  onExport?: () => Promise<unknown>;
  /** Layout classes only (spacing). */
  className?: string;
}

interface Row {
  key: string;
  index: number;
  cells: string[];
  link: string | null;
}

export function TablePane({ caption, columns, rows, numeric, links, page, loading, error, onPage, onReload, onOpenRow, onExport, className }: TablePaneProps) {
  const data: Row[] = rows.map((cells, index) => ({ key: String(index), index, cells, link: links[index] ?? null }));
  const cols: DataViewColumn<Row>[] = columns.map((label, i) => ({
    key: `c${i}`,
    label: <span data-copy="content">{label}</span>,
    ...(numeric.includes(i) ? { align: "n" as const } : {}),
    render: (r) => r.cells[i] ?? "",
  }));
  // Pages past the cap are not offered; the line under the pager says how many rows there are.
  const capped = page && page.pages > TABLE_PAGES ? { ...page, pages: TABLE_PAGES, has_next: page.number < TABLE_PAGES } : page;
  const over = page && page.pages > TABLE_PAGES ? page.total : null;
  return (
    <div data-copy="content" className={cn("-mx-3.5", className)}>
      <DataView<Row>
        bare
        rows={data}
        columns={cols}
        rowKey={(r) => r.key}
        caption={caption}
        noun="row"
        page={capped ?? undefined}
        loading={loading}
        error={error ?? null}
        onPage={onPage}
        onReload={onReload}
        onRowClick={onOpenRow ? (r) => onOpenRow(r.index) : undefined}
        onExport={onExport}
        empty={{ title: "No Rows" }}
        footer={
          over != null ? (
            <p className="px-3.5 pb-3 text-xs text-subtle-foreground">
              Showing the first {formatCount(TABLE_PAGES * (page?.size ?? 25))} of {formatCount(over)} rows
            </p>
          ) : undefined
        }
      />
    </div>
  );
}
