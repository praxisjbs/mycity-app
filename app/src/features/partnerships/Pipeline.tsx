import type { DealRow, PipelineDeal } from "@mycity/contract/contract.gen.ts";
import { useEffect, useState } from "react";
import { useApi, usePaged } from "@/api/hooks";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { BarsCard, PagedTable } from "@/features/shared/sections";
import { useRouter } from "@/lib/router";
import { useScreenAction } from "@/shell/screen-action";
import { Button, Card, Chips, DataView, DesktopOnly, FilterSelect, formatMoneyShort, Grid, LoadingRows, PageHeader, PhoneOnly, StatusPill, useModal, Who } from "@mycity/ui";
import { DealForm } from "./forms/DealForm";
import { LeadForm } from "./forms/LeadForm";
import { healthPill, recordHref, SCOPES, useCategoryOptions, useMay, useStages } from "./lib";

type Health = "" | "on_track" | "follow_up_required" | "stalled";

/**
 * Partnerships · Pipeline (#50, docs/guides/partnerships.md §2, §10): the KPI strip, deals by stage,
 * the longest at a stage and the stalled with their blockers, filtered by stage, category, region and
 * health. No board (§6.5): a row opens its lead's or partner's 360, where the stage moves. A deal
 * named by the address (`?id=`, ⌘K, Home) opens its record's 360.
 */
export function Pipeline({ id }: { id: string | null }) {
  const modal = useModal();
  const { navigate } = useRouter();
  const mayCreate = useMay("create");
  const { stages } = useStages();
  const categories = useCategoryOptions();
  const [stage, setStage] = useState("");
  const [category, setCategory] = useState("");
  const [scope, setScope] = useState("");
  const [health, setHealth] = useState<Health>("");
  const filters = { ...(stage && { stage }), ...(category && { partner_category_id: category }), ...(scope && { region_scope: scope as "national" }), ...(health && { health }) };
  const p = useApi("GET /api/v1/partnerships/pipeline", { query: filters });
  const deals = usePaged("GET /api/v1/partnerships/deals", { filters: { ...filters, status: "open" as const }, sort: "expected_close_on" });
  const named = useApi("GET /api/v1/partnerships/deals/:id", { params: { id: id ?? "" }, enabled: Boolean(id) });
  useEffect(() => {
    if (named.data) navigate(recordHref(named.data.record), { replace: true });
  }, [named.data, navigate]);
  const newDeal = (partnerId: string) => modal.open({ title: "New Deal", wide: true, body: (close) => <DealForm partnerId={partnerId} close={close} /> });
  const newLead = () => modal.open({ title: "New Lead", wide: true, body: (close) => <LeadForm close={close} onCreated={(lid) => navigate(`/partnerships?tab=leads&id=${lid}`)} onNewDeal={(pid) => (close(), newDeal(pid))} /> });
  useScreenAction(mayCreate ? { label: "New Lead", onSelect: newLead } : null);
  const open = (d: { record: { type: "lead" | "partner"; id: string } }) => navigate(recordHref(d.record));
  const d = p.data;
  const top = Math.max(1, ...(d?.by_stage ?? []).map((s) => s.open));
  return (
    <>
      <PageHeader title="Pipeline" sub="Every open deal and where it stands" actions={mayCreate ? <Button variant="primary" icon="plus" onClick={newLead}>New Lead</Button> : undefined} />
      <DesktopOnly>
        <Grid cols={4} className="mb-3">
          <FilterSelect label="Stage" value={stage} onChange={setStage} options={[["", "Every Stage"], ...stages.map((s) => [s.code, s.label] as [string, string])]} />
          <FilterSelect label="Category" value={category} onChange={setCategory} options={[["", "Every Category"], ...categories.options]} more={categories.more} onMore={categories.onMore} />
          <FilterSelect label="Region" value={scope} onChange={setScope} options={[["", "Every Region"], ...SCOPES]} />
          <FilterSelect label="Health" value={health} onChange={(v) => setHealth(v as Health)} options={[["", "Any Health"], ["on_track", "On Track"], ["follow_up_required", "Follow-up Required"], ["stalled", "Stalled"]]} />
        </Grid>
      </DesktopOnly>
      {!d ? (
        <Card><LoadingRows count={6} /></Card>
      ) : (
        <>
          <KpiTiles
            mobileCols={2}
            items={[
              { label: "Open Deals", value: String(d.kpis.open_deals) },
              { label: "Stalled", value: String(d.kpis.stalled), tone: d.kpis.stalled ? "err" : "ok", help: "Open and live deals with something in the way." },
              { label: "Signed This Year", value: String(d.kpis.signed_this_year), tone: "ok" },
              { label: "Signed Value", value: formatMoneyShort(d.kpis.signed_value), help: "Each deal signed this year at its agreement's value, else its projected value." },
            ]}
          />
          <PhoneOnly className="mt-3">
            <Chips label="Health" value={health} onChange={(v) => setHealth(v as Health)} options={[["", "All"], ["stalled", "Stalled"], ["follow_up_required", "Follow-up"], ["on_track", "On Track"]]} />
            <PagedTable<DealRow>
              title="Open Deals"
              list={deals}
              rowKey={(x) => x.deal_id}
              noun="deal"
              onRowClick={open}
              empty={{ title: "No Open Deals", text: "New leads start here." }}
              columns={[
                { key: "r", label: "Record", render: (x) => <Who name={x.record.name} sub={x.title} /> },
                { key: "s", label: "Stage", render: (x) => x.stage_label },
                { key: "h", label: "Health", render: (x) => <StatusPill status={healthPill(x.health)} /> },
                { key: "d", label: "Days at Stage", align: "n", render: (x) => x.days_at_stage },
              ]}
            />
          </PhoneOnly>
          <DesktopOnly className="mt-3">
            <BarsCard title="Stages" rows={d.by_stage.map((s) => ({ label: s.label, pct: Math.round((s.open / top) * 100), value: String(s.open) }))} />
            <Grid cols={2} className="mt-3">
              <DataView<PipelineDeal>
                title="Longest at a Stage"
                rows={d.longest_at_stage}
                rowKey={(x) => x.deal_id}
                onRowClick={open}
                empty={{ title: "Nothing Waiting", text: "Open deals show here." }}
                columns={[
                  { key: "r", label: "Record", render: (x) => <Who name={x.record.name} sub={x.title} /> },
                  { key: "s", label: "Stage", render: (x) => x.stage_label },
                  { key: "d", label: "Days", align: "n", render: (x) => x.days_at_stage },
                  { key: "o", label: "Owner", render: (x) => x.owner?.display_name ?? "No Owner" },
                ]}
              />
              <DataView<PipelineDeal>
                title="Stalled"
                rows={d.stalled}
                rowKey={(x) => x.deal_id}
                onRowClick={open}
                empty={{ title: "Nothing Stalled", text: "Stalled deals show here." }}
                columns={[
                  { key: "r", label: "Record", render: (x) => <Who name={x.record.name} sub={x.title} /> },
                  { key: "b", label: "Blockers", render: (x) => x.blockers ?? "None" },
                  { key: "o", label: "Owner", render: (x) => x.owner?.display_name ?? "No Owner" },
                ]}
              />
            </Grid>
          </DesktopOnly>
        </>
      )}
    </>
  );
}
