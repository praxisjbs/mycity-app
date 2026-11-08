import type { DealRow } from "@mycity/contract/contract.gen.ts";
import { useState } from "react";
import { useApi } from "@/api/hooks";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { useRouter } from "@/lib/router";
import { useTrailTitle } from "@/lib/trail";
import { Button, DataView, EmptyState, formatDate, formatMoney, formatMoneyShort, HelpTerm, Menu, Pill, ProfileHeader, StatusPill, Tabs, useModal } from "@mycity/ui";
import { ClosePartner } from "./forms/ClosePartner";
import { ContactForm } from "./forms/ContactForm";
import { DealForm } from "./forms/DealForm";
import { LogInteraction } from "./forms/LogInteraction";
import { EditPartner } from "./forms/RecordForm";
import { UploadDocument } from "./forms/UploadDocument";
import { ReturnsTab } from "./Returns";
import { daysWord, dealPill, healthPill, partnerPill, useHoldsMoney, useMay } from "./lib";
import { ActivityTab, ContactsTab, DealPanel, DetailsTab, DocumentsTab, InteractionsCard, NextStage, RecordState, SINCE_CONTACT_HELP, useDeal, WorkTab } from "./record";

const TABS = ["overview", "deals", "documents", "returns", "work", "activity", "contacts", "details"] as const;
type Tab = (typeof TABS)[number];
const LABEL: Record<Tab, string> = { overview: "Overview", deals: "Deals", documents: "Documents", returns: "Returns", work: "Work", activity: "Activity", contacts: "Contacts", details: "Details" };

/** One open or live deal on the Overview, whole. */
function OverviewDeal({ id, readOnly, money, categoryId }: { id: string; readOnly: boolean; money: boolean; categoryId: string | null }) {
  const d = useDeal(id);
  return d.data ? <DealPanel deal={d.data} readOnly={readOnly} money={money} categoryId={categoryId} /> : null;
}

/**
 * The Partner 360 (docs/guides/partnerships.md §6.2, §10.1): header, four KPI cards and the tabs
 * Overview, Deals, Documents, Returns (with `partnerships.money`), Work, Activity, Contacts, Details.
 * Zero-data safe: a partner made a minute ago reads with zeros and empty tabs.
 */
export function Partner360({ id }: { id: string }) {
  const modal = useModal();
  const { navigate } = useRouter();
  const money = useHoldsMoney();
  const mayEdit = useMay("edit");
  const mayCreate = useMay("create");
  const [tab, setTab] = useState<Tab>("overview");
  const p = useApi("GET /api/v1/partnerships/partners/:id", { params: { id } });
  useTrailTitle(p.data?.partner.name);
  if (!p.data) return <RecordState loading={p.loading} error={p.error} onRetry={p.reload} />;
  const x = p.data;
  const partner = x.partner;
  const record = { type: "partner" as const, id: partner.partner_id };
  const closed = partner.status === "closed";
  const readOnly = closed || !mayEdit;
  const unfinished = x.deals.filter((d) => d.status === "open" || d.status === "live");
  const primary = x.contacts.find((c) => c.primary_contact);
  const tabs = TABS.filter((t) => t !== "returns" || money);
  const open = (title: string, body: (close: () => void) => JSX.Element, wide = false) => modal.open({ title, wide, body });
  const menu = [
    { label: "Log Interaction", icon: "plus" as const, onSelect: () => open("Log Interaction", (close) => <LogInteraction record={record} dealId={unfinished[0]?.deal_id} close={close} />) },
    { label: "Upload Document", icon: "clip" as const, onSelect: () => open("Upload Document", (close) => <UploadDocument record={record} close={close} />) },
    { label: "Add Contact", icon: "plus" as const, onSelect: () => open("Add Contact", (close) => <ContactForm record={record} close={close} />) },
    { label: "New Proposal", icon: "forward" as const, onSelect: () => navigate(`/partnerships?tab=proposals&new=${partner.partner_id}&record=partner`) },
    { label: "Edit Partner", icon: "doc" as const, onSelect: () => open("Edit Partner", (close) => <EditPartner partner={partner} close={close} />, true) },
    { label: "Close Partner", danger: true, onSelect: () => open("Close Partner", (close) => <ClosePartner id={partner.partner_id} close={close} />) },
  ];
  return (
    <>
      <ProfileHeader
        brand
        level={2}
        name={partner.name}
        role={[partner.category, partner.region, partner.owner?.display_name].filter(Boolean).join(" · ")}
        chips={
          <>
            {partner.status === "dormant" ? (
              <HelpTerm help="No live deal now. A newly signed deal makes it Active.">
                <StatusPill status={partnerPill(partner.status)} />
              </HelpTerm>
            ) : (
              <StatusPill status={partnerPill(partner.status)} />
            )}
            {partner.signed_outside && <Pill>Signed Before the Hub</Pill>}
            {primary && <Pill>{`${primary.first_name} ${primary.last_name}`}</Pill>}
          </>
        }
        actions={
          readOnly ? undefined : (
            <>
              <Menu label="Partner Actions" trigger={<Button icon="dots">More</Button>} items={menu} />
              {mayCreate && <Button variant="primary" icon="plus" onClick={() => open("New Deal", (close) => <DealForm partnerId={partner.partner_id} categoryId={partner.partner_category_id} close={close} />, true)}>New Deal</Button>}
            </>
          )
        }
      />
      <KpiTiles
        mobileCols={2}
        items={[
          { label: "Signed Value", value: formatMoneyShort(x.kpis.signed_value) },
          x.kpis.returns_this_year !== undefined ? { label: "Returns This Year", value: formatMoneyShort(x.kpis.returns_this_year) } : { label: "Downloads This Year", value: x.kpis.downloads_this_year.toLocaleString("en-NG") },
          { label: "Active Deals", value: String(x.kpis.active_deals) },
          { label: "Days Since Last Contact", value: daysWord(x.kpis.days_since_contact), help: SINCE_CONTACT_HELP, tone: (x.kpis.days_since_contact ?? 0) >= 30 ? "err" : undefined },
        ]}
      />
      <Tabs label={partner.name} items={tabs.map((t) => ({ value: t, label: LABEL[t] }))} value={tab} onValueChange={(v) => setTab(v as Tab)} className="mt-3" />
      <div className="mt-3 grid gap-3">
        {tab === "overview" && (
          <>
            {unfinished.length ? unfinished.map((d) => <OverviewDeal key={d.deal_id} id={d.deal_id} readOnly={readOnly} money={money} categoryId={partner.partner_category_id} />) : <EmptyState title="No Open Deals" text="Open a deal for the next edition." />}
            <InteractionsCard items={x.overview.interactions} />
            {x.deliverables.length > 0 && (
              <DataView title="Our Deliverables" rows={x.deliverables} rowKey={(d) => d.deal_deliverable_id} columns={[{ key: "t", label: "Deliverable", render: (d) => d.title }, { key: "d", label: "Due", render: (d) => (d.due_on ? formatDate(d.due_on) : "None") }, { key: "s", label: "Status", render: (d) => d.status ?? "None" }]} />
            )}
          </>
        )}
        {tab === "deals" && (
          <DataView<DealRow>
            title="Deals"
            rows={x.deals}
            rowKey={(d) => d.deal_id}
            empty={{ title: "No Deals Yet", text: "Open one with New Deal." }}
            columns={[
              { key: "t", label: "Deal", render: (d) => d.title },
              { key: "s", label: "Stage", render: (d) => d.stage_label },
              { key: "h", label: "Health", render: (d) => <StatusPill status={healthPill(d.health)} />, desktop: true },
              { key: "st", label: "Status", render: (d) => <StatusPill status={dealPill(d.status)} /> },
              { key: "v", label: "Projected Value", align: "n", render: (d) => (d.estimated_value ? formatMoney(d.estimated_value) : "None"), desktop: true },
            ]}
          />
        )}
        {tab === "documents" && <DocumentsTab record={record} readOnly={readOnly} signedOutside={partner.signed_outside} />}
        {tab === "returns" && <ReturnsTab deals={x.deals} readOnly={readOnly} />}
        {tab === "work" && <WorkTab />}
        {tab === "activity" && <ActivityTab record={record} history={x.history} />}
        {tab === "contacts" && <ContactsTab record={record} contacts={x.contacts} readOnly={readOnly} />}
        {tab === "details" && (
          <DetailsTab
            fields={x.custom_fields}
            custom={partner.custom}
            items={[
              ["Number", partner.number],
              ["Legal Name", partner.legal_name ?? "None"],
              ["Category", partner.category ?? "None"],
              ["Industry", partner.industry ?? "None"],
              ["Region", partner.region ?? "None"],
              ["Headquarters", partner.headquarters?.formatted ?? "None"],
              ["Website", partner.website ?? "None"],
              ["Partner Since", partner.since ? formatDate(partner.since) : "None"],
              ...(partner.close_reason ? ([["Closed", partner.close_reason]] as Array<[string, string]>) : []),
            ]}
          />
        )}
      </div>
      {tab === "overview" && unfinished.length === 1 && <NextFor id={unfinished[0].deal_id} readOnly={readOnly} />}
    </>
  );
}

/** The phone's Next Stage for the partner's one open deal. */
function NextFor({ id, readOnly }: { id: string; readOnly: boolean }) {
  const d = useDeal(id);
  return <NextStage deal={d.data ?? null} readOnly={readOnly} />;
}
