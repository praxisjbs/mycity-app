import { useApi, usePaged, useMutation, invalidate } from "@/api/hooks";
import type { LeaveRequest } from "@/api/types/leave";
import "@/api/types/leave";
import { Button, Card, CardHeader, DataView, DesktopOnly, formatDate, Grid, KeyValue, KpiCard, Meter, PageHeader, Pager, Pill, TapList, toast, useModal } from "@mycity/ui";
import { PhoneCards } from "@/features/shared/PhoneCards";
import { LEAVE_TONE, LeaveForm } from "@/features/people/Leave";
import { useScreenAction } from "@/shell/screen-action";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--input)"];

export function MyLeavePage() {
  const modal = useModal();
  const bal = useApi("GET /api/v1/leave/balances");
  const list = usePaged("GET /api/v1/leave/requests", { filters: { scope: "own" } });
  const cancel = useMutation("POST /api/v1/leave/requests/:id/cancel");
  const annual = bal.data?.balances.find((b) => b.type === "Annual");
  const next = list.rows.find((r) => r.status === "Approved" && r.from >= new Date().toISOString().slice(0, 10));
  const request = () => modal.open({ title: "Request Leave", body: (close) => <LeaveForm close={close} /> });
  useScreenAction({ label: "Request Leave", onSelect: request });
  const open = (r: LeaveRequest) =>
    modal.open({
      title: `${r.type} Leave, ${formatDate(r.from)}`,
      body: (close) => (
        <>
          <Card>
            <CardHeader title="Request" />
            <KeyValue items={[["Number", r.number], ["Type", r.type], ["From", formatDate(r.from)], ["To", formatDate(r.to)], ["Days", String(r.days)], ["Approver", r.approver ?? "Your line manager"], ["Status", <Pill tone={LEAVE_TONE[r.status]}>{r.status}</Pill>]]} />
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
        <div key={b.type} className="border-b border-border py-2 last:border-b-0">
          <div className="flex items-baseline gap-2">
            <b className="text-xs">{b.type}</b>
            <span className="ml-auto text-2xs text-subtle-foreground">{b.entitled} days</span>
          </div>
          <div className="mt-1.5"><Meter pct={((b.taken + b.booked) / b.entitled) * 100} label="" color={COLORS[i % 4]} /></div>
          <div className="mt-1 text-2xs text-subtle-foreground">{b.taken} taken, {b.booked} booked, {b.left} left</div>
        </div>
      ))}
    </Card>
  );
  const reqTable = (
    <DataView
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
      <PageHeader title="My Leave" sub={`${bal.data?.year ?? ""} entitlement`} actions={<Button variant="primary" icon="plus" onClick={request}>Request Leave</Button>} />
      {annual && ent && (
        <Grid cols="4m2">
          <KpiCard opensOn="phone" title="Entitlement" value={`${annual.entitled} days`} caption={`Annual, ${bal.data!.year}`} onOpen={() => modal.open({ title: "Entitlement", body: ent })} />
          <KpiCard opensOn="phone" title="Taken" value={String(annual.taken)} caption="This year" onOpen={() => modal.open({ title: "Leave Taken", wide: true, body: reqTable })} />
          <KpiCard opensOn="phone" title="Approved Upcoming" value={String(annual.booked)} caption={next ? `${formatDate(next.from).slice(0, 5)} to ${formatDate(next.to).slice(0, 5)}` : "None booked"} onOpen={() => next && open(next)} />
          <KpiCard opensOn="phone" title="Remaining" value={String(annual.left)} tone="ok" caption="Annual days left" onOpen={() => modal.open({ title: "Entitlement", body: ent })} />
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
