import type { LeaveBalance, LeaveRequest } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { Button, Card, CardHeader, DataView, DesktopOnly, formatDate, Grid, KeyValue, KpiCard, Meter, PageHeader, Pager, TapList, toast, todayIso, useModal } from "@mycity/ui";
import { PhoneCards } from "@/features/shared/PhoneCards";
import { dayCount, LeaveForm, statusPill } from "@/features/people/Leave";
import { useScreenAction } from "@/shell/screen-action";

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
  const bal = useApi("GET /api/v1/ess/leave/balances");
  const list = usePaged("GET /api/v1/ess/leave", { sort: "-starts_on" });
  const cancel = useMutation("POST /api/v1/ess/leave/:id/cancel");
  const today = todayIso();
  const year = bal.data?.year;
  const balances = bal.data?.balances ?? [];
  const main = headline(balances);
  const next = [...list.rows].reverse().find((r) => r.status === "approved" && r.starts_on > today) ?? null;
  const request = () => modal.open({ title: "Request Leave", body: (close) => <LeaveForm close={close} /> });
  useScreenAction({ label: "Request Leave", onSelect: request });

  const open = (r: LeaveRequest) =>
    modal.open({
      title: `${r.leave_type_name} Leave, ${formatDate(r.starts_on)}`,
      body: (close) => {
        const canCancel = r.status === "submitted" || (r.status === "approved" && r.starts_on > today);
        const stop = async () => {
          try {
            await cancel.run({ params: { id: r.leave_request_id }, body: {} });
            invalidate("/api/v1/ess/leave");
            invalidate("/api/v1/workflow");
            close();
            toast("Request cancelled");
          } catch (e) {
            toast(e instanceof ApiError ? e.message : "Not cancelled. Try again.");
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
      <PageHeader title="My Leave" sub={year ? `${year} entitlement` : undefined} actions={<Button variant="primary" icon="plus" onClick={request}>Request Leave</Button>} />
      {main && main.entitled !== null && (
        <Grid cols="4m2">
          <KpiCard opensOn="phone" title="Entitlement" value={dayCount(main.entitled)} caption={`${main.name}, ${year}`} onOpen={() => modal.open({ title: "Entitlement", body: ent })} />
          <KpiCard opensOn="phone" title="Taken" value={String(main.taken)} caption="This year" onOpen={() => modal.open({ title: "Leave Taken", wide: true, body: reqTable })} />
          <KpiCard
            opensOn="phone"
            title="Approved Upcoming"
            value={String(main.booked)}
            caption={next ? `${formatDate(next.starts_on).slice(0, 5)} to ${formatDate(next.ends_on).slice(0, 5)}` : "None booked"}
            onOpen={() => next && open(next)}
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
