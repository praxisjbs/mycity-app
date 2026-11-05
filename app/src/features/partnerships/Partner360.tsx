import { useApi } from "@/api/hooks";
import "@/api/types/partnerships";
import { useRouter } from "@/lib/router";
import { BarsCard, KvCard, TrailCard } from "@/features/shared/sections";
import { AreaChart, BackButton, Button, Card, CardHeader, Chain, DataView, ErrorState, formatDate, formatDateTime, formatMoney, formatMoneyShort, Grid, LoadingRows, Meter, Money, Pill, ProfileHeader, StatStrip, StatusPill, useModal } from "@mycity/ui";
import { LogInteraction } from "./forms/LogInteraction";
import { MoveStage } from "./forms/MoveStage";
import { short } from "./lib";

/** The Partner 360 (Partners, `?id=`), on the mock until M7 PR 3 (docs/guides/partnerships.md §6.2, §10). */
export function Partner360({ id, back }: { id: string; back: string }) {
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
