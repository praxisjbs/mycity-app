import { useApi } from "@/api/hooks";
import "@/api/types/partnerships";
import { useRouter } from "@/lib/router";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { BarsCard } from "@/features/shared/sections";
import { Button, Card, DataView, formatMoneyShort, Grid, LoadingRows, PageHeader, Pill, StatusPill, useModal } from "@mycity/ui";
import { PartnerForm } from "./forms/PartnerForm";
import { short } from "./lib";

/** Partnerships · Pipeline (#50), on the mock until M7 PR 3 (docs/guides/partnerships.md §2, §10). */
export function Pipeline() {
  const modal = useModal();
  const { navigate } = useRouter();
  const s = useApi("GET /api/v1/partnerships/pipeline");
  const d = s.data;
  return (
    <>
      <PageHeader
        title="Pipeline"
        sub={d ? `${d.in_pipeline} in the pipeline · ${d.going_quiet} going quiet` : " "}
        actions={
          <>
            <Button icon="grid" onClick={() => navigate("/partnerships?tab=partners")}>Board</Button>
            <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Partner", wide: true, body: (close) => <PartnerForm close={close} /> })}>New Partner</Button>
          </>
        }
      />
      {!d ? <Card><LoadingRows count={6} /></Card> : (
        <>
          <KpiTiles items={[{ label: "In the Pipeline", value: String(d.in_pipeline) }, { label: "Signed This Year", value: String(d.signed_this_year), tone: "ok" }, { label: "Signed Value", value: formatMoneyShort(d.signed_value) }, { label: "Going Quiet", value: String(d.going_quiet), tone: d.going_quiet ? "err" : "ok" }]} />
          <BarsCard title="Stages" rows={d.stages} />
          <Grid cols={2} className="mt-3">
            <DataView
              title="Longest at a Stage"
              right={<Pill tone="err">{d.longest.filter((x) => x.days_at_stage > 30).length} over 30 days</Pill>}
              rows={d.longest}
              rowKey={(r) => r.partner_id}
              onRowClick={(r) => navigate(`/partnerships?tab=pipeline&id=${r.partner_id}`)}
              columns={[
                { key: "p", label: "Partner", render: (r) => <span className="font-semibold">{r.name}</span> },
                { key: "s", label: "Stage", render: (r) => r.stage, desktop: true },
                { key: "d", label: "Days at Stage", align: "n", render: (r) => r.days_at_stage },
                { key: "o", label: "Owner", render: (r) => short(r.owner), desktop: true },
                { key: "a", label: "Action", render: (r) => <StatusPill s={r.action} /> },
              ]}
            />
          </Grid>
        </>
      )}
    </>
  );
}
