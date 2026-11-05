import { useEffect, useState } from "react";
import { useApi, usePaged } from "@/api/hooks";
import "@/api/types/partnerships";
import type { Proposal, ProposalDoc } from "@/api/types/partnerships";
import { useRouter } from "@/lib/router";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { PagedTable } from "@/features/shared/sections";
import { Button, Card, formatMoney, formatMoneyShort, ListDetail, LoadingRows, PageHeader, Paper, PaperFoot, PaperLogo, PaperTable, PaperTitle, StatusPill, useModal, useSideBySide } from "@mycity/ui";
import { ProposalForm } from "./forms/ProposalForm";

/** Partnerships · Proposals (#53), on the mock until M7 PR 7 (docs/guides/partnerships.md §6.10, §10). */
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

export function Proposals() {
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
