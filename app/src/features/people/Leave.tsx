import { useState } from "react";
import leave from "@mycity/contract/schemas/leave.js";
import workflow from "@mycity/contract/schemas/workflow.js";
import type { LeaveRequest, LeaveStatus } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { usePhotos } from "@/api/download";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import { useMe } from "@/auth/AuthProvider";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { EmployeePicker } from "@/features/shared/pickers";
import { LeaveAllowances, LeaveTypes } from "./LeaveSettings";
import {
  Button,
  Calendar,
  Card,
  CardHeader,
  Chips,
  DataView,
  DateField,
  Field,
  formatDate,
  FormFooter,
  Grid,
  Grow,
  KeyValue,
  monthName,
  PageHeader,
  Pager,
  Pill,
  SearchInput,
  SelectField,
  TapList,
  TextAreaField,
  toast,
  todayIso,
  Toolbar,
  useConfirm,
  useContractForm,
  useModal,
  Who,
} from "@mycity/ui";

/**
 * People · Leave (#26, `leave`) and the leave form My Leave shares
 * (docs/guides/ess.md §3 step 5, §10). Requests are read within the reader's
 * `people` scope; a waiting request is approved or rejected in its approval
 * (the workflow routes), the same decision My Approvals makes.
 */

type Tone = "ok" | "warn" | "err" | "neutral";

/** How a status reads, the same on every leave screen. */
export const LEAVE_STATUS: Record<LeaveStatus, { tone: Tone; text: string }> = {
  submitted: { tone: "warn", text: "Pending" },
  approved: { tone: "ok", text: "Approved" },
  rejected: { tone: "err", text: "Rejected" },
  cancelled: { tone: "neutral", text: "Cancelled" },
};

export const statusPill = (r: LeaveRequest) => <Pill tone={LEAVE_STATUS[r.status].tone}>{LEAVE_STATUS[r.status].text}</Pill>;

export const dayCount = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

const say = (e: unknown) => toast(e instanceof ApiError ? e.message : "Not saved. Try again.");

export function PeopleLeave() {
  const me = useMe();
  const modal = useModal();
  const summary = useApi("GET /api/v1/leave/summary");
  const [status, setStatus] = useState<"all" | LeaveStatus>("all");
  const list = usePaged("GET /api/v1/leave/requests", {
    filters: status === "all" ? {} : { status },
    sort: "-starts_on",
  });
  const photo = usePhotos(list.rows.map((r) => r.employee.photo_url));
  const [selected, setSelected] = useState<LeaveRequest | null>(null);
  const sel = selected ?? list.rows.find((r) => r.status === "submitted") ?? list.rows[0] ?? null;
  const now = todayIso();
  const s = summary.data;
  return (
    <>
      <PageHeader
        title="Leave"
        sub={`${monthName(Number(now.slice(5, 7)) - 1)} ${now.slice(0, 4)}`}
        actions={
          <>
            <Button onClick={() => modal.open({ title: "Leave Calendar", wide: true, body: <LeaveCalendar /> })}>Leave Calendar</Button>
            <Button onClick={() => modal.open({ title: "Leave Types", wide: true, body: <LeaveTypes /> })}>Leave Types</Button>
            <Button onClick={() => modal.open({ title: "Allowances", body: <LeaveAllowances /> })}>Allowances</Button>
            {me.grants.people?.includes("create") && (
              <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "Record Leave", body: (close) => <LeaveForm close={close} onBehalf /> })}>
                Record Leave
              </Button>
            )}
          </>
        }
      />
      {s && (
        <KpiTiles
          mobileCols={2}
          items={[
            { key: "today", label: "On Leave Today", value: String(s.on_leave_today) },
            { key: "pending", label: "Pending Approval", value: String(s.pending), tone: s.pending ? "warn" : undefined },
            { key: "soon", label: "Starting Soon", value: String(s.starting_soon), sub: "Next 14 days" },
            { key: "year", label: "Approved This Year", value: String(s.approved_this_year) },
          ]}
        />
      )}
      <Grid cols="1.4/1">
        <div className="min-w-0">
          <Toolbar>
            <SearchInput value={list.q} onChange={list.setQ} placeholder="Name or type" className="w-full md:w-64" />
          </Toolbar>
          <Chips
            value={status}
            onChange={(v) => setStatus(v as "all" | LeaveStatus)}
            options={[["all", "All"], ["submitted", "Pending"], ["approved", "Approved"], ["rejected", "Rejected"], ["cancelled", "Cancelled"]]}
          />
          <DataView
            title="Requests"
            rows={list.rows}
            rowKey={(r) => r.leave_request_id}
            loading={list.loading}
            error={list.error}
            selectedKey={sel?.leave_request_id}
            onRowClick={(r) => setSelected(r)}
            empty={{ title: "No Leave Requests", text: "Requests appear here once made." }}
            columns={[
              { key: "e", label: "Employee", render: (r) => <Who name={r.employee.display_name} sub={r.employee.department ?? undefined} src={photo(r.employee.photo_url)} /> },
              { key: "t", label: "Type", render: (r) => r.leave_type_name },
              { key: "f", label: "From", render: (r) => formatDate(r.starts_on) },
              { key: "o", label: "To", render: (r) => formatDate(r.ends_on) },
              { key: "d", label: "Days", align: "n", render: (r) => r.days },
              { key: "s", label: "Status", render: statusPill },
            ]}
            footer={<Pager page={list.page} onPage={list.setPage} noun="request" />}
          />
        </div>
        {sel ? (
          <RequestCard key={sel.leave_request_id} leave={sel} onDone={() => setSelected(null)} />
        ) : (
          <Card>
            <p className="text-xs text-subtle-foreground">Select a request to check cover.</p>
          </Card>
        )}
      </Grid>
    </>
  );
}

/** One request: its details, who else is away, and the decision when it waits on the reader. */
function RequestCard({ leave: r, onDone }: { leave: LeaveRequest; onDone: () => void }) {
  const me = useMe();
  const modal = useModal();
  const confirm = useConfirm();
  const clashes = usePaged("GET /api/v1/leave/requests/:id/clashes", { params: { id: r.leave_request_id } });
  const approve = useMutation("POST /api/v1/workflow/instances/:id/approve");
  const cancel = useMutation("POST /api/v1/leave/requests/:id/cancel");
  const grants = me.grants.people ?? [];
  const waiting = r.status === "submitted" && r.workflow_instance_id;
  const cancellable = r.status === "approved" && r.ends_on >= todayIso() && grants.includes("edit");

  const done = (text: string) => {
    invalidate("/api/v1/leave");
    invalidate("/api/v1/workflow");
    toast(text);
    onDone();
  };
  const yes = async () => {
    try {
      await approve.run({ params: { id: r.workflow_instance_id! }, body: {} });
      done(`Approved. ${r.employee.display_name} has been told.`);
    } catch (e) {
      say(e);
    }
  };
  const no = () =>
    modal.open({
      title: "Reject Leave",
      body: (close) => (
        <RejectForm
          instanceId={r.workflow_instance_id!}
          close={close}
          onDone={() => done(`Rejected. ${r.employee.display_name} has been told.`)}
        />
      ),
    });
  const stop = async () => {
    if (!(await confirm({ title: "Cancel Leave", body: `${r.employee.display_name} is told it is cancelled.`, confirmLabel: "Cancel Leave", cancelLabel: "Keep It", destructive: true }))) return;
    try {
      await cancel.run({ params: { id: r.leave_request_id }, body: {} });
      done("Leave cancelled");
    } catch (e) {
      say(e);
    }
  };

  return (
    <Card>
      <CardHeader title="Request" />
      <KeyValue
        items={[
          ["Employee", r.employee.display_name],
          ["Type", r.leave_type_name],
          ["From", formatDate(r.starts_on)],
          ["To", formatDate(r.ends_on)],
          ["Days", dayCount(r.days)],
          ["Status", statusPill(r)],
          ...(r.waiting_on ? ([["Waiting On", r.waiting_on]] as Array<[string, string]>) : []),
          ...(r.recorded ? ([["Recorded By", "People"]] as Array<[string, string]>) : []),
          ...(r.reason ? ([["Reason", r.reason]] as Array<[string, string]>) : []),
        ]}
      />
      <div className="mt-3">
        <CardHeader title="Also Away" />
        {clashes.rows.length ? (
          <>
            <TapList
              items={clashes.rows.map((c) => ({
                key: c.leave_request_id,
                title: c.employee.display_name,
                sub: `${formatDate(c.starts_on)} to ${formatDate(c.ends_on)}`,
                right: statusPill(c),
              }))}
            />
            <Pager page={clashes.page} onPage={clashes.setPage} noun="request" />
          </>
        ) : (
          <p className="text-2xs text-subtle-foreground">{clashes.loading ? "Checking" : "Nobody else in the department"}</p>
        )}
      </div>
      {waiting && grants.includes("approve") && (
        <div className="mt-3 flex gap-2">
          <Grow />
          <Button onClick={no}>Reject</Button>
          <Button variant="primary" icon="ok" busy={approve.pending} onClick={yes}>
            Approve
          </Button>
        </div>
      )}
      {cancellable && (
        <div className="mt-3 flex gap-2">
          <Grow />
          <Button busy={cancel.pending} onClick={stop}>
            Cancel Leave
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Rejecting needs a reason: the person is told why. */
function RejectForm({ instanceId, close, onDone }: { instanceId: string; close: () => void; onDone: () => void }) {
  const f = useContractForm({ reason: "" }, workflow.ReasonBody);
  const reject = useMutation("POST /api/v1/workflow/instances/:id/reject");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await reject.run({ params: { id: instanceId }, body: { reason: f.values.reason.trim() } });
      close();
      onDone();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Reason" {...f.field("reason")}>
        <TextAreaField {...f.field("reason")} placeholder="Team is short" />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={reject.pending} onClick={submit}>
          Reject Leave
        </Button>
      </FormFooter>
    </>
  );
}

/** This month's approved leave, one name per day. */
function LeaveCalendar() {
  const now = todayIso();
  const y = Number(now.slice(0, 4));
  const m = Number(now.slice(5, 7)) - 1;
  const first = `${now.slice(0, 7)}-01`;
  const last = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  const list = usePaged("GET /api/v1/leave/requests", { filters: { status: "approved", from: first, to: last }, sort: "starts_on" });
  const events = list.rows.flatMap((r) => {
    const out = [];
    for (let d = new Date(`${r.starts_on}T12:00:00Z`); d <= new Date(`${r.ends_on}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1))
      out.push({ date: d.toISOString().slice(0, 10), label: r.employee.display_name.split(" ")[0] });
    return out;
  });
  return (
    <>
      <Calendar year={y} month={m} events={events} />
      <Pager page={list.page} onPage={list.setPage} noun="request" />
    </>
  );
}

/** Ask for leave (My Leave), or record it for someone (People). */
export function LeaveForm({ close, onBehalf }: { close: () => void; onBehalf?: boolean }) {
  const [who, setWho] = useState<PersonRef[]>([]);
  const [whoError, setWhoError] = useState(false);
  const types = usePaged("GET /api/v1/leave/types", { filters: { active: "true" } });
  const f = useContractForm({ leave_type_id: "", starts_on: "", ends_on: "", reason: "" }, leave.LeaveRequestCreate);
  const ask = useMutation("POST /api/v1/ess/leave");
  const recordIt = useMutation("POST /api/v1/leave/requests");
  const busy = ask.pending || recordIt.pending;

  const submit = async () => {
    const missing = onBehalf && !who.length;
    setWhoError(Boolean(missing));
    if (!f.check() || missing) return;
    const body = {
      leave_type_id: f.values.leave_type_id,
      starts_on: f.values.starts_on,
      ends_on: f.values.ends_on,
      ...(f.values.reason.trim() ? { reason: f.values.reason.trim() } : {}),
    };
    try {
      if (onBehalf) {
        const r = await recordIt.run({ body: { ...body, employee_id: who[0].employee_id } });
        toast(`Leave recorded for ${r.employee.display_name}`);
      } else {
        await ask.run({ body });
        toast("Sent to your line manager");
      }
      invalidate("/api/v1/leave");
      invalidate("/api/v1/ess/leave");
      close();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };

  return (
    <>
      {onBehalf && (
        <Field label="Employee" state={whoError ? "bad" : undefined} message={whoError ? "Pick someone" : undefined}>
          <EmployeePicker
            value={who}
            onChange={(v) => {
              setWho(v);
              setWhoError(false);
            }}
          />
        </Field>
      )}
      <Field label="Leave Type" {...f.field("leave_type_id")}>
        <SelectField
          placeholder={types.loading ? "Loading" : "Pick a type"}
          options={types.rows.map((t) => [t.leave_type_id, t.name])}
          {...f.field("leave_type_id")}
        />
      </Field>
      <Field label="First Day" {...f.field("starts_on")}>
        <DateField {...f.field("starts_on")} min={onBehalf ? undefined : todayIso()} />
      </Field>
      <Field label="Last Day" {...f.field("ends_on")}>
        <DateField {...f.field("ends_on")} min={f.values.starts_on || undefined} />
      </Field>
      <Field label="Note" optional {...f.field("reason")}>
        <TextAreaField {...f.field("reason")} placeholder="Family event" />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={busy} onClick={submit}>
          {onBehalf ? "Record Leave" : "Send Request"}
        </Button>
      </FormFooter>
    </>
  );
}
