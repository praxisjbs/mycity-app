import { useApi, usePaged, useMutation, invalidate } from "@/api/hooks";
import type { LeaveRequest } from "@/api/types/leave";
import "@/api/types/leave";
import { Button } from "@/components/ui/Button";
import { Kpi, KV, Pill, TapList } from "@/components/ui/data";
import { Card, CardHeader, DesktopOnly, Grid, PageHead } from "@/components/ui/layout";
import { useModal } from "@/components/ui/Modal";
import { Mini } from "@/components/ui/data";
import { Pager, Table } from "@/components/ui/Table";
import { toast } from "@/components/ui/Toast";
import { PhoneCards } from "@/features/shared/PhoneCards";
import { LEAVE_TONE, LeaveForm } from "@/features/people/Leave";
import { formatDate } from "@/lib/format";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--input)"];

export function MyLeavePage() {
  const modal = useModal();
  const bal = useApi("GET /api/v1/leave/balances");
  const list = usePaged("GET /api/v1/leave/requests", { filters: { scope: "own" } });
  const cancel = useMutation("POST /api/v1/leave/requests/:id/cancel");
  const annual = bal.data?.balances.find((b) => b.type === "Annual");
  const next = list.rows.find((r) => r.status === "Approved" && r.from >= new Date().toISOString().slice(0, 10));
  const request = () => modal.open({ title: "Request Leave", body: (close) => <LeaveForm close={close} /> });
  const open = (r: LeaveRequest) =>
    modal.open({
      title: `${r.type} Leave, ${formatDate(r.from)}`,
      body: (close) => (
        <>
          <Card>
            <CardHeader title="Request" />
            <KV items={[["Number", r.number], ["Type", r.type], ["From", formatDate(r.from)], ["To", formatDate(r.to)], ["Days", String(r.days)], ["Approver", r.approver ?? "Your line manager"], ["Status", <Pill tone={LEAVE_TONE[r.status]}>{r.status}</Pill>]]} />
          </Card>
          {r.status === "Pending" && (
            <div className="mt-3 flex justify-end">
              <Button busy={cancel.pending} onClick={async () => (await cancel.run({ params: { id: r.leave_id }, body: {} }), invalidate("/api/v1/leave"), close(), toast(`${r.number} cancelled`))}>
                Cancel This Request
              </Button>
            </div>
          )}
        </>
      ),
    });
  const ent = bal.data && (
    <Card>
      <CardHeader title="Entitlement" />
      {bal.data.balances.map((b, i) => (
        <div key={b.type} className="border-b border-border py-[9px] last:border-b-0">
          <div className="flex items-baseline gap-2">
            <b className="text-[12.5px]">{b.type}</b>
            <span className="ml-auto text-[11.5px] text-subtle-foreground">{b.entitled} days</span>
          </div>
          <div className="mt-1.5"><Mini pct={((b.taken + b.booked) / b.entitled) * 100} label="" color={COLORS[i % 4]} /></div>
          <div className="mt-1 text-[11.5px] text-subtle-foreground">{b.taken} taken, {b.booked} booked, {b.left} left</div>
        </div>
      ))}
    </Card>
  );
  const reqTable = (
    <Table
      title="My Requests"
      rows={list.rows}
      rowKey={(r) => r.leave_id}
      loading={list.loading}
      onRowClick={open}
      empty={{ title: "No Leave Requested Yet", text: "Use Request Leave to ask your manager." }}
      columns={[
        { key: "t", label: "Type", render: (r) => r.type },
        { key: "f", label: "From", render: (r) => formatDate(r.from) },
        { key: "o", label: "To", render: (r) => formatDate(r.to) },
        { key: "d", label: "Days", align: "n", render: (r) => r.days },
        { key: "a", label: "Approver", render: (r) => r.approver ?? "Line manager" },
        { key: "s", label: "Status", render: (r) => <Pill tone={LEAVE_TONE[r.status]}>{r.status}</Pill> },
      ]}
      footer={<Pager page={list.page} onPage={list.setPage} noun="request" />}
    />
  );
  return (
    <>
      <PageHead title="My Leave" sub={`${bal.data?.year ?? ""} entitlement`} actions={<Button variant="primary" icon="plus" onClick={request}>Request Leave</Button>} />
      {annual && ent && (
        <Grid cols="4m2">
          <Kpi opensOn="phone" label="Entitlement" value={`${annual.entitled} days`} trend={`Annual, ${bal.data!.year}`} onClick={() => modal.open({ title: "Entitlement", body: ent })} />
          <Kpi opensOn="phone" label="Taken" value={String(annual.taken)} trend="This year" onClick={() => modal.open({ title: "Leave Taken", wide: true, body: reqTable })} />
          <Kpi opensOn="phone" label="Approved Upcoming" value={String(annual.booked)} trend={next ? `${formatDate(next.from).slice(0, 5)} to ${formatDate(next.to).slice(0, 5)}` : "None booked"} onClick={() => next && open(next)} />
          <Kpi opensOn="phone" label="Remaining" value={String(annual.left)} tone="ok" trend="Annual days left" onClick={() => modal.open({ title: "Entitlement", body: ent })} />
        </Grid>
      )}
      <PhoneCards
        items={[
          { icon: "doc", title: "My Requests", sub: `${list.page?.total ?? 0} this year${next ? ` · next on ${formatDate(next.from).slice(0, 5)}` : ""}`, body: <TapList items={list.rows.map((r) => ({ key: r.leave_id, title: `${r.type} · ${r.days} ${r.days === 1 ? "day" : "days"}`, sub: `${formatDate(r.from)} to ${formatDate(r.to)}`, right: <Pill tone={LEAVE_TONE[r.status]}>{r.status}</Pill>, onClick: () => open(r) }))} /> },
          { icon: "clock", title: "Entitlement", sub: `${annual?.left ?? 0} annual days left`, body: ent },
        ]}
      />
      <DesktopOnly>
        <Grid cols="1.4/1">{reqTable}{ent}</Grid>
      </DesktopOnly>
    </>
  );
}
