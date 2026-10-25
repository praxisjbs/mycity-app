import { useEffect, useState } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import "@/api/types/partnerships";
import type { Contract, Lead, PartnerRow, Proposal, ProposalDoc, Renewal } from "@/api/types/partnerships";
import type { PersonRef } from "@/api/types/common";
import { useRouter } from "@/lib/router";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { BarsCard, ChainCard, ExportAction, KvCard, PagedTable, TrailCard } from "@/features/shared/sections";
import type { ModuleScreenProps } from "@/shell/screens";
import { AddressField, AreaChart, BackButton, Button, Card, CardHeader, Chain, Chips, DataView, DateField, ErrorState, Field, formatDate, formatDateTime, formatMoney, formatMoneyShort, formatMonth, FormFooter, Grid, KeyValue, ListDetail, LoadingRows, Meter, Money, MoneyField, PageHeader, Paper, PaperFoot, PaperLogo, PaperTable, PaperTitle, Pill, ProfileHeader, rules, SelectField, StatStrip, StatusPill, PlacesField, TextAreaField, TextField, toast, todayIso, useContractForm, useModal, useSideBySide, Who, Wizard, type PlaceValue } from "@mycity/ui";
import { EmployeePicker } from "@/features/shared/pickers";
import { places } from "@/features/shared/places";

export default function Partnerships({ tab, id }: ModuleScreenProps) {
  if (id && (tab === "partners" || tab === "pipeline")) return <Partner360View id={id} back={tab} />;
  if (tab === "partners") return <Partners />;
  if (tab === "leads") return <Leads />;
  if (tab === "proposals") return <Proposals />;
  if (tab === "contracts-and-mous") return <Contracts />;
  if (tab === "analytics") return <Analytics />;
  return <Pipeline />;
}

const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : "Something went wrong");
const short = (p: PersonRef) => {
  const [a, b] = p.display_name.split(" ");
  return `${a} ${b?.[0] ?? ""}.`;
};
const INDUSTRIES = ["Banking", "Telecoms", "Government", "Healthcare", "Hospitality", "Entertainment", "Retail", "Fintech", "Aviation", "FMCG", "Other"];
const TYPES = ["Strategic", "Sponsorship", "Government", "Media", "Hospitality", "Community"];
const opts = (l: string[]): Array<[string, string]> => l.map((x) => [x, x]);

/* ───────────── Pipeline ───────────── */

function Pipeline() {
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

/* ───────────── Partners ───────────── */

function Partners() {
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

function PartnerForm({ close }: { close: () => void }) {
  const { navigate } = useRouter();
  const [owner, setOwner] = useState<PersonRef[]>([]);
  const [tried, setTried] = useState(false);
  const f = useContractForm(
    { name: "", legal_name: "", industry: "", type: "", value: "", hq: null as PlaceValue | null, website: "" },
    { name: (v) => (!v.trim() ? "Name the partner" : null), industry: (v) => (!v ? "Pick the industry" : null), type: (v) => (!v ? "Pick the type" : null), hq: (v) => (!v ? "Pick a location" : null) },
  );
  const save = useMutation("POST /api/v1/partnerships/partners");
  const submit = async () => {
    setTried(true);
    if (!f.check() || !owner.length) return;
    try {
      // Checked above: the headquarters is picked.
      const p = await save.run({ body: { ...f.values, hq: f.values.hq!, value: f.values.value || "0.00", owner_id: owner[0].employee_id } });
      invalidate("/api/v1/partnerships");
      close();
      toast(`${p.name} added at Prospect identified`);
      navigate(`/partnerships?tab=partners&id=${p.partner_id}`);
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <Wizard
      finish="Add Partner"
      busy={save.pending}
      onFinish={() => submit()}
      onCancel={close}
      steps={[
        {
          title: "Partner",
          check: () => f.check(["name", "industry", "type"]),
          body: (
            <>
              <Field label="Partner" {...f.field("name")}><TextField {...f.field("name")} placeholder="Zenith Bank" /></Field>
              <Field label="Legal Name" optional><TextField {...f.field("legal_name")} /></Field>
              <Field label="Industry" {...f.field("industry")}><SelectField placeholder="Pick one" options={opts(INDUSTRIES)} {...f.field("industry")} /></Field>
              <Field label="Partnership Type" {...f.field("type")}><SelectField placeholder="Pick one" options={opts(TYPES)} {...f.field("type")} /></Field>
            </>
          ),
        },
        {
          title: "Details",
          body: (
            <>
              <Field label="Expected Value" optional><MoneyField {...f.field("value")} /></Field>
              <Field label="Headquarters" {...f.status("hq")}><AddressField {...f.field("hq")} places={places} level="area" placeholder="Victoria Island" /></Field>
              <Field label="Website" optional><TextField {...f.field("website")} placeholder="example.com" /></Field>
              <Field label="Lead Owner" state={tried && !owner.length ? "bad" : undefined} message={tried && !owner.length ? "Pick the owner" : undefined}><EmployeePicker value={owner} onChange={setOwner} /></Field>
            </>
          ),
        },
      ]}
    />
  );
}

/* ───────────── Partner 360 ───────────── */

function Partner360View({ id, back }: { id: string; back: string }) {
  const { navigate } = useRouter();
  const modal = useModal();
  const p = useApi("GET /api/v1/partnerships/partners/:id", { params: { id } });
  const goBack = () => navigate(`/partnerships?tab=${back}`);
  if (p.error) return (<><BackButton label={`Back to ${back === "pipeline" ? "Pipeline" : "Partners"}`} onBack={goBack} /><ErrorState error={p.error} onRetry={p.reload} /></>);
  if (!p.data) return <LoadingRows count={8} />;
  const x = p.data;
  return (
    <>
      <BackButton label={`Back to ${back === "pipeline" ? "Pipeline" : "Partners"}`} onBack={goBack} />
      <ProfileHeader
        brand
        name={x.name}
        role={`${x.industry} · ${x.type} partnership · Owner ${x.owner.display_name}`}
        chips={<><StatusPill s={x.stage_status} /><Pill>{formatMoneyShort(x.value)} value</Pill>{x.since && <Pill>Since {formatDate(x.since)}</Pill>}<Pill tone={x.last_contact_days > 30 ? "err" : "neutral"}>Last contact {x.last_contact_days === 0 ? "today" : `${x.last_contact_days} days ago`}</Pill></>}
        actions={
          <>
            <Button onClick={() => modal.open({ title: `Log Interaction · ${x.name}`, body: (close) => <LogInteraction id={x.partner_id} close={close} /> })}>Log Interaction</Button>
            <Button onClick={() => navigate("/partnerships?tab=proposals&new=" + x.partner_id)}>New Proposal</Button>
            <Button variant="primary" onClick={() => modal.open({ title: "Move Stage", body: (close) => <MoveStage id={x.partner_id} current={x.stage} close={close} /> })}>Move Stage</Button>
          </>
        }
      />
      <StatStrip items={[{ label: "Partnership Value", value: <Money value={x.value} /> }, { label: "Signed Documents", value: x.stats.signed_documents }, { label: "Open Tasks", value: x.stats.open_tasks }, { label: "Interactions, 90d", value: x.stats.interactions_90d }, { label: "Renewal", value: x.stats.renewal ? formatDate(x.stats.renewal) : "None", desktop: true }]} />
      <Grid cols={2}>
        <KvCard title="The Organisation" items={[["Legal name", x.legal_name], ["Industry", x.industry], ["Partnership type", x.type], ["Headquarters", x.hq], ["Website", x.website || "None"], ["Lead owner", x.owner.display_name], ["Stage", <StatusPill key="s" s={x.stage_status} />]]} />
        <KvCard title="Primary Contacts" items={x.contacts} />
      </Grid>
      <Grid cols={2}>
        <Card>
          <CardHeader title="Stage History" />
          <Chain steps={x.chain.map((s) => ({ label: s.label, state: s.state ?? undefined }))} />
          <p className="mt-2.5 text-2xs text-subtle-foreground">{x.chain_note}</p>
          <div className="mt-3 border-t border-dashed border-border pt-3">
            <div className="mb-2 text-2xs font-strong text-subtle-foreground">Days at each stage</div>
            {x.days_at_stage.map((d) => (
              <div key={d.label} className="flex items-center gap-2.5 py-1">
                <span className="min-w-0 flex-1 text-xs">{d.label}</span>
                <span className="w-40 flex-none"><Meter pct={Math.min(100, d.days * 4)} label={d.current ? `${d.days} so far` : `${d.days} days`} /></span>
              </div>
            ))}
          </div>
        </Card>
        <TrailCard title="Interaction Log" items={x.interactions.map((i) => ({ ...i, when: formatDateTime(i.when) }))} />
      </Grid>
      <Grid cols={2}>
        <DataView
          title="Contracts and MOUs"
          rows={x.documents}
          rowKey={(d) => d.title}
          empty={{ title: "No Document Yet", text: "Proposals and MOUs appear here with their signature state." }}
          columns={[{ key: "t", label: "Document", render: (d) => d.title }, { key: "k", label: "Type", render: (d) => d.kind }, { key: "s", label: "Signed", render: (d) => (d.signed_on ? formatDate(d.signed_on) : "Not yet") }, { key: "st", label: "Status", render: (d) => <StatusPill s={d.status} /> }]}
        />
        <DataView
          title="Our Deliverables"
          rows={x.deliverables}
          rowKey={(d) => d.title}
          columns={[{ key: "t", label: "Deliverable", render: (d) => d.title }, { key: "o", label: "Owner", render: (d) => short(d.owner) }, { key: "d", label: "Due", render: (d) => formatDate(d.due) }, { key: "s", label: "Status", render: (d) => <StatusPill s={d.status} /> }]}
        />
      </Grid>
      <Grid cols={2}>
        <AreaChart title="Monthly In-App Downloads Attributed" values={x.downloads.values} labels={x.downloads.labels} caption="Attributed from the partner’s own listing and campaign links." />
        <BarsCard title="Value by Line" rows={x.lines.map((l) => ({ ...l, value: /^\d/.test(l.value) ? formatMoney(l.value.split(" ")[0]) : l.value }))} note="Signed value against the MOU schedule." />
      </Grid>
    </>
  );
}

function LogInteraction({ id, close }: { id: string; close: () => void }) {
  const f = useContractForm({ kind: "call", happened_on: todayIso(), summary: "" }, { happened_on: (v) => (!v ? "When did it happen" : null), summary: (v) => (v.trim().length < 10 ? "Say what was agreed" : null) });
  const save = useMutation("POST /api/v1/partnerships/partners/:id/interactions");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id }, body: { kind: f.values.kind as "call", happened_on: f.values.happened_on, summary: f.values.summary.trim() } });
      invalidate("/api/v1/partnerships");
      close();
      toast("Interaction logged. The inactivity clock restarts");
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Field label="What"><SelectField options={[["call", "Call"], ["meeting", "Meeting"], ["email", "Email"], ["visit", "Visit"]]} {...f.field("kind")} /></Field>
      <Field label="When" {...f.field("happened_on")}><DateField {...f.field("happened_on")} max={todayIso()} /></Field>
      <Field label="Summary" {...f.field("summary")}><TextAreaField {...f.field("summary")} placeholder="Agreed a pilot" /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Log</Button>
      </FormFooter>
    </>
  );
}

function MoveStage({ id, current, close }: { id: string; current: string; close: () => void }) {
  const stages = useApi("GET /api/v1/partnerships/stages");
  const f = useContractForm(
    { stage: current, reason: "" },
    { stage: (v) => (v === current ? "Pick another stage" : null), reason: (v, all) => (all.stage === "On hold" && !v.trim() ? "Give a reason" : null) },
  );
  const { stage, reason } = f.values;
  const move = useMutation("POST /api/v1/partnerships/partners/:id/stage");
  const go = async () => {
    if (!f.check()) return;
    try {
      await move.run({ params: { id }, body: { stage, ...(reason.trim() && { reason: reason.trim() }) } });
      invalidate("/api/v1/partnerships");
      close();
      toast(`Moved to ${stage}`);
    } catch (e) {
      if (e instanceof ApiError && e.fields) toast(Object.values(e.fields)[0][0]);
      else fail(e);
    }
  };
  return (
    <>
      <Field label="Stage" {...f.field("stage")}><SelectField {...f.field("stage")} options={opts(stages.data ?? [current])} /></Field>
      <Field label={stage === "On hold" ? "Why It Is on Hold" : "Note (Optional)"} {...f.field("reason")}><TextAreaField {...f.field("reason")} placeholder="Duplicate entry" /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={move.pending} onClick={go}>Move</Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Leads ───────────── */

function Leads() {
  const modal = useModal();
  const { navigate } = useRouter();
  const s = useApi("GET /api/v1/partnerships/leads/summary");
  const list = usePaged("GET /api/v1/partnerships/leads");
  const convert = useMutation("POST /api/v1/partnerships/leads/:id/convert");
  const open = (l: Lead) =>
    modal.open({
      title: l.title,
      body: (close) => (
        <>
          <KeyValue items={[["Source", l.source], ["Owner", l.owner.display_name], ["Added", formatDate(l.added_on)], ["Next action", l.next_action ?? "None"], ["Status", <StatusPill key="s" s={l.status} />]]} />
          {!["Converted", "Lost"].includes(l.status.text) && (
            <FormFooter>
              <Button className="mr-auto" onClick={() => modal.open({ title: "Close as Lost", body: (c2) => <LoseLead id={l.lead_id} close={c2} /> })}>Close as Lost</Button>
              <Button variant="primary" busy={convert.pending} onClick={async () => { try { const r = await convert.run({ params: { id: l.lead_id }, body: {} }); invalidate("/api/v1/partnerships"); close(); toast("Converted. The partner starts at Prospect identified"); navigate(`/partnerships?tab=partners&id=${r.partner_id}`); } catch (e) { fail(e); } }}>Convert to Partner</Button>
            </FormFooter>
          )}
        </>
      ),
    });
  return (
    <>
      <PageHeader title="Leads" sub="Entered manually after a business development conversation" actions={<Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Lead", body: (close) => <LeadForm close={close} /> })}>New Lead</Button>} />
      {s.data && <KpiTiles items={[{ label: "New", value: String(s.data.new) }, { label: "Contacted", value: String(s.data.contacted) }, { label: "Qualified", value: String(s.data.qualified) }, { label: "Converted This Month", value: String(s.data.converted_this_month), tone: "ok" }]} />}
      <PagedTable<Lead>
        title="Leads"
        list={list}
        search="Search leads"
        rowKey={(l) => l.lead_id}
        noun="lead"
        onRowClick={open}
        wide
        columns={[
          { key: "t", label: "Lead", render: (l) => <span className="font-semibold">{l.title}</span> },
          { key: "s", label: "Source", render: (l) => l.source, desktop: true },
          { key: "o", label: "Owner", render: (l) => l.owner.display_name, desktop: true },
          { key: "a", label: "Added", render: (l) => formatDate(l.added_on) },
          { key: "n", label: "Next Action", render: (l) => l.next_action ?? "None", desktop: true },
          { key: "st", label: "Status", render: (l) => <StatusPill s={l.status} /> },
        ]}
      />
      <Grid cols={2} className="mt-3">
        {s.data ? <BarsCard title="Leads by Source" rows={s.data.sources} /> : <Card><LoadingRows /></Card>}
        <KvCard
          title="Lead to Partner"
          items={[
            ["A lead", "A conversation that might become something"],
            ["Qualifying", "Is there a budget, a decision maker and a reason now"],
            ["Converting", "Becomes a partner record at prospect stage, keeping its history"],
            ["Losing", "Closed with a reason. It stays searchable"],
            ["Why not one object", "A lead has no deliverables and no documents. Forcing them together made both worse"],
          ]}
        />
      </Grid>
    </>
  );
}

function LeadForm({ close }: { close: () => void }) {
  const f = useContractForm({ title: "", source: "BD conversation", next_action: "" }, { title: (v) => (v.trim().length < 4 ? "Who, and what about" : null) });
  const save = useMutation("POST /api/v1/partnerships/leads");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: f.values });
      invalidate("/api/v1/partnerships/leads");
      close();
      toast("Lead added");
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Field label="Lead" {...f.field("title")}><TextField {...f.field("title")} placeholder="Zenith events sponsorship" /></Field>
      <Field label="Source"><SelectField options={opts(["BD conversation", "Referral", "Inbound email", "Event", "Website form"])} {...f.field("source")} /></Field>
      <Field label="Next Action"><TextField {...f.field("next_action")} placeholder="Send one pager" /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Add Lead</Button>
      </FormFooter>
    </>
  );
}

function LoseLead({ id, close }: { id: string; close: () => void }) {
  const f = useContractForm({ reason: "" }, { reason: rules.required("Give a reason") });
  const reason = f.values.reason;
  const lose = useMutation("POST /api/v1/partnerships/leads/:id/lose");
  return (
    <>
      <Field label="Why" {...f.field("reason")}><TextAreaField {...f.field("reason")} placeholder="Partner withdrew" /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={lose.pending} onClick={async () => { if (!f.check()) return; await lose.run({ params: { id }, body: { reason } }); invalidate("/api/v1/partnerships/leads"); close(); toast("Lead closed as lost"); }}>Close as Lost</Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Proposals ───────────── */

function ProposalPaper({ d }: { d: ProposalDoc }) {
  return (
    <Paper note="Six questions in, this came out. A person edits it before it goes anywhere.">
      <PaperLogo reference={d.reference} />
      <PaperTitle sub={d.prepared_for}>{d.title}</PaperTitle>
      {d.sections.map((s) => (
        <p key={s.heading}><b>{s.heading}</b> {s.text}</p>
      ))}
      <PaperTable head={["Line", "Value"]} rows={d.lines.map((l) => [l.label, formatMoney(l.amount)])} totals={[["Total", formatMoney(d.total)]]} />
      <PaperFoot><span>{d.footnote}</span></PaperFoot>
    </Paper>
  );
}

function Proposals() {
  const modal = useModal();
  const { location, navigate } = useRouter();
  const s = useApi("GET /api/v1/partnerships/proposals/summary");
  const list = usePaged("GET /api/v1/partnerships/proposals");
  const beside = useSideBySide();
  const [sel, setSel] = useState<Proposal | null>(null);
  // Beside the list the first viewed proposal shows unasked; elsewhere one opens when it is pressed (F31).
  const shown = sel ?? (beside ? (list.rows.find((p) => p.status.text === "Viewed") ?? list.rows[0] ?? null) : null);
  const doc = useApi("GET /api/v1/partnerships/proposals/:id/document", { params: { id: shown?.proposal_id ?? "" }, enabled: !!shown });
  const preset = location.params.get("new");
  const openNew = (partner = "") => modal.open({ title: "New Proposal", wide: true, body: (close) => <ProposalForm close={close} partner={partner} /> });
  /* The 360's "New Proposal" arrives as ?new=<partner_id>. */
  useEffect(() => {
    if (!preset) return;
    navigate("/partnerships?tab=proposals", { replace: true });
    modal.open({ title: "New Proposal", wide: true, body: (close) => <ProposalForm close={close} partner={preset} /> });
  }, [preset, navigate, modal]);
  return (
    <>
      <PageHeader title="Proposals" sub="Generated from a short questionnaire" actions={<Button variant="primary" icon="plus" onClick={() => openNew()}>New Proposal</Button>} />
      {s.data && <KpiTiles items={[{ label: "Sent This Year", value: String(s.data.sent_this_year) }, { label: "Accepted", value: String(s.data.accepted), tone: "ok" }, { label: "Viewed, No Reply", value: String(s.data.viewed_no_reply), tone: "warn" }, { label: "Acceptance Rate", value: s.data.acceptance_rate }]} />}
      <ListDetail
        cols="1/1.5"
        full
        open={sel !== null}
        onClose={() => setSel(null)}
        title="Proposal"
        list={
          <PagedTable<Proposal>
            title="Proposals"
            list={list}
            rowKey={(p) => p.proposal_id}
            noun="proposal"
            onRowClick={setSel}
            columns={[
              { key: "t", label: "Proposal", render: (p) => <span className={p.proposal_id === shown?.proposal_id ? "font-semibold" : undefined}>{p.title}</span> },
              { key: "p", label: "Partner", render: (p) => p.partner, desktop: true },
              { key: "v", label: "Value", align: "n", render: (p) => formatMoneyShort(p.value) },
              { key: "s", label: "Status", render: (p) => <StatusPill s={p.status} /> },
            ]}
          />
        }
        detail={doc.data ? <ProposalPaper d={doc.data} /> : <Card><LoadingRows count={6} /></Card>}
      />
    </>
  );
}

function ProposalForm({ close, partner }: { close: () => void; partner: string }) {
  const partners = usePaged("GET /api/v1/partnerships/partners");
  const f = useContractForm({ partner_id: partner, what: "", why_now: "", cities: [] as PlaceValue[], weeks: "12", value: "", terms: "Half on signature, half on the first activation" }, {
    partner_id: (v) => (!v ? "Pick the partner" : null),
    what: (v) => (v.trim().length < 20 ? "Describe the proposal" : null),
    why_now: (v) => (v.trim().length < 10 ? "Why now" : null),
    cities: (v) => (!v.length ? "Pick a city" : null),
    weeks: (v) => (!(Number(v) >= 1) ? "How many weeks" : null),
    value: (v) => (!(Number(v) > 0) ? "The value we ask" : null),
  });
  const save = useMutation("POST /api/v1/partnerships/proposals");
  const submit = async () => {
    if (!f.check()) return;
    try {
      const p = await save.run({ body: { ...f.values, weeks: Number(f.values.weeks) } });
      invalidate("/api/v1/partnerships/proposals");
      close();
      toast(`${p.number} drafted. Read and edit it first`);
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <Wizard
      finish="Draft Proposal"
      busy={save.pending}
      onFinish={() => submit()}
      onCancel={close}
      steps={[
        {
          title: "The Idea",
          check: () => f.check(["partner_id", "what", "why_now"]),
          body: (
            <>
              <Field label="Who It Is For" {...f.field("partner_id")}><SelectField placeholder="Pick the partner" options={partners.rows.map((p) => [p.partner_id, p.name])} {...f.field("partner_id")} /></Field>
              <Field label="What We Propose" {...f.field("what")}><TextAreaField {...f.field("what")} placeholder="Four-city health activation" /></Field>
              <Field label="Why Now" {...f.field("why_now")}><TextField {...f.field("why_now")} placeholder="Fits campaign window" /></Field>
            </>
          ),
        },
        {
          title: "Scope and Value",
          check: () => f.check(["cities", "weeks", "value"]),
          body: (
            <>
              <Field label="Cities" {...f.status("cities")}><PlacesField {...f.field("cities")} places={places} /></Field>
              <Field label="Weeks" {...f.field("weeks")}><TextField {...f.field("weeks")} inputMode="numeric" onChange={(v) => f.set("weeks", v.replace(/\D/g, "").slice(0, 2))} /></Field>
              <Field label="Value We Ask" {...f.field("value")}><MoneyField {...f.field("value")} /></Field>
              <Field label="Payment Terms"><TextField {...f.field("terms")} /></Field>
            </>
          ),
        },
      ]}
    />
  );
}

/* ───────────── Contracts & MOUs ───────────── */

function Contracts() {
  const modal = useModal();
  const s = useApi("GET /api/v1/partnerships/contracts/summary");
  const list = usePaged("GET /api/v1/partnerships/contracts");
  const ren = usePaged("GET /api/v1/partnerships/contracts/renewals");
  return (
    <>
      <PageHeader title="Contracts & MOUs" sub="Draft to renewal" actions={<Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Contract", body: (close) => <ContractForm close={close} /> })}>New Contract</Button>} />
      {s.data && (
        <>
          <KpiTiles items={[{ label: "Active", value: String(s.data.active) }, { label: "In Review", value: String(s.data.in_review), tone: s.data.in_review ? "warn" : undefined }, { label: "Draft", value: String(s.data.draft) }, { label: "Renewals, 180 Days", value: String(s.data.renewals_180), tone: s.data.renewals_180 ? "warn" : undefined }]} />
          <ChainCard steps={s.data.chain} />
        </>
      )}
      <PagedTable<Contract>
        title="Contracts and MOUs"
        list={list}
        search="Search documents or partners"
        rowKey={(c) => c.contract_id}
        noun="document"
        wide
        columns={[
          { key: "t", label: "Document", render: (c) => <span className="font-semibold">{c.title}</span> },
          { key: "p", label: "Partner", render: (c) => c.partner },
          { key: "k", label: "Type", render: (c) => c.kind, desktop: true },
          { key: "s", label: "Start", render: (c) => (c.start_on ? formatDate(c.start_on) : "Not yet"), desktop: true },
          { key: "r", label: "Renewal", render: (c) => (c.renewal_on ? formatDate(c.renewal_on) : "Not set") },
          { key: "v", label: "Value", align: "n", render: (c) => formatMoneyShort(c.value) },
          { key: "st", label: "Status", render: (c) => <StatusPill s={c.status} /> },
        ]}
      />
      <Grid cols={2} className="mt-3">
        <PagedTable<Renewal>
          title="Renewal Calendar"
          right={<span className="text-2xs text-subtle-foreground">Alert at 90 days</span>}
          list={ren}
          rowKey={(r) => r.contract_id}
          noun="renewal"
          columns={[
            { key: "t", label: "Renewal", render: (r) => r.title },
            { key: "p", label: "Partner", render: (r) => r.partner, desktop: true },
            { key: "d", label: "Due", render: (r) => formatDate(r.due) },
            { key: "n", label: "Days", align: "n", render: (r) => <span className={r.days <= 90 ? "font-semibold text-warning" : undefined}>{r.days}</span> },
            { key: "o", label: "Owner", render: (r) => short(r.owner), desktop: true },
          ]}
        />
      </Grid>
    </>
  );
}

function ContractForm({ close }: { close: () => void }) {
  const partners = usePaged("GET /api/v1/partnerships/partners");
  const f = useContractForm({ partner_id: "", title: "", kind: "Contract", value: "" }, { partner_id: (v) => (!v ? "Pick the partner" : null), title: (v) => (!v.trim() ? "Name the document" : null), value: (v) => (!(Number(v) > 0) ? "Enter the value" : null) });
  const save = useMutation("POST /api/v1/partnerships/contracts");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: { ...f.values, kind: f.values.kind as Contract["kind"] } });
      invalidate("/api/v1/partnerships/contracts");
      close();
      toast("Draft created. It goes to review next");
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Field label="Partner" {...f.field("partner_id")}><SelectField placeholder="Pick the partner" options={partners.rows.map((p) => [p.partner_id, p.name])} {...f.field("partner_id")} /></Field>
      <Field label="Document" {...f.field("title")}><TextField {...f.field("title")} placeholder="e.g. Activation agreement" /></Field>
      <Field label="Type"><SelectField options={[["Contract", "Contract"], ["MOU", "MOU"]]} {...f.field("kind")} /></Field>
      <Field label="Value" {...f.field("value")}><MoneyField {...f.field("value")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Create Draft</Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Analytics ───────────── */

function Analytics() {
  const a = useApi("GET /api/v1/partnerships/analytics");
  const d = a.data;
  if (!d) return (<><PageHeader title="Analytics" sub="Monthly partnership performance by lead owner" /><Card><LoadingRows count={6} /></Card></>);
  return (
    <>
      <PageHeader title="Analytics" sub="Monthly partnership performance by lead owner" />
      <KpiTiles items={[{ label: "Prospects This Month", value: String(d.prospects) }, { label: "Meetings Held", value: String(d.meetings) }, { label: "Proposals Sent", value: String(d.proposals) }, { label: "Signed", value: String(d.signed), tone: "ok" }]} />
      <DataView
        title={formatMonth(d.period)}
        rows={d.by_owner}
        rowKey={(r) => r.owner.employee_id}
        columns={[
          { key: "o", label: "Lead Owner", render: (r) => <Who name={r.owner.display_name} sub={r.owner.department ?? undefined} /> },
          { key: "p", label: "Prospects", align: "n", render: (r) => r.prospects },
          { key: "m", label: "Meetings", align: "n", render: (r) => r.meetings, desktop: true },
          { key: "pr", label: "Proposals", align: "n", render: (r) => r.proposals },
          { key: "s", label: "Signed", align: "n", render: (r) => r.signed },
          { key: "a", label: "Active", align: "n", render: (r) => r.active, desktop: true },
          { key: "d", label: "Downloads", align: "n", render: (r) => r.downloads.toLocaleString("en-NG"), desktop: true },
        ]}
      />
      <Grid cols={2} className="mt-3">
        <AreaChart title="Signed Partnerships per Month" values={d.signed_per_month.values} labels={d.signed_per_month.labels} />
        <BarsCard title="Downloads Attributed by Partner" rows={d.downloads} note="Only a live partnership attributes anything." />
      </Grid>
      <Grid cols={2}>
        <DataView
          title="Six Months"
          rows={d.months}
          rowKey={(r) => r.month}
          columns={[
            { key: "m", label: "Month", render: (r) => r.month },
            { key: "p", label: "Prospects", align: "n", render: (r) => r.prospects },
            { key: "pr", label: "Proposals", align: "n", render: (r) => r.proposals },
            { key: "s", label: "Signed", align: "n", render: (r) => r.signed },
            { key: "c", label: "Conversion", render: (r) => <span className="block w-32"><Meter pct={r.conversion_pct} label={`${r.conversion_pct}%`} /></span> },
          ]}
        />
      </Grid>
    </>
  );
}
