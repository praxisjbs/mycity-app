import { useState } from "react";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import type { LeaveRequest, LeaveType } from "@/api/types/leave";
import "@/api/types/leave";
import { useMe } from "@/auth/AuthProvider";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { Button, Calendar, Card, CardHeader, Chips, DataView, DateField, Field, formatDate, FormFooter, Grid, Grow, LoadingRows, monthName, PageHeader, Pager, Pill, rules, SearchInput, SelectField, TextAreaField, toast, todayIso, Toolbar, useContractForm, useModal, Who } from "@mycity/ui";
import { EmployeePicker } from "@/features/shared/pickers";

export const LEAVE_TONE: Record<LeaveRequest["status"], "ok" | "warn" | "err" | "neutral"> = { Approved: "ok", Pending: "warn", Rejected: "err", Cancelled: "neutral" };
export const LEAVE_TYPES: LeaveType[] = ["Annual", "Sick", "Compassionate", "Maternity", "Paternity", "Study", "Unpaid"];

export function PeopleLeave() {
  const me = useMe();
  const modal = useModal();
  const summary = useApi("GET /api/v1/leave/summary", { query: { scope: "all" } });
  const [status, setStatus] = useState("all");
  const list = usePaged("GET /api/v1/leave/requests", { filters: { scope: "all", ...(status !== "all" && { status }) } });
  const [selected, setSelected] = useState<LeaveRequest | null>(null);
  const sel = selected ?? list.rows.find((r) => r.status === "Pending") ?? null;
  const now = todayIso();
  return (
    <>
      <PageHeader
        title="Leave"
        sub={`${monthName(Number(now.slice(5, 7)) - 1)} ${now.slice(0, 4)}`}
        actions={
          <>
            <Button onClick={() => modal.open({ title: "Leave Calendar", wide: true, body: <LeaveCalendar /> })}>Leave Calendar</Button>
            {me.grants.people?.includes("create") && (
              <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "Record Leave", body: (close) => <LeaveForm close={close} onBehalf /> })}>
                Record Leave
              </Button>
            )}
          </>
        }
      />
      {summary.data && <KpiTiles items={summary.data.kpis} />}
      <Grid cols="1.4/1">
        <div className="min-w-0">
          <Toolbar>
            <SearchInput value={list.q} onChange={list.setQ} placeholder="Name or type" className="w-full md:w-64" />
          </Toolbar>
          <Chips value={status} onChange={setStatus} options={[["all", "All"], ["Pending", "Pending"], ["Approved", "Approved"], ["Rejected", "Rejected"]]} />
          <DataView
            title="Requests"
            rows={list.rows}
            rowKey={(r) => r.leave_id}
            loading={list.loading}
            error={list.error}
            selectedKey={sel?.leave_id}
            onRowClick={(r) => setSelected(r)}
            columns={[
              { key: "e", label: "Employee", render: (r) => <Who name={r.employee.display_name} sub={r.employee.department} /> },
              { key: "t", label: "Type", render: (r) => r.type },
              { key: "f", label: "From", render: (r) => formatDate(r.from) },
              { key: "o", label: "To", render: (r) => formatDate(r.to) },
              { key: "d", label: "Days", align: "n", render: (r) => r.days },
              { key: "s", label: "Status", render: (r) => <Pill tone={LEAVE_TONE[r.status]}>{r.status}</Pill> },
            ]}
            footer={<Pager page={list.page} onPage={list.setPage} noun="request" />}
          />
        </div>
        {sel ? <CoverCard leave={sel} onDone={() => setSelected(null)} /> : <Card><p className="text-xs text-subtle-foreground">Select a request to check cover.</p></Card>}
      </Grid>
    </>
  );
}

function CoverCard({ leave, onDone }: { leave: LeaveRequest; onDone: () => void }) {
  const cover = useApi("GET /api/v1/leave/requests/:id/cover", { params: { id: leave.leave_id } });
  const decide = useMutation("POST /api/v1/leave/requests/:id/decision");
  const act = async (approve: boolean) => {
    try {
      await decide.run({ params: { id: leave.leave_id }, body: { approve } });
      invalidate("/api/v1/leave");
      toast(approve ? `${leave.number} approved. ${leave.employee.display_name} has been told.` : `${leave.number} rejected. ${leave.employee.display_name} has been told.`);
      onDone();
    } catch {
      toast(decide.error?.message ?? "Not saved");
    }
  };
  if (!cover.data) return <Card><LoadingRows /></Card>;
  return (
    <Card>
      <CardHeader title={cover.data.title} />
      <p className="mb-2.5 text-2xs text-subtle-foreground">{cover.data.text}</p>
      {cover.data.rows.map((r) => (
        <div key={r.title} className="flex items-center gap-2.5 border-b border-border py-2">
          <span className="min-w-0 flex-1">
            <div className="text-xs font-semibold">{r.title}</div>
            <div className="text-2xs text-subtle-foreground">{r.text}</div>
          </span>
          <Pill tone={r.tone}>{r.result}</Pill>
        </div>
      ))}
      {leave.status === "Pending" && (
        <div className="mt-3 flex gap-2">
          <Grow />
          <Button busy={decide.pending} onClick={() => act(false)}>Reject</Button>
          <Button variant="primary" icon="ok" busy={decide.pending} onClick={() => act(true)}>Approve</Button>
        </div>
      )}
    </Card>
  );
}

function LeaveCalendar() {
  const list = usePaged("GET /api/v1/leave/requests", { filters: { scope: "all", status: "Approved" } });
  const now = todayIso();
  const y = Number(now.slice(0, 4));
  const m = Number(now.slice(5, 7)) - 1;
  const events = list.rows.flatMap((r) => {
    const out = [];
    for (let d = new Date(`${r.from}T12:00:00Z`); d <= new Date(`${r.to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push({ date: d.toISOString().slice(0, 10), label: r.employee.display_name.split(" ")[0] });
    return out;
  });
  return <Calendar year={y} month={m} events={events} />;
}

/** Request leave (ESS), or record it for someone (People). */
export function LeaveForm({ close, onBehalf }: { close: () => void; onBehalf?: boolean }) {
  const [who, setWho] = useState<PersonRef[]>([]);
  const f = useContractForm({ type: "Annual", from: "", to: "", reason: "" }, { from: rules.required("Pick the first day"), to: (v, all) => (!v ? "Pick the last day" : all.from && v < (all.from as string) ? "Ends before it starts" : null), reason: rules.required("Give a short reason") });
  const save = useMutation("POST /api/v1/leave/requests");
  const submit = async () => {
    if (!f.check() || (onBehalf && !who.length)) return;
    try {
      const r = await save.run({ body: { type: f.values.type as LeaveType, from: f.values.from, to: f.values.to, reason: f.values.reason, ...(onBehalf && { employee_id: who[0].employee_id }) } });
      invalidate("/api/v1/leave");
      close();
      toast(onBehalf ? `${r.number} recorded for ${r.employee.display_name}` : `${r.number} sent to your manager`);
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      {onBehalf && (
        <Field label="Employee">
          <EmployeePicker value={who} onChange={setWho} />
        </Field>
      )}
      <Field label="Leave Type">
        <SelectField options={LEAVE_TYPES.map((t) => [t, t])} {...f.field("type")} />
      </Field>
      <>
        <Field label="First Day" {...f.field("from")}><DateField {...f.field("from")} /></Field>
        <Field label="Last Day" {...f.field("to")}><DateField {...f.field("to")} min={f.values.from || undefined} /></Field>
      </>
      <Field label="Reason" {...f.field("reason")}>
        <TextAreaField {...f.field("reason")} placeholder="Family event" />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>{onBehalf ? "Record Leave" : "Send Request"}</Button>
      </FormFooter>
    </>
  );
}
