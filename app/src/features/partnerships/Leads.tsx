import type { LeadRow } from "@mycity/contract/contract.gen.ts";
import { useState } from "react";
import { useApi, usePaged } from "@/api/hooks";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { BarsCard, PagedTable } from "@/features/shared/sections";
import { useRouter } from "@/lib/router";
import { useNewLink, useScreenAction } from "@/shell/screen-action";
import { Button, Chips, DesktopOnly, formatWhen, ListDetail, PageHeader, Pill, StatusPill, useIsPhone, useModal, useSideBySide, Who } from "@mycity/ui";
import { Lead360 } from "./Lead360";
import { DealForm } from "./forms/DealForm";
import { LeadForm } from "./forms/LeadForm";
import { healthPill, leadPill, useMay } from "./lib";

type View = "open" | "new" | "qualified" | "converted" | "lost";

/**
 * Partnerships · Leads (#52, docs/guides/partnerships.md §2, §10): the lead list, its status read from
 * its deal, beside the Lead 360 (`?id=`); a lost lead leaves the default list (the Lost chip shows it).
 */
export function Leads({ id }: { id: string | null }) {
  const modal = useModal();
  const phone = useIsPhone();
  const beside = useSideBySide();
  const { navigate } = useRouter();
  const mayCreate = useMay("create");
  const [view, setView] = useState<View>("open");
  const s = useApi("GET /api/v1/partnerships/leads/summary");
  const list = usePaged("GET /api/v1/partnerships/leads", { filters: view === "open" ? {} : { status: view }, sort: "name" });
  const openLead = (lid: string) => navigate(`/partnerships?tab=leads&id=${lid}`);
  const newDeal = (partnerId: string) => modal.open({ title: "New Deal", wide: true, body: (close) => <DealForm partnerId={partnerId} close={close} /> });
  const newLead = () => modal.open({ title: "New Lead", wide: true, body: (close) => <LeadForm close={close} onCreated={openLead} onNewDeal={(pid) => (close(), newDeal(pid))} /> });
  useScreenAction(mayCreate ? { label: "New Lead", onSelect: newLead } : null);
  useNewLink(mayCreate ? newLead : null);
  const shown = id ?? (beside ? (list.rows[0]?.lead_id ?? null) : null);
  const top = Math.max(1, ...(s.data?.by_source ?? []).map((x) => x.leads));
  return (
    <>
      <PageHeader title="Leads" sub="Organisations being pursued, with their deal" actions={mayCreate ? <Button variant="primary" icon="plus" onClick={newLead}>New Lead</Button> : undefined} />
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
      <Chips label="Leads" value={view} onChange={setView} options={[["open", "Open"], ["new", "New"], ["qualified", "Qualified"], ["converted", "Converted"], ["lost", "Lost"]]} className="mt-3" />
      <ListDetail
        open={Boolean(id)}
        onClose={() => navigate("/partnerships?tab=leads")}
        title="Lead"
        cols="1/1.5"
        full
        list={
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
              { key: "h", label: "Health", render: (l) => <StatusPill status={healthPill(l.health)} />, desktop: true },
              { key: "c", label: "Last Contact", render: (l) => (l.last_contact_at ? formatWhen(l.last_contact_at) : "Never"), desktop: true },
            ]}
          />
        }
        detail={shown && <Lead360 key={shown} id={shown} />}
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
