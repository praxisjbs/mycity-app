import type { PartnerRow } from "@mycity/contract/contract.gen.ts";
import { useState } from "react";
import { useApi, usePaged } from "@/api/hooks";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { PagedTable } from "@/features/shared/sections";
import { useRouter } from "@/lib/router";
import { useNewLink, useScreenAction } from "@/shell/screen-action";
import { Button, Chips, formatMoneyShort, formatWhen, ListDetail, PageHeader, StatusPill, useIsPhone, useModal, useSideBySide, Who } from "@mycity/ui";
import { filterQuery, NO_FILTERS, RecordFilters, type RecordFilterValue } from "./filters";
import { Partner360 } from "./Partner360";
import { PartnerForm } from "./forms/PartnerForm";
import { healthPill, partnerPill, useMay } from "./lib";

type View = "all" | "active" | "dormant" | "quiet" | "closed";

/**
 * Partnerships · Partners (#51, docs/guides/partnerships.md §2, §10): the partner list beside the
 * Partner 360 (`?id=`), side by side on a wide desktop and in a full sheet on a phone (F31).
 */
export function Partners({ id }: { id: string | null }) {
  const modal = useModal();
  const phone = useIsPhone();
  const beside = useSideBySide();
  const { navigate } = useRouter();
  const mayCreate = useMay("create");
  const [view, setView] = useState<View>("all");
  const [filter, setFilter] = useState<RecordFilterValue>(NO_FILTERS);
  const s = useApi("GET /api/v1/partnerships/partners/summary");
  const filters = { ...filterQuery(filter), ...(view === "quiet" ? { quiet: "true" as const } : view === "all" ? {} : { status: view }) };
  const list = usePaged("GET /api/v1/partnerships/partners", { filters, sort: "name" });
  const openPartner = (pid: string) => navigate(`/partnerships?tab=partners&id=${pid}`);
  const newPartner = () => modal.open({ title: "New Partner", wide: true, body: (close) => <PartnerForm close={close} onCreated={openPartner} /> });
  useScreenAction(mayCreate ? { label: "New Partner", onSelect: newPartner } : null);
  useNewLink(mayCreate ? newPartner : null);
  const shown = id ?? (beside ? (list.rows[0]?.partner_id ?? null) : null);
  return (
    <>
      <PageHeader title="Partners" sub="Every signed partner and its 360" actions={mayCreate ? <Button variant="primary" icon="plus" onClick={newPartner}>New Partner</Button> : undefined} />
      {s.data && (
        <KpiTiles
          mobileCols={2}
          items={[
            { label: "Active", value: String(s.data.active), tone: "ok" },
            { label: "Quiet", value: String(s.data.quiet), tone: s.data.quiet ? "err" : undefined, help: `Active partners with no contact in ${s.data.quiet_days} days.` },
            ...(phone ? [] : [{ label: "Live Deals", value: String(s.data.live_deals) }, { label: "Signed Value", value: formatMoneyShort(s.data.signed_value) }]),
          ]}
        />
      )}
      <Chips label="Partners" value={view} onChange={setView} options={[["all", "All"], ["active", "Active"], ["dormant", "Dormant"], ["quiet", "Quiet"], ["closed", "Closed"]]} className="mt-3" />
      <RecordFilters value={filter} onChange={setFilter} kind="partner" />
      <ListDetail
        open={Boolean(id)}
        onClose={() => navigate("/partnerships?tab=partners")}
        title="Partner"
        cols="1/1.5"
        full
        list={
          <PagedTable<PartnerRow>
            title="Partners"
            list={list}
            search="Search partners"
            rowKey={(p) => p.partner_id}
            noun="partner"
            onRowClick={(p) => openPartner(p.partner_id)}
            empty={{ title: "No Partners Yet", text: "Signed leads become partners here." }}
            columns={[
              { key: "n", label: "Partner", render: (p) => <Who name={p.name} sub={p.category ?? undefined} /> },
              { key: "r", label: "Region", render: (p) => p.region ?? "None", desktop: true },
              { key: "s", label: "Stage", render: (p) => p.stage_label ?? <StatusPill status={partnerPill(p.status)} /> },
              { key: "h", label: "Health", render: (p) => <StatusPill status={healthPill(p.health)} />, desktop: true },
              { key: "o", label: "Owner", render: (p) => p.owner?.display_name ?? "No Owner", desktop: true },
              { key: "c", label: "Last Contact", render: (p) => (p.last_contact_at ? formatWhen(p.last_contact_at) : "Never") },
            ]}
          />
        }
        detail={shown && <Partner360 key={shown} id={shown} />}
      />
    </>
  );
}
