import { useApi, usePaged } from "@/api/hooks";
import "@/api/types/partnerships";
import type { Contract, Renewal } from "@/api/types/partnerships";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { ChainCard, PagedTable } from "@/features/shared/sections";
import { Button, formatDate, formatMoneyShort, Grid, PageHeader, StatusPill, useModal } from "@mycity/ui";
import { ContractForm } from "./forms/ContractForm";
import { short } from "./lib";

/** Partnerships · Contracts & MOUs (#54), on the mock until M7 PR 6 (docs/guides/partnerships.md §6.8, §10). */
export function Contracts() {
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
