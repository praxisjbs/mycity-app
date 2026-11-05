import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import "@/api/types/partnerships";
import type { Lead } from "@/api/types/partnerships";
import { useRouter } from "@/lib/router";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { BarsCard, KvCard, PagedTable } from "@/features/shared/sections";
import { Button, Card, formatDate, FormFooter, Grid, KeyValue, LoadingRows, PageHeader, StatusPill, toast, useModal } from "@mycity/ui";
import { LeadForm } from "./forms/LeadForm";
import { LoseLead } from "./forms/LoseLead";
import { fail } from "./lib";

/** Partnerships · Leads (#52), on the mock until M7 PR 3 (docs/guides/partnerships.md §2, §10). */
export function Leads() {
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
