import { useCallback, useState, type ReactNode } from "react";
import type { HomeKpiCell, HomeKpiDetailRow } from "@mycity/contract/contract.gen.ts";
import { usePhotos } from "@/api/download";
import { useApi, usePaged } from "@/api/hooks";
import { useRouter } from "@/lib/router";
import { ErrorState, formatDate, formatDateTime, formatTime, KpiDetail, LoadingRows, Money, Pill, todayIso, useModal, Who } from "@mycity/ui";

/**
 * Every KPI card opens the records behind its number (docs/guides/home.md §3 step 3):
 * GET /home/kpi/:key/meta for the line above them, their columns and their groups, then
 * GET /home/kpi/:key, paged at 25 by the server, with the card's groups as chips. The report
 * model itself is `KpiDetail` in @mycity/ui; this binds it to the two endpoints and the
 * router. On a phone the modal is a bottom sheet and the records are cards: the first
 * column is the card's title and only the columns the card marks `phone` follow it.
 *
 * A card the reader may not see answers 404, and the sheet says so with ErrorState.
 */
export function useKpiDetail(): OpenKpiDetail {
  const modal = useModal();
  return useCallback(
    (key, title, onClose) =>
      modal.open({
        title: title ?? <RecordsTitle kpiKey={key} />,
        wide: true,
        onClose,
        body: (close) => <Records kpiKey={key} close={close} />,
      }),
    [modal],
  );
}

/**
 * Opens a card's records by its catalogue key. `title` is the card's, as the row shows it;
 * without it (a link straight to a card not on the reader's row) the records' own title names
 * the sheet. `onClose` runs once the sheet closes, however it closed.
 */
export type OpenKpiDetail = (key: string, title?: string, onClose?: () => void) => void;

/** The title of a card's records, for a sheet opened without its card in hand. */
function RecordsTitle({ kpiKey }: { kpiKey: string }) {
  const meta = useApi("GET /api/v1/home/kpi/:key/meta", { params: { key: kpiKey } });
  return <>{meta.data?.title ?? "Records"}</>;
}

function Records({ kpiKey, close }: { kpiKey: string; close: () => void }) {
  const { navigate } = useRouter();
  const meta = useApi("GET /api/v1/home/kpi/:key/meta", { params: { key: kpiKey } });
  const [group, setGroup] = useState("all");
  const list = usePaged("GET /api/v1/home/kpi/:key", { params: { key: kpiKey }, filters: group === "all" ? {} : { group } });
  const photo = usePhotos(list.rows.flatMap((r) => Object.values(r.cells) as Array<HomeKpiCell | null>).map((c) => (c?.kind === "person" ? c.person.photo_url : null)));

  if (meta.error) return <ErrorState error={meta.error} onRetry={meta.reload} />;
  if (!meta.data) return <LoadingRows />;
  const m = meta.data;

  return (
    <KpiDetail
      caption={m.title}
      summary={m.summary ?? undefined}
      groups={m.groups}
      group={group}
      onGroup={setGroup}
      list={list}
      rowKey={(r) => r.id}
      noun="record"
      onRowClick={(r) => {
        if (!r.link) return;
        close();
        navigate(r.link);
      }}
      columns={m.columns.map((c, i) => ({
        key: c.key,
        label: c.label,
        align: c.numeric ? ("n" as const) : undefined,
        // A phone card is the first column as its title and the columns the card marks for a phone.
        desktop: i > 0 && !c.phone,
        render: (r: HomeKpiDetailRow) => <Cell cell={r.cells[c.key] ?? null} photo={photo} />,
      }))}
    />
  );
}

/**
 * A moment as a list reads it: the time alone for today ("09:14", a clock-in), the day and
 * the time for any other day ("13/10/2026 09:14", a last contact).
 */
export function momentOf(at: string, today = todayIso()): string {
  return formatDate(at) === formatDate(today) ? formatTime(at) : formatDateTime(at);
}

const NUMBER = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });

/** One cell of a card's records, formatted at render time: dates day-first, money as Naira; a person with their photo (usePhotos). */
export function Cell({ cell, photo }: { cell: HomeKpiCell | null; photo?: (url: string | null) => string | null }): ReactNode {
  if (!cell) return null;
  switch (cell.kind) {
    case "text":
      return cell.text;
    case "person":
      return <Who name={cell.person.display_name} sub={cell.person.department ?? undefined} src={photo ? photo(cell.person.photo_url) : null} />;
    case "pill":
      return <Pill tone={cell.tone}>{cell.text}</Pill>;
    case "money":
      return <Money value={cell.amount} />;
    case "date":
      return formatDate(cell.date);
    case "time":
      return momentOf(cell.at);
    case "number":
      return NUMBER.format(cell.value);
  }
}
