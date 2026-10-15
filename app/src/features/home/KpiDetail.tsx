import { useCallback, useState } from "react";
import { useApi, usePaged } from "@/api/hooks";
import { LoadingRows, Pager, Table } from "@/components/ui/Table";
import { useRouter } from "@/lib/router";
import { Cell } from "./blocks";
import type { KpiRow } from "@/api/types/home";
import { Chips, ErrorState, useModal, SearchInput } from "@mycity/ui";

/**
 * Every KPI card opens the records behind its number: GET /home/kpi/:key,
 * paged at 25 by the server, searchable, with the card's own groups as chips.
 */
export function useKpiDetail() {
  const modal = useModal();
  return useCallback((key: string, label: string) => modal.open({ title: label, wide: true, body: (close) => <KpiDetail kpiKey={key} close={close} /> }), [modal]);
}

function KpiDetail({ kpiKey, close }: { kpiKey: string; close: () => void }) {
  const { navigate } = useRouter();
  const meta = useApi("GET /api/v1/home/kpi/:key/meta", { params: { key: kpiKey } });
  const [group, setGroup] = useState("all");
  const list = usePaged("GET /api/v1/home/kpi/:key", { params: { key: kpiKey }, filters: group === "all" ? {} : { group } });

  if (meta.error) return <ErrorState error={meta.error} />;
  if (!meta.data) return <LoadingRows />;
  const m = meta.data;
  const total = m.groups.reduce((a, g) => a + g.count, 0);
  return (
    <>
      {m.sub && <p className="mb-3 text-[11.5px] text-subtle-foreground">{m.sub}</p>}
      {m.groups.length > 1 && (
        <Chips
          value={group}
          onChange={setGroup}
          options={[["all", `All ${total}`], ...m.groups.map((g) => [g.value, `${g.label} ${g.count}`] as [string, string])]}
        />
      )}
      {(list.page?.total ?? 0) > 8 && <SearchInput className="mb-3" value={list.q} onChange={list.setQ} placeholder="Search this list" />}
      <Table
        rows={list.rows}
        rowKey={(r) => r.id}
        loading={list.loading}
        error={list.error}
        onRowClick={(r) => r.link && (close(), navigate(r.link))}
        columns={m.columns.map((c) => ({ key: c.key, label: c.label, align: c.align, render: (r: KpiRow) => (r.cells[c.key] ? <Cell cell={r.cells[c.key]} /> : null) }))}
        footer={<Pager page={list.page} onPage={list.setPage} />}
      />
    </>
  );
}
