import deductions from "@mycity/contract/schemas/deductions.js";
import type { DeductionRow, DeductionSummary } from "@mycity/contract/contract.gen.ts";
import { useState } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import { RESTRICTED_HELP } from "@/features/people/status";
import { EmployeePicker } from "@/features/shared/pickers";
import { hrefFor, useRouter } from "@/lib/router";
import { useScreenAction, useUrlAction } from "@/shell/screen-action";
import { Button, Card, CardHeader, Chips, DataView, type DataViewColumn, DateField, Field, formatMoney, formatMonth, FormFooter, HelpTerm, KeyValue, ListDetail, Money, MoneyField, PageHeader, Pill, SegmentedControl, SelectField, StatStrip, TextAreaField, toast, todayIso, toMoneyString, useContractForm, useModal, useSideBySide, Who } from "@mycity/ui";

/**
 * Payroll · Deductions (docs/guides/payroll.md §2, §3.3, §3.4, §6.6, §10): the money that comes off pay, in one
 * list. Waiting attendance deductions (waived on People · Attendance), fines (accepted for this month, spread
 * over months or waived, and released while no month of one is in a run) and salary advances (recorded here,
 * cancelled while none is in a run). The server pages it at 25 and decides what a row offers the reader
 * (`can_*`); the open month it offers first is the server's too (`open_period`).
 */

type Row = DeductionRow;
type Figure = DeductionSummary["pending_fines"];

const rowKey = (r: Row) => `${r.source}:${r.source_id}`;

const SOURCE: Record<Row["source"], string> = { attendance: "Attendance", fine: "Fine", advance: "Advance" };
const STATUS: Record<Row["status"], { tone: "warn" | "info" | "ok" | "neutral"; text: string }> = {
  pending: { tone: "warn", text: "Pending" },
  active: { tone: "info", text: "Active" },
  settled: { tone: "ok", text: "Settled" },
  waived: { tone: "neutral", text: "Waived" },
};
const STATUS_CHIPS: Array<[Row["status"] | "all", string]> = [
  ["pending", "Pending"],
  ["active", "Active"],
  ["settled", "Settled"],
  ["waived", "Waived"],
  ["all", "All"],
];
const SOURCE_VIEWS: Array<[Row["source"] | "all", string]> = [
  ["all", "All"],
  ["attendance", "Attendance"],
  ["fine", "Fines"],
  ["advance", "Advances"],
];

const LIST_HELP = "Attendance deductions go into the run unless People waive them on People · Attendance. Accept or waive a fine here.";
const SPREAD_HELP = "Equal monthly shares, starting from the month you pick.";
const RELEASE_HELP = "A fine goes back to waiting only before any month of it is in a run.";

/** The first days of `n` months from `first`, as the select offers them: the server's open month, then the months after it. */
function monthsFrom(first: string, n: number): Array<readonly [string, string]> {
  const [y, m] = [Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1];
  return Array.from({ length: n }, (_, i) => {
    const at = new Date(Date.UTC(y, m + i, 1)).toISOString().slice(0, 10);
    return [at, formatMonth(at)] as const;
  });
}

/** How many months a fine may be spread over, or an advance recovered over: one (this month) to twelve. */
const MONTH_COUNTS: Array<readonly [string, string]> = Array.from({ length: 12 }, (_, i) => [String(i + 1), i === 0 ? "1 month" : `${i + 1} months`] as const);
const SPREAD_COUNTS = MONTH_COUNTS.slice(1);

/** An amount as a row shows it: the figure; No Salary Set with no gross; Restricted where the salary is masked from the reader. */
function amountOf(r: Pick<Row, "pay_amount" | "salary_set">) {
  if (r.pay_amount !== null) return <Money value={r.pay_amount} />;
  if (!r.salary_set) return <Pill tone="neutral">No Salary Set</Pill>;
  return (
    <span className="text-subtle-foreground">
      <HelpTerm help={RESTRICTED_HELP}>Restricted</HelpTerm>
    </span>
  );
}

const statusPill = (r: Row) => <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].text}</Pill>;

/** The columns of the list: a phone card holds the person, the reason, the amount and the status; the source and the month stay on desktop. */
function columns(): DataViewColumn<Row>[] {
  return [
    { key: "employee", label: "Employee", sortable: true, render: (r) => <Who name={r.employee.display_name} sub={r.employee.department} /> },
    { key: "reason", label: "Reason", render: (r) => r.reason },
    { key: "source", label: "Source", desktop: true, render: (r) => SOURCE[r.source] },
    { key: "amount", label: "Amount", sortable: true, align: "n", render: amountOf },
    { key: "period", label: "Month", desktop: true, render: (r) => formatMonth(r.period) },
    { key: "status", label: "Status", badge: true, render: statusPill },
  ];
}

const failed = (e: unknown, fallback: string) => toast.error(e instanceof ApiError ? e.message : fallback);

/* ------------------------------------------------------------------ *
 * The screen
 * ------------------------------------------------------------------ */

export default function Deductions() {
  const modal = useModal();
  const beside = useSideBySide();
  const summary = useApi("GET /api/v1/deductions/summary");
  const [status, setStatus] = useState<Row["status"] | "all">("pending");
  const [source, setSource] = useState<Row["source"] | "all">("all");
  const [pick, setPick] = useState<string | null>(null);
  const list = usePaged("GET /api/v1/deductions", { filters: { ...(status !== "all" && { status }), ...(source !== "all" && { source }) } });
  const s = summary.data;
  const open = s?.open_period ?? null;

  const recordAdvance = open ? () => modal.open({ title: "Record Advance", body: (close) => <AdvanceForm open={open} close={close} /> }) : null;
  useScreenAction(recordAdvance ? { label: "Record Advance", onSelect: recordAdvance } : null);
  useUrlAction("advance", recordAdvance);

  // The record in view is the picked row as the list now holds it; beside the list the first row shows unasked (F31).
  const picked = pick ? (list.rows.find((r) => rowKey(r) === pick) ?? null) : null;
  const shown = picked ?? (beside ? (list.rows[0] ?? null) : null);

  const figure = (title: string, f: Figure | undefined, filters: { status?: Row["status"]; source?: Row["source"] }) => ({
    label: title,
    value: f ? f.count : "",
    action: f ? (f.pay_amount === null ? "Restricted" : formatMoney(f.pay_amount)) : undefined,
    onOpen: () => modal.open({ title, wide: true, body: () => <FigureList filters={filters} /> }),
  });

  return (
    <>
      <PageHeader
        title="Deductions"
        sub="Fines, advances and attendance"
        actions={
          <Button variant="primary" icon="plus" onClick={() => recordAdvance?.()}>
            Record Advance
          </Button>
        }
      />
      <StatStrip
        label="Deduction figures"
        items={[
          figure("Pending Fines", s?.pending_fines, { status: "pending", source: "fine" }),
          figure("Pending Attendance", s?.pending_attendance, { status: "pending", source: "attendance" }),
          figure("Active", s?.active, { status: "active" }),
          figure("Recovered This Year", s?.recovered_this_year, { status: "settled" }),
        ]}
      />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Chips
          label="Status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPick(null);
          }}
          options={STATUS_CHIPS}
          className="mb-0"
        />
        <SegmentedControl
          label="Source"
          value={source}
          onChange={(v) => {
            setSource(v);
            setPick(null);
          }}
          options={SOURCE_VIEWS}
          small
        />
      </div>
      <ListDetail
        open={picked !== null}
        onClose={() => setPick(null)}
        title="Deduction"
        list={
          <DataView
            title={status === "pending" ? "Pending Deductions" : "Deductions"}
            help={LIST_HELP}
            list={list}
            search="Name or reason"
            rowKey={rowKey}
            onRowClick={(r) => setPick(rowKey(r))}
            selectedKey={shown ? rowKey(shown) : null}
            noun="deduction"
            empty={{ icon: "check", title: "Nothing Here", text: "Choose All to see every one." }}
            columns={columns()}
          />
        }
        detail={shown && open && <DeductionCard row={shown} open={open} onDone={() => setPick(null)} />}
      />
    </>
  );
}

/** A figure's list, in a pop-up: the rows behind the count, 25 a page. */
function FigureList({ filters }: { filters: { status?: Row["status"]; source?: Row["source"] } }) {
  const list = usePaged("GET /api/v1/deductions", { filters });
  return <DataView bare caption="Deductions" list={list} rowKey={rowKey} noun="deduction" empty={{ icon: "check", title: "Nothing Here" }} columns={columns()} />;
}

/* ------------------------------------------------------------------ *
 * A deduction, opened
 * ------------------------------------------------------------------ */

/** What a row says about itself, and the buttons the reader may press on it. */
function DeductionCard({ row, open, onDone }: { row: Row; open: string; onDone: () => void }) {
  const modal = useModal();
  const { navigate } = useRouter();
  const accept = useMutation("POST /api/v1/deductions/fines/:sanction_fine_id/accept");
  const done = () => {
    invalidate("/api/v1/deductions");
    onDone();
  };
  // Accept This Month: one instalment, in the open month the server named.
  const acceptThisMonth = async () => {
    try {
      await accept.run({ params: { sanction_fine_id: row.source_id }, body: { months: 1, start_period: open } });
      done();
      toast("Fine accepted for this month");
    } catch (e) {
      failed(e, "Fine not accepted");
    }
  };
  const items: Array<[string, React.ReactNode]> = [
    ["Employee", <Who key="e" name={row.employee.display_name} sub={row.employee.department} />],
    ["Reason", row.reason],
    ["Source", SOURCE[row.source]],
    ["Amount", amountOf(row)],
    ["Month", formatMonth(row.period)],
    ["Status", statusPill(row)],
  ];
  if (row.instalments !== null) items.push(["Recovered", `${row.instalments_applied ?? 0} of ${row.instalments} ${row.instalments === 1 ? "month" : "months"}`]);
  if (row.query_number) items.push(["Query", row.query_number]);
  const actions = row.can_accept || row.can_waive || row.can_release || row.can_cancel || row.source === "attendance";
  return (
    <Card>
      <CardHeader record title={row.employee.display_name} right={statusPill(row)} />
      <KeyValue items={items} />
      {actions && (
        <FormFooter>
          {row.source === "attendance" && (
            <Button onClick={() => navigate(hrefFor("people", "attendance"))}>Open Attendance</Button>
          )}
          {row.can_waive && (
            <Button onClick={() => modal.open({ title: "Waive Fine", body: (close) => <ReasonForm kind="waive" row={row} close={close} onDone={done} /> })}>Waive</Button>
          )}
          {row.can_accept && (
            <Button onClick={() => modal.open({ title: "Spread Fine", body: (close) => <SpreadForm row={row} open={open} close={close} onDone={done} /> })}>Spread Over Months</Button>
          )}
          {row.can_accept && (
            <Button variant="primary" onClick={acceptThisMonth}>
              Accept This Month
            </Button>
          )}
          {row.can_release && (
            <Button onClick={() => modal.open({ title: "Release Fine", body: (close) => <ReasonForm kind="release" row={row} close={close} onDone={done} /> })}>Release</Button>
          )}
          {row.can_cancel && (
            <Button onClick={() => modal.open({ title: "Cancel Advance", body: (close) => <ReasonForm kind="cancel" row={row} close={close} onDone={done} /> })}>Cancel Advance</Button>
          )}
        </FormFooter>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Forms
 * ------------------------------------------------------------------ */

type Reasoned = "waive" | "release" | "cancel";

const REASON_WORDS: Record<Reasoned, { button: string; keep: string; done: string; failed: string; placeholder: string }> = {
  waive: { button: "Waive Fine", keep: "Cancel", done: "Fine waived", failed: "Fine not waived", placeholder: "Settled in review" },
  release: { button: "Release Fine", keep: "Cancel", done: "Fine sent back to waiting", failed: "Fine not released", placeholder: "Wrong month chosen" },
  cancel: { button: "Cancel Advance", keep: "Keep Advance", done: "Advance cancelled", failed: "Advance not cancelled", placeholder: "Recorded in error" },
};

/** Waive a pending fine, release an accepted one or cancel an advance: each takes the reason the person reads (10 to 500 characters). */
function ReasonForm({ kind, row, close, onDone }: { kind: Reasoned; row: Row; close: () => void; onDone: () => void }) {
  const f = useContractForm({ reason: "" }, deductions.DeductionWaive);
  const waive = useMutation("POST /api/v1/deductions/fines/:sanction_fine_id/waive");
  const release = useMutation("POST /api/v1/deductions/:id/release");
  const cancel = useMutation("POST /api/v1/deductions/:id/cancel");
  const words = REASON_WORDS[kind];
  const pending = waive.pending || release.pending || cancel.pending;
  const submit = async () => {
    if (!f.check()) return;
    const body = { reason: f.values.reason.trim() };
    try {
      if (kind === "waive") await waive.run({ params: { sanction_fine_id: row.source_id }, body });
      else if (kind === "release") await release.run({ params: { id: row.payroll_deduction_id ?? row.source_id }, body });
      else await cancel.run({ params: { id: row.payroll_deduction_id ?? row.source_id }, body });
      onDone();
      close();
      toast(words.done);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else failed(e, words.failed);
    }
  };
  return (
    <>
      <Field label="Reason" help={kind === "release" ? RELEASE_HELP : undefined} {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} placeholder={words.placeholder} rows={3} />
      </Field>
      <FormFooter>
        <Button onClick={close}>{words.keep}</Button>
        <Button variant="primary" busy={pending} onClick={submit}>
          {words.button}
        </Button>
      </FormFooter>
    </>
  );
}

type SpreadValues = { months: string; start_period: string };

/** Spread Over Months: two to twelve equal instalments from the month picked, which is the open month or a later one. */
function SpreadForm({ row, open, close, onDone }: { row: Row; open: string; close: () => void; onDone: () => void }) {
  const f = useContractForm<SpreadValues>({ months: "3", start_period: open }, { safeParse: (v: SpreadValues) => deductions.DeductionAccept.safeParse({ months: Number(v.months), start_period: v.start_period }) });
  const accept = useMutation("POST /api/v1/deductions/fines/:sanction_fine_id/accept");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await accept.run({ params: { sanction_fine_id: row.source_id }, body: { months: Number(f.values.months), start_period: f.values.start_period } });
      onDone();
      close();
      toast("Deduction scheduled");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else failed(e, "Fine not accepted");
    }
  };
  return (
    <>
      <Field label="Months" help={SPREAD_HELP} {...f.status("months")}>
        <SelectField options={SPREAD_COUNTS} {...f.field("months")} />
      </Field>
      <Field label="Start Month" {...f.status("start_period")}>
        <SelectField options={monthsFrom(open, 13)} {...f.field("start_period")} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={accept.pending} onClick={submit}>
          Spread Fine
        </Button>
      </FormFooter>
    </>
  );
}

type AdvanceValues = { amount: string; granted_on: string; months: string; start_period: string; reason: string };

/** Record Advance: salary paid to a person ahead of its month, outside this system, and the months it is recovered over. */
function AdvanceForm({ open, close }: { open: string; close: () => void }) {
  const [who, setWho] = useState<PersonRef[]>([]);
  const [tried, setTried] = useState(false);
  const bodyOf = (v: AdvanceValues) => ({
    employee_id: who[0]?.employee_id ?? "",
    amount: toMoneyString(v.amount),
    granted_on: v.granted_on,
    months: Number(v.months),
    start_period: v.start_period,
    reason: v.reason.trim(),
  });
  const f = useContractForm<AdvanceValues>(
    { amount: "", granted_on: "", months: "2", start_period: open, reason: "" },
    {
      // The person is the picker's, checked beside the fields; the rest are the contract's own.
      safeParse: (v: AdvanceValues) => {
        const r = deductions.AdvanceRecord.safeParse(bodyOf(v));
        return r.success ? r : { ...r, error: { ...r.error, issues: r.error.issues.filter((i) => i.path[0] !== "employee_id") } };
      },
    },
  );
  const save = useMutation("POST /api/v1/deductions/advances");
  const submit = async () => {
    setTried(true);
    const clean = f.check();
    if (!clean || !who[0]) return;
    try {
      await save.run({ body: bodyOf(f.values) });
      invalidate("/api/v1/deductions");
      close();
      toast("Advance recorded");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else failed(e, "Advance not recorded");
    }
  };
  return (
    <>
      <Field label="Employee" state={tried && !who[0] ? "bad" : undefined} message="Pick a person">
        <EmployeePicker value={who} onChange={setWho} placeholder="Search people" />
      </Field>
      <Field label="Amount" {...f.status("amount")}>
        <MoneyField {...f.field("amount")} />
      </Field>
      <Field label="Paid On" {...f.status("granted_on")}>
        <DateField {...f.field("granted_on")} max={todayIso()} />
      </Field>
      <Field label="Months" help={SPREAD_HELP} {...f.status("months")}>
        <SelectField options={MONTH_COUNTS} {...f.field("months")} />
      </Field>
      <Field label="Start Month" {...f.status("start_period")}>
        <SelectField options={monthsFrom(open, 13)} {...f.field("start_period")} />
      </Field>
      <Field label="Reason" {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} placeholder="School fees" rows={2} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>
          Record Advance
        </Button>
      </FormFooter>
    </>
  );
}
