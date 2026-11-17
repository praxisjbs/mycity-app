import type { LeadRow } from "@mycity/contract/contract.gen.ts";
import { api } from "@/api/client";
import { saveExport } from "@/api/exports";
import { useApi, usePaged } from "@/api/hooks";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { BarsCard, PagedTable } from "@/features/shared/sections";
import { useRouter } from "@/lib/router";
import { useOpenWhereNews, useViewNews, withNews } from "@/features/notifications/marks";
import { useNewLink, useScreenAction } from "@/shell/screen-action";
import { Button, Chips, DesktopOnly, ExportButton, formatWhen, PageHeader, Pill, StatusPill, useIsPhone, useModal, Who } from "@mycity/ui";
import { filterQuery, NO_FILTERS, RecordFilters, type RecordFilterValue } from "./filters";
import { Lead360 } from "./Lead360";
import { DealForm } from "./forms/DealForm";
import { LeadForm } from "./forms/LeadForm";
import { healthPill, leadPill, useKept, useMay } from "./lib";
import { RecordPage } from "./record";

type View = "open" | "new" | "qualified" | "converted" | "lost";

/**
 * Partnerships · Leads (#52, docs/guides/partnerships.md §2, §10): the lead list across the page, its status
 * read from its deal; a pressed lead opens the Lead 360 as a page of its own (`?id=`, Back to Leads; F31 amended
 * 16/11/2026). A lost lead leaves the default list (the Lost chip shows it).
 */
const CHIPS: Array<[View, string]> = [
  ["open", "Open"],
  ["new", "New"],
  ["qualified", "Qualified"],
  ["converted", "Converted"],
  ["lost", "Lost"],
];

export function Leads({ id }: { id: string | null }) {
  if (id) {
    return (
      <RecordPage back="Back to Leads" to="/partnerships?tab=leads">
        <Lead360 key={id} id={id} />
      </RecordPage>
    );
  }
  return <LeadList />;
}

function LeadList() {
  const modal = useModal();
  const phone = useIsPhone();
  const { navigate } = useRouter();
  const mayCreate = useMay("create");
  const mayExport = useMay("export");
  const [view, setView] = useKept<View>("leads.view", "open");
  const [filter, setFilter] = useKept<RecordFilterValue>("leads.filter", NO_FILTERS);
  const s = useApi("GET /api/v1/partnerships/leads/summary");
  const filters = { ...filterQuery(filter), ...(view === "open" ? {} : { status: view }) };
  const list = usePaged("GET /api/v1/partnerships/leads", { filters, sort: "name" });
  // Where news waits (notifications.md §6): each chip carries its share; it opens where the news is.
  const news = useViewNews();
  useOpenWhereNews({ value: view, onChange: setView, values: CHIPS.map(([v]) => v), all: "open", skip: false });
  const openLead = (lid: string) => navigate(`/partnerships?tab=leads&id=${lid}`);
  const newDeal = (partnerId: string) => modal.open({ title: "New Deal", wide: true, body: (close) => <DealForm partnerId={partnerId} close={close} /> });
  const newLead = () => modal.open({ title: "New Lead", wide: true, body: (close) => <LeadForm close={close} onCreated={openLead} onNewDeal={(pid) => (close(), newDeal(pid))} /> });
  useScreenAction(mayCreate ? { label: "New Lead", onSelect: newLead } : null);
  useNewLink(mayCreate ? newLead : null);
  const top = Math.max(1, ...(s.data?.by_source ?? []).map((x) => x.leads));
  return (
    <>
      <PageHeader title="Leads" sub="Organisations being pursued, with their deal" actions={
          <>
            {mayExport && (
              <DesktopOnly>
                <ExportButton onExport={() => saveExport(api.call("POST /api/v1/partnerships/exports", { body: { source: "partnerships.leads", filters: { ...filters, ...(list.q ? { q: list.q } : {}) } } }))} />
              </DesktopOnly>
            )}
            {mayCreate && <Button variant="primary" icon="plus" onClick={newLead}>New Lead</Button>}
          </>
        } />
      {s.data && (
        <KpiTiles
          mobileCols={2}
          items={[
            { label: "New", value: String(s.data.new) },
            { label: "Qualified", value: String(s.data.qualified), tone: "warn" },
            ...(phone ? [] : [{ label: "Contacted", value: String(s.data.contacted) }, { label: "Converted This Month", value: String(s.data.converted_this_month), tone: "ok" as const }]),
          ]}
        />
      )}
      <Chips label="Leads" value={view} onChange={setView} options={withNews(news, CHIPS, { all: "open" })} className="mt-3" />
      <RecordFilters value={filter} onChange={setFilter} kind="lead" />
  <PagedTable<LeadRow>
        title="Leads"
        list={list}
        search="Search leads"
        rowKey={(l) => l.lead_id}
        noun="lead"
        onRowClick={(l) => openLead(l.lead_id)}
        empty={{ title: "No Leads Yet", text: "Capture one with New Lead." }}
        columns={[
          { key: "n", label: "Lead", render: (l) => <Who name={l.name} sub={l.category ?? undefined} /> },
          { key: "st", label: "Status", render: (l) => (l.on_hold ? <Pill tone="warn">On Hold</Pill> : <StatusPill status={leadPill(l.status)} />) },
          { key: "s", label: "Stage", render: (l) => l.stage_label ?? "None", desktop: true },
          { key: "h", label: "Health", render: (l) => <StatusPill status={healthPill(l.health, l.status === "lost" ? "lost" : null)} />, desktop: true },
          { key: "r", label: "Region", render: (l) => l.region ?? "None", desktop: true },
          { key: "o", label: "Owner", render: (l) => l.owner?.display_name ?? "No Owner", desktop: true },
          { key: "c", label: "Last Contact", render: (l) => (l.last_contact_at ? formatWhen(l.last_contact_at) : "Never"), desktop: true },
        ]}
      />
      {/* Leads by source sits under the list on a computer; a phone leaves it off (§10.2). */}
      {s.data && s.data.by_source.length > 0 && (
        <DesktopOnly className="mt-3">
          <BarsCard title="Leads by Source" rows={s.data.by_source.map((x) => ({ label: x.label, pct: Math.round((x.leads / top) * 100), value: String(x.leads) }))} />
        </DesktopOnly>
      )}
    </>
  );
}
