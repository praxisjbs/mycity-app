import type { ExpenseRow } from "@mycity/contract/contract.gen.ts";
import { useState } from "react";
import { useApi, usePaged } from "@/api/hooks";
import { PagedTable } from "@/features/shared/sections";
import { useNewLink, useScreenAction } from "@/shell/screen-action";
import { Button, formatDate, formatMoneyShort, Grid, HelpTerm, KpiCard, ListDetail, Money, PageHeader, todayIso, useModal } from "@mycity/ui";
import { OwnActions, RequestCard, RequestForm, stagePill } from "./parts";

/**
 * ESS · My Requests (#56, `my-requests`): the person's own expense requests (docs/guides/expenses.md
 * §10). A request opens in the modal, on desktop and on a phone (F31 as amended); In Flight and
 * Disbursed This Year open their requests in a modal too.
 */
export function MyRequestsPage() {
  const modal = useModal();
  const s = useApi("GET /api/v1/expenses/mine/summary");
  const list = usePaged("GET /api/v1/expenses/mine", { sort: "-created_at" });
  const [picked, setPicked] = useState<string | null>(null);
  const raise = () => modal.open({ title: "New Request", wide: true, body: (close) => <RequestForm close={close} /> });
  useScreenAction({ label: "New Request", onSelect: raise });
  useNewLink(raise);
  const records = (title: string, filters: Record<string, string>) => () =>
    modal.open({ title, wide: true, body: () => <Records filters={filters} /> });

  return (
    <>
      <PageHeader title="My Requests" sub="Your own expense requests" actions={<Button variant="primary" icon="plus" onClick={async () => raise()}>New Request</Button>} />
      {s.data && (
        <Grid cols="4m2">
          <KpiCard title="In Flight" value={String(s.data.in_flight)} tone={s.data.in_flight ? "warn" : undefined} onOpen={records("In Flight", { in_flight: "true" })} />
          <KpiCard title="Disbursed This Year" value={formatMoneyShort(s.data.disbursed_this_year)} onOpen={records("Disbursed This Year", { disbursed_from: `${todayIso().slice(0, 4)}-01-01` })} />
          <KpiCard title="Average Turnaround" value={s.data.average_turnaround_days === null ? "None" : `${s.data.average_turnaround_days} days`} />
          <KpiCard title="Rejected" value={String(s.data.rejected)} tone={s.data.rejected ? "err" : "ok"} />
        </Grid>
      )}
      <ListDetail
        layout="modal"
        className="mt-3"
        open={picked !== null}
        onClose={() => setPicked(null)}
        title="Expense Request"
        list={<RequestTable list={list} onPick={(r) => setPicked(r.expense_request_id)} />}
        detail={picked && <RequestCard id={picked} actions={(r) => <OwnActions r={r} close={() => setPicked(null)} />} />}
      />
    </>
  );
}

function RequestTable({ list, onPick }: { list: ReturnType<typeof usePaged<"GET /api/v1/expenses/mine">>; onPick?: (r: ExpenseRow) => void }) {
  return (
    <PagedTable<ExpenseRow>
      title="Requests"
      list={list}
      search="Search requests"
      rowKey={(r) => r.expense_request_id}
      noun="request"
      onRowClick={onPick}
      empty={{ title: "No Requests Yet", text: "Raise one with New Request." }}
      columns={[
        { key: "n", label: "Reference", render: (r) => <span className="font-semibold">{r.number}</span> },
        { key: "p", label: "Purpose", render: (r) => r.purpose },
        { key: "a", label: "Amount", align: "n", render: (r) => <Money value={r.amount} /> },
        { key: "d", label: "Submitted", render: (r) => (r.submitted_at ? formatDate(r.submitted_at) : "Not sent"), desktop: true },
        { key: "s", label: <HelpTerm help="Who the request is waiting on now.">Stage</HelpTerm>, render: (r) => stagePill(r) },
      ]}
    />
  );
}

/** A KPI card's own requests, 25 a page, in its modal. */
function Records({ filters }: { filters: Record<string, string> }) {
  const list = usePaged("GET /api/v1/expenses/mine", { filters });
  return <RequestTable list={list} />;
}
