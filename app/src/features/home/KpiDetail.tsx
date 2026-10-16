import { useCallback, useState } from "react";
import { useApi, usePaged } from "@/api/hooks";
import { useRouter } from "@/lib/router";
import { Cell } from "./blocks";
import type { KpiRow } from "@/api/types/home";
import { ErrorState, KpiDetail, LoadingRows, useModal } from "@mycity/ui";

/**
 * Every KPI card opens the records behind its number (docs/guides/home.md §3
 * step 3): GET /home/kpi/:key, paged at 25 by the server, searchable, with the
 * card's own groups as chips. The report model itself is `KpiDetail` in
 * @mycity/ui; this binds it to the two endpoints and to the router.
 */
export function useKpiDetail() {
  const modal = useModal();
  return useCallback(
    (key: string, label: string) => modal.open({ title: label, wide: true, body: (close) => <Report kpiKey={key} label={label} close={close} /> }),
    [modal],
  );
}

function Report({ kpiKey, label, close }: { kpiKey: string; label: string; close: () => void }) {
  const { navigate } = useRouter();
  const meta = useApi("GET /api/v1/home/kpi/:key/meta", { params: { key: kpiKey } });
  const [group, setGroup] = useState("all");
  const list = usePaged("GET /api/v1/home/kpi/:key", { params: { key: kpiKey }, filters: group === "all" ? {} : { group } });

  if (meta.error) return <ErrorState error={meta.error} />;
  if (!meta.data) return <LoadingRows />;
  const m = meta.data;

  return (
    <KpiDetail
      caption={label}
      summary={m.sub}
      groups={m.groups}
      group={group}
      onGroup={setGroup}
      list={list}
      rowKey={(r) => r.id}
      onRowClick={(r) => {
        if (!r.link) return;
        close();
        navigate(r.link);
      }}
      columns={m.columns.map((c) => ({
        key: c.key,
        label: c.label,
        align: c.align,
        render: (r: KpiRow) => (r.cells[c.key] ? <Cell cell={r.cells[c.key]} /> : null),
      }))}
    />
  );
}
