import { useState } from "react";
import { useApi, usePaged } from "@/api/hooks";
import "@/api/types/partnerships";
import type { PartnerRow } from "@/api/types/partnerships";
import { useRouter } from "@/lib/router";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { BarsCard, ExportAction, PagedTable } from "@/features/shared/sections";
import { Button, Card, Chips, formatMoneyShort, Grid, LoadingRows, PageHeader, StatusPill, useModal, Who } from "@mycity/ui";
import { PartnerForm } from "./forms/PartnerForm";
import { short } from "./lib";

/** Partnerships · Partners (#51), on the mock until M7 PR 3 (docs/guides/partnerships.md §2, §10). */
export function Partners() {
  const modal = useModal();
  const { navigate } = useRouter();
  const [view, setView] = useState<"all" | "quiet">("all");
  const s = useApi("GET /api/v1/partnerships/partners/summary");
  const list = usePaged("GET /api/v1/partnerships/partners", { filters: view === "quiet" ? { quiet: true } : {} });
  return (
    <>
      <PageHeader
        title="Partners"
        sub="The 360 opens from any row"
        actions={
          <>
            <ExportAction source="partnerships.partners" />
            <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Partner", wide: true, body: (close) => <PartnerForm close={close} /> })}>New Partner</Button>
          </>
        }
      />
      {s.data && <KpiTiles items={[{ label: "Active", value: String(s.data.active) }, { label: "Total Value", value: formatMoneyShort(s.data.total_value) }, { label: "Renewals, 180 Days", value: String(s.data.renewals_180), tone: s.data.renewals_180 ? "warn" : undefined }, { label: "Quiet Over 30 Days", value: String(s.data.quiet_30), tone: s.data.quiet_30 ? "err" : "ok" }]} />}
      <Chips value={view} onChange={setView} options={[["all", "All Partners"], ["quiet", "Quiet Over 30 Days"]]} />
      <PagedTable<PartnerRow>
        title="All Partners"
        list={list}
        search="Search partners"
        rowKey={(p) => p.partner_id}
        noun="partner"
        onRowClick={(p) => navigate(`/partnerships?tab=partners&id=${p.partner_id}`)}
        wide
        columns={[
          { key: "p", label: "Partner", render: (p) => <Who name={p.name} sub={p.industry} /> },
          { key: "t", label: "Type", render: (p) => p.type, desktop: true },
          { key: "s", label: "Stage", render: (p) => <StatusPill s={p.stage_status} /> },
          { key: "o", label: "Owner", render: (p) => short(p.owner), desktop: true },
          { key: "v", label: "Value", align: "n", render: (p) => formatMoneyShort(p.value) },
          { key: "l", label: "Last Contact", render: (p) => (p.last_contact_days === 0 ? "Today" : `${p.last_contact_days} days ago`) },
        ]}
      />
      <Grid cols={2} className="mt-3">
        {s.data ? <BarsCard title="Value by Partnership Type" rows={s.data.by_type} /> : <Card><LoadingRows /></Card>}
      </Grid>
    </>
  );
}
