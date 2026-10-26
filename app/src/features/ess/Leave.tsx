import type { LeaveBalance, LeaveRequest } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useMe } from "@/auth/AuthProvider";
import { useState } from "react";
import { Button, Calendar, Card, CardHeader, DataView, DesktopOnly, formatDate, Grid, KeyValue, KpiCard, Meter, PageHeader, Pager, TapList, toast, todayIso, useConfirm, useModal } from "@mycity/ui";
import { MonthPicker } from "@/features/shared/MonthPicker";
import { PhoneCards } from "@/features/shared/PhoneCards";
import { dayCount, LeaveForm, statusPill } from "@/features/people/Leave";
import { useNewLink, useScreenAction } from "@/shell/screen-action";

/**
 * ESS · My Leave (#12, `my-leave`): the caller's own requests and what is left of
 * their year (docs/guides/ess.md §10). Everything here is the caller's own; asking
 * for leave sends it to the approval flow.
 */

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--input)"];

/** The type the four figures show: Annual when it is offered, else the first with an allowance. */
const headline = (balances: LeaveBalance[]) =>
  balances.find((b) => b.code === "annual") ?? balances.find((b) => b.entitled !== null) ?? null;

/** Who a request waits on, or who settled it. */
const approverOf = (r: LeaveRequest) => r.waiting_on ?? (r.recorded ? "People" : r.status === "cancelled" ? "Withdrawn" : "Decided");

export function MyLeavePage() {
  const modal = useModal();
  const confirm = useConfirm();
  const bal = useApi("GET /api/v1/ess/leave/balances");
  const list = usePaged("GET /api/v1/ess/leave", { sort: "-starts_on" });
  const cancel = useMutation("POST /api/v1/ess/leave/:id/cancel");
  const today = todayIso();
  const year = bal.data?.year;
  const balances = bal.data?.balances ?? [];
  const main = headline(balances);
  // The next booked leave, read for itself: the first page of every request may not hold it.
  const upcoming = usePaged("GET /api/v1/ess/leave", { filters: { status: "approved", from: today }, sort: "starts_on" });
  const next = upcoming.rows.find((r) => r.starts_on > today) ?? null;
  const request = () => modal.open({ title: "Request Leave", body: (close) => <LeaveForm close={close} /> });
  useScreenAction({ label: "Request Leave", onSelect: request });
  // The assistant's Request Leave button: ?new=1 and the form's values (docs/guides/praxis-ai.md §6.4).
  useNewLink(request);

  const open = (r: LeaveRequest) =>
    modal.open({
      title: `${r.leave_type_name} Leave, ${formatDate(r.starts_on)}`,
      body: (close) => {
        const canCancel = r.status === "submitted" || (r.status === "approved" && r.starts_on > today);
        const stop = async () => {
          const booked = r.status === "approved";
          if (!(await confirm({ title: "Cancel Request", body: booked ? "The days go back to your balance." : "It no longer waits for a decision.", confirmLabel: "Cancel Request", cancelLabel: "Keep It", destructive: true }))) return;
          try {
            await cancel.run({ params: { id: r.leave_request_id }, body: {} });
            invalidate("/api/v1/ess/leave");
            invalidate("/api/v1/workflow");
            close();
            toast("Request cancelled");
          } catch (e) {
            toast.error(e instanceof ApiError ? e.message : "Not cancelled. Try again.");
          }
        };
        return (
          <>
            <Card>
              <CardHeader title="Request" />
              <KeyValue
                items={[
                  ["Type", r.leave_type_name],
                  ["From", formatDate(r.starts_on)],
                  ["To", formatDate(r.ends_on)],
                  ["Days", dayCount(r.days)],
                  ["Approver", approverOf(r)],
                  ["Status", statusPill(r)],
                  ...(r.reason ? ([["Note", r.reason]] as Array<[string, string]>) : []),
                ]}
              />
            </Card>
            {canCancel && (
              <div className="mt-3 flex justify-end">
                <Button busy={cancel.pending} onClick={stop}>
                  Cancel Request
                </Button>
              </div>
            )}
          </>
        );
      },
    });

  const ent = (
    <Card>
      <CardHeader title="Entitlement" />
      {balances.length === 0 && <p className="text-2xs text-subtle-foreground">{bal.loading ? "Loading" : "No leave types offered yet"}</p>}
      {balances.map((b, i) => (
        <div key={b.leave_type_id} className="border-b border-border py-2 last:border-b-0">
          <div className="flex items-baseline gap-2">
            <b className="text-xs">{b.name}</b>
            <span className="ml-auto text-2xs text-subtle-foreground">{b.entitled === null ? "No set allowance" : dayCount(b.entitled)}</span>
          </div>
          {b.entitled !== null && b.entitled > 0 && (
            <div className="mt-1.5">
              <Meter pct={Math.min(100, ((b.taken + b.booked + b.pending) / b.entitled) * 100)} label="" color={COLORS[i % 4]} />
            </div>
          )}
          <div className="mt-1 text-2xs text-subtle-foreground">
            {b.taken} taken, {b.booked} booked{b.pending ? `, ${b.pending} pending` : ""}
            {b.remaining !== null ? `, ${b.remaining} left` : ""}
          </div>
        </div>
      ))}
    </Card>
  );

  const reqTable = (
    <DataView
      title="My Requests"
      rows={list.rows}
      rowKey={(r) => r.leave_request_id}
      loading={list.loading}
      error={list.error}
      onRowClick={open}
      empty={{ title: "No Leave Requested Yet", text: "Use Request Leave to ask your manager." }}
      columns={[
        { key: "t", label: "Type", render: (r) => r.leave_type_name },
        { key: "f", label: "From", render: (r) => formatDate(r.starts_on) },
        { key: "o", label: "To", render: (r) => formatDate(r.ends_on) },
        { key: "d", label: "Days", align: "n", render: (r) => r.days },
        { key: "a", label: "Approver", render: approverOf },
        { key: "s", label: "Status", render: statusPill },
      ]}
      footer={<Pager page={list.page} onPage={list.setPage} noun="request" />}
    />
  );

  return (
    <>
      <PageHeader title="My Leave" sub={year ? `${year} entitlement` : undefined} actions={
          <>
            <Button icon="calendar" onClick={() => modal.open({ title: "Leave Calendar", wide: true, body: <MyLeaveCalendar /> })}>Leave Calendar</Button>
            <Button variant="primary" icon="plus" onClick={request}>Request Leave</Button>
          </>
        }
      />
      {main && main.entitled !== null && (
        <Grid cols="4m2">
          <KpiCard opensOn="phone" title="Entitlement" value={dayCount(main.entitled)} caption={`${main.name}, ${year}`} onOpen={() => modal.open({ title: "Entitlement", body: ent })} />
          <KpiCard opensOn="phone" title="Taken" value={String(main.taken)} caption="This year" onOpen={() => modal.open({ title: "Leave Taken", wide: true, body: <LeaveTaken year={year} onOpen={open} /> })} />
          <KpiCard
            opensOn="phone"
            title="Approved Upcoming"
            value={String(main.booked)}
            caption={next ? `${formatDate(next.starts_on).slice(0, 5)} to ${formatDate(next.ends_on).slice(0, 5)}` : "None booked"}
            onOpen={next ? () => open(next) : undefined}
          />
          <KpiCard opensOn="phone" title="Remaining" value={String(main.remaining ?? 0)} tone="ok" caption={`${main.name} days left`} onOpen={() => modal.open({ title: "Entitlement", body: ent })} />
        </Grid>
      )}
      <PhoneCards
        items={[
          {
            icon: "doc",
            title: "My Requests",
            sub: `${list.page?.total ?? 0} in all${next ? ` · next on ${formatDate(next.starts_on).slice(0, 5)}` : ""}`,
            body: (
              <TapList
                items={list.rows.map((r) => ({
                  key: r.leave_request_id,
                  title: `${r.leave_type_name} · ${dayCount(r.days)}`,
                  sub: `${formatDate(r.starts_on)} to ${formatDate(r.ends_on)}`,
                  right: statusPill(r),
                  onClick: () => open(r),
                }))}
              />
            ),
          },
          { icon: "clock", title: "Entitlement", sub: main && main.remaining !== null ? `${main.remaining} ${main.name.toLowerCase()} days left` : "Your allowance", body: ent },
        ]}
      />
      <DesktopOnly>
        <Grid cols="1.4/1">
          {reqTable}
          {ent}
        </Grid>
      </DesktopOnly>
    </>
  );
}


/**
 * The leave calendar (the team lead, 18/10/2026): approved and waiting leave for the reader and
 * everyone under them; everyone for Operations & People and the CEO. The server decides whose
 * (GET /ess/leave/calendar). This year and next, a month at a time.
 */
function MyLeaveCalendar() {
  const me = useMe();
  const now = todayIso().slice(0, 7);
  const first = `${now.slice(0, 4)}-01`;
  const last = `${Number(now.slice(0, 4)) + 1}-12`;
  const [ym, setYm] = useState(now);
  const list = usePaged("GET /api/v1/ess/leave/calendar", { filters: { month: ym }, sort: "starts_on" });
  const events = list.rows.flatMap((r) => {
    const own = r.employee.employee_id === me.employee_id;
    const label = `${own ? "You" : r.employee.display_name.split(" ")[0]}${r.status === "submitted" ? " (Waiting)" : ""}`;
    const out = [];
    for (let d = new Date(`${r.starts_on}T12:00:00Z`); d <= new Date(`${r.ends_on}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10);
      if (date.startsWith(ym)) out.push({ date, label, highlight: own });
    }
    return out;
  });
  return (
    <>
      <MonthPicker value={ym} onChange={setYm} min={first} max={last} className="mb-3" />
      <Calendar year={Number(ym.slice(0, 4))} month={Number(ym.slice(5, 7)) - 1} events={events} />
      <Pager page={list.page} onPage={list.setPage} noun="request" />
    </>
  );
}

/** Leave Taken: the approved leave of the year that has begun, newest first, 25 a page. */
function LeaveTaken({ year, onOpen }: { year?: number; onOpen: (r: LeaveRequest) => void }) {
  const today = todayIso();
  const list = usePaged("GET /api/v1/ess/leave", { filters: { status: "approved", to: today, ...(year ? { year } : {}) }, sort: "-starts_on" });
  return (
    <DataView
      bare
      caption="Leave Taken"
      rows={list.rows}
      rowKey={(r) => r.leave_request_id}
      loading={list.loading}
      error={list.error}
      onRowClick={onOpen}
      empty={{ title: "No Leave Taken Yet", text: "Approved leave shows here once it starts." }}
      columns={[
        { key: "t", label: "Type", render: (r) => r.leave_type_name },
        { key: "f", label: "From", render: (r) => formatDate(r.starts_on) },
        { key: "o", label: "To", render: (r) => formatDate(r.ends_on) },
        { key: "d", label: "Days", align: "n", render: (r) => r.days },
      ]}
      footer={<Pager page={list.page} onPage={list.setPage} noun="request" />}
    />
  );
}
