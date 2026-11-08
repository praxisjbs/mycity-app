import { useState } from "react";
import { useApi } from "@/api/hooks";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { useRouter } from "@/lib/router";
import { useTrailTitle } from "@/lib/trail";
import { Banner, Button, EmptyState, formatDate, formatMoneyShort, HelpTerm, Menu, Pill, ProfileHeader, StatusPill, Tabs, useModal } from "@mycity/ui";
import { ContactForm } from "./forms/ContactForm";
import { GenerateAgreement } from "./forms/AgreementForms";
import { ConvertLead } from "./forms/ConvertLead";
import { LogInteraction } from "./forms/LogInteraction";
import { LoseLead } from "./forms/LoseLead";
import { EditLead } from "./forms/RecordForm";
import { UploadDocument } from "./forms/UploadDocument";
import { daysWord, HEALTH, leadPill, useHoldsMoney, useMay } from "./lib";
import { ActivityTab, ContactsTab, DealPanel, DetailsTab, DocumentsTab, InteractionsCard, NextStage, RecordState, SINCE_CONTACT_HELP } from "./record";
import { NextEvents, WorkTab } from "./WorkTab";

const TABS = ["overview", "deal", "documents", "work", "activity", "contacts", "details"] as const;
type Tab = (typeof TABS)[number];
const LABEL: Record<Tab, string> = { overview: "Overview", deal: "Deal", documents: "Documents", work: "Work", activity: "Activity", contacts: "Contacts", details: "Details" };

/**
 * The Lead 360 (docs/guides/partnerships.md §6.2, §6.4, §10.1): header with the status read from its
 * deal's stage, four KPI cards, the stage switcher, and the tabs Overview, Deal, Documents, Work,
 * Activity, Contacts, Details. A converted lead is read only and links to its partner.
 */
export function Lead360({ id }: { id: string }) {
  const modal = useModal();
  const { navigate } = useRouter();
  const money = useHoldsMoney();
  const mayEdit = useMay("edit");
  const [tab, setTab] = useState<Tab>("overview");
  const l = useApi("GET /api/v1/partnerships/leads/:id", { params: { id } });
  useTrailTitle(l.data?.lead.name);
  if (!l.data) return <RecordState loading={l.loading} error={l.error} onRetry={l.reload} />;
  const x = l.data;
  const lead = x.lead;
  const record = { type: "lead" as const, id: lead.lead_id };
  const done = lead.status === "converted" || lead.status === "lost";
  const readOnly = lead.status === "converted" || !mayEdit;
  const open = (title: string, body: (close: () => void) => JSX.Element, wide = false) => modal.open({ title, wide, body });
  const menu = [
    { label: "Log Interaction", icon: "plus" as const, onSelect: () => open("Log Interaction", (close) => <LogInteraction record={record} dealId={x.deal?.deal_id} close={close} />) },
    { label: "Upload Document", icon: "clip" as const, onSelect: () => open("Upload Document", (close) => <UploadDocument record={record} close={close} />) },
    { label: "Add Contact", icon: "plus" as const, onSelect: () => open("Add Contact", (close) => <ContactForm record={record} close={close} />) },
    { label: "New Proposal", icon: "forward" as const, onSelect: () => navigate(`/partnerships?tab=proposals&new=${lead.lead_id}`) },
    ...(x.deal && x.deal.status === "open"
      ? [{ label: "Generate Agreement", icon: "doc" as const, onSelect: () => open("Generate Agreement", (close) => <GenerateAgreement dealId={x.deal!.deal_id} close={close} onCreated={(aid) => navigate(`/partnerships?tab=contracts-and-mous&id=${aid}`)} />) }]
      : []),
    { label: "Edit Lead", icon: "doc" as const, onSelect: () => open("Edit Lead", (close) => <EditLead lead={lead} close={close} />, true) },
    ...(done ? [] : [{ label: "Close as Lost", danger: true, onSelect: () => open("Close as Lost", (close) => <LoseLead id={lead.lead_id} close={close} />) }]),
  ];
  return (
    <>
      {lead.converted_partner_id && (
        <Banner tone="info" className="mb-3" action={<Button size="sm" onClick={() => navigate(`/partnerships?tab=partners&id=${lead.converted_partner_id}`)}>Open Partner</Button>}>
          Now a partner.
        </Banner>
      )}
      <ProfileHeader
        brand
        level={2}
        name={lead.name}
        role={[lead.category, lead.region, lead.owner?.display_name].filter(Boolean).join(" · ")}
        chips={
          <>
            <HelpTerm help="Read from its deal's stage.">
              <StatusPill status={leadPill(lead.status)} />
            </HelpTerm>
            {lead.on_hold && <Pill tone="warn">On Hold</Pill>}
            {x.contacts[0] && <Pill>{`${x.contacts[0].first_name} ${x.contacts[0].last_name}`}</Pill>}
          </>
        }
        actions={
          readOnly ? undefined : (
            <>
              <Menu label="Lead Actions" trigger={<Button icon="dots">More</Button>} items={menu} />
              {!done && <Button variant="primary" onClick={() => open("Convert to Partner", (close) => <ConvertLead id={lead.lead_id} close={close} onConverted={(pid) => navigate(`/partnerships?tab=partners&id=${pid}`)} />)}>Convert to Partner</Button>}
            </>
          )
        }
      />
      <KpiTiles
        mobileCols={2}
        items={[
          { label: "Projected Value", value: formatMoneyShort(x.kpis.projected_value) },
          { label: "Days at Stage", value: String(x.kpis.days_at_stage) },
          { label: "Health", value: x.kpis.health ? HEALTH[x.kpis.health].label : "None", tone: x.kpis.health === "stalled" ? "err" : x.kpis.health === "follow_up_required" ? "warn" : undefined },
          { label: "Days Since Last Contact", value: daysWord(x.kpis.days_since_contact), help: SINCE_CONTACT_HELP },
        ]}
      />
      <Tabs label={lead.name} items={TABS.map((t) => ({ value: t, label: LABEL[t] }))} value={tab} onValueChange={(v) => setTab(v as Tab)} className="mt-3" />
      <div className="mt-3 grid gap-3">
        {tab === "overview" && (
          <>
            {x.deal ? <DealPanel deal={x.deal} readOnly={readOnly} money={money} categoryId={lead.partner_category_id} /> : <EmptyState title="No Deal Yet" text="A lead is captured with its deal." />}
            <NextEvents events={x.overview.events} />
            <InteractionsCard items={x.overview.interactions} />
          </>
        )}
        {tab === "deal" && (x.deal ? <DealPanel deal={x.deal} readOnly={readOnly} money={money} categoryId={lead.partner_category_id} /> : <EmptyState title="No Deal Yet" />)}
        {tab === "documents" && <DocumentsTab record={record} readOnly={readOnly} />}
        {tab === "work" && <WorkTab record={record} dealId={x.deal && (x.deal.status === "open" || x.deal.status === "live") ? x.deal.deal_id : null} readOnly={readOnly || done} />}
        {tab === "activity" && <ActivityTab record={record} history={x.deal?.history} />}
        {tab === "contacts" && <ContactsTab record={record} contacts={x.contacts} readOnly={readOnly} />}
        {tab === "details" && (
          <DetailsTab
            fields={x.custom_fields}
            custom={lead.custom}
            items={[
              ["Number", lead.number],
              ["Category", lead.category ?? "None"],
              ["Industry", lead.industry ?? "None"],
              ["Region", lead.region ?? "None"],
              ["Website", lead.website ?? "None"],
              ["Source", lead.source_label ?? "None"],
              ["Identified", lead.identified_on ? formatDate(lead.identified_on) : "None"],
              ...(lead.lost_reason ? ([["Why Lost", lead.lost_reason]] as Array<[string, string]>) : []),
            ]}
          />
        )}
      </div>
      {tab === "overview" && <NextStage deal={x.deal} readOnly={readOnly || done} />}
    </>
  );
}
