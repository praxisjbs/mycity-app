import payroll from "@mycity/contract/schemas/payroll.js";
import workflow from "@mycity/contract/schemas/workflow.js";
import type { PayrollAdjustment, PayrollProblem, PayrollRun, Payslip } from "@mycity/contract/contract.gen.ts";
import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "@/api/client";
import { saveExport } from "@/api/exports";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import { EmployeePicker } from "@/features/shared/pickers";
import { PagedTable } from "@/features/shared/sections";
import { useScreenAction } from "@/shell/screen-action";
import {
  AreaChart,
  Banner,
  Button,
  Card,
  CardHeader,
  Chain,
  ChoiceField,
  DataView,
  DateField,
  DesktopOnly,
  DetailPane,
  ErrorState,
  ExportButton,
  Field,
  formatDate,
  formatMoney,
  formatMonth,
  FormFooter,
  Grid,
  HelpTerm,
  IconButton,
  KeyValue,
  KpiCard,
  LoadingRows,
  MoneyField,
  MonthField,
  PageHeader,
  Pager,
  Pill,
  TextAreaField,
  TextField,
  toast,
  todayIso,
  toMoneyString,
  useConfirm,
  useContractForm,
  useIsPhone,
  useModal,
  Who,
} from "@mycity/ui";
import { amount, failed, landed, RUN_STATUSES, RUN_WORDS, runPill, usePayrollGrant } from "./parts";

/**
 * Payroll · Payroll Runs (docs/guides/payroll.md §2, §3.1, §6.9, §6.15, §10): one month's run, opened by picking the
 * month, computed, its problems read and dealt with, sent to the CEO, decided, emailed and downloaded, and marked paid;
 * and every run before it. The open run (the one not yet paid, else the latest) sits above Run History on desktop, and
 * a run picked from the history takes its place; on a phone the open run's figures, its chain and its problem line head
 * the page and a tapped run opens in a sheet with its actions (F31, `DetailPane`). What the reader may press is the
 * server's (`can_*`, and the grants for what the run carries none for); every refusal is the API's own.
 */

const STATUS_HELP = "Draft and Computed can still change. Submitted waits on the CEO. Approved is locked and its payslips are published. Paid means the money was sent.";
const BLOCKING_HELP = "A blocking problem stops Submit for Approval until it is fixed. Warnings never stop it.";
const ADJUSTMENT_HELP = "A one-off earning or deduction for one person in this run. A correction to a locked month goes into the next run.";
const SEND_BACK_HELP = "Returns the run to Draft with your reason and releases everything it froze.";

/** After a press: every read of runs, payslips and the approval reloads, so the screen shows what now stands. */
const refresh = (_changed?: unknown) => invalidate("/api/v1/payroll", "/api/v1/payslips", "/api/v1/workflow");

/**
 * A decision reaches the run after it commits (the outbox handlers `payroll.apply_decision` and `payroll.sent_back`,
 * §7), so the press waits until the run has left Submitted, ten seconds at most, before the screen reads it again.
 */
async function decided(id: string) {
  for (let i = 0; i < 20; i += 1) {
    const r = await api.call("GET /api/v1/payroll/runs/:id", { params: { id } });
    if (r.status !== "submitted") return;
    await new Promise((done) => setTimeout(done, 500));
  }
}

/** The chain a run walks, with where it stands now. */
const lifeOf = (status: PayrollRun["status"]) => {
  const at = RUN_STATUSES.indexOf(status);
  return RUN_STATUSES.map((s, i) => ({ label: RUN_WORDS[s], state: i < at || status === "paid" ? ("done" as const) : i === at ? ("now" as const) : undefined }));
};

/** Who has the run now: the approver it waits on, else the people who move it on; nobody once it is paid. */
function waitingOn(r: PayrollRun): string | null {
  if (r.status === "paid") return null;
  if (r.status !== "submitted") return "Operations & People";
  const now = r.chain.find((s) => s.state === "now");
  return now ? now.approvers.map((a) => a.label).join(", ") || now.name : "CEO";
}

/* ------------------------------------------------------------------ *
 * The screen
 * ------------------------------------------------------------------ */

export default function PayRuns({ id }: { id: string | null }) {
  const modal = useModal();
  const phone = useIsPhone();
  const mayCreate = usePayrollGrant("create");
  const summary = useApi("GET /api/v1/payroll/runs/summary");
  const list = usePaged("GET /api/v1/payroll/runs");
  const [pick, setPick] = useState<string | null>(id);
  useEffect(() => setPick(id), [id]);
  const current = summary.data?.current ?? null;
  // On desktop the open run shows unasked above the history; on a phone a run opens only when it is tapped (F31).
  const shown = pick ?? (phone ? null : (current?.payroll_run_id ?? null));
  // The subtitle names the month of the run in view, as far as the page knows it.
  const inView = list.rows.find((r) => r.payroll_run_id === shown) ?? current;

  const newRun = mayCreate ? () => modal.open({ title: "New Run", body: (close) => <NewRunForm close={close} opened={(r) => setPick(r.payroll_run_id)} /> }) : null;
  useScreenAction(newRun ? { label: "New Run", onSelect: newRun } : null);

  if (summary.error) return <ErrorState error={summary.error} onRetry={summary.reload} />;
  return (
    <>
      <PageHeader
        title="Payroll Runs"
        sub={inView ? formatMonth(inView.period) : " "}
        actions={
          newRun && (
            <Button variant="primary" icon="plus" onClick={newRun}>
              New Run
            </Button>
          )
        }
      />
      {phone && current && <RunGlance run={current} />}
      <DetailPane open={pick !== null} onClose={() => setPick(null)} title="Payroll Run" full>
        {shown ? <RunCard id={shown} gone={() => setPick(null)} /> : summary.data && !current ? <NoRuns newRun={newRun} /> : null}
      </DetailPane>
      <div className="mt-3">
        <PagedTable<PayrollRun>
          title="Run History"
          list={list}
          rowKey={(r) => r.payroll_run_id}
          selectedKey={shown ?? undefined}
          onRowClick={(r) => setPick(r.payroll_run_id)}
          noun="run"
          empty={{ title: "No Runs Yet", text: "Open a month with New Run." }}
          columns={[
            { key: "m", label: "Month", render: (r) => <span className="font-semibold">{formatMonth(r.period)}</span> },
            { key: "s", label: "Staff", align: "n", render: (r) => r.headcount },
            { key: "g", label: "Gross", align: "n", desktop: true, render: (r) => amount(r.gross_pay) },
            { key: "n", label: "Net", align: "n", render: (r) => amount(r.net_pay) },
            { key: "a", label: "Approved By", desktop: true, render: (r) => r.approved_by_name ?? "Not yet" },
            { key: "st", label: <HelpTerm help={STATUS_HELP}>Status</HelpTerm>, badge: true, render: (r) => runPill(r.status) },
          ]}
        />
      </div>
      <DesktopOnly>
        <Grid cols={2} className="mt-3">
          {summary.data ? (
            summary.data.trend.some((t) => t.net_pay !== null) && (
              <AreaChart
                title="Net Payroll by Month"
                values={summary.data.trend.map((t) => Number(t.net_pay ?? 0))}
                labels={summary.data.trend.map((t) => formatMonth(t.period))}
                format={(v) => formatMoney(v.toFixed(2))}
              />
            )
          ) : (
            <Card>
              <LoadingRows />
            </Card>
          )}
        </Grid>
      </DesktopOnly>
    </>
  );
}

function NoRuns({ newRun }: { newRun: (() => void) | null }) {
  return (
    <Card>
      <CardHeader title="This Run" />
      <p className="text-sm text-subtle-foreground">No run is open.</p>
      {newRun && (
        <FormFooter>
          <Button variant="primary" icon="plus" onClick={newRun}>
            New Run
          </Button>
        </FormFooter>
      )}
    </Card>
  );
}

/** The open run at the head of a phone's page: Staff in Run and Net, the chain down the page, the problem line. */
function RunGlance({ run }: { run: PayrollRun }) {
  return (
    <div className="mb-3 flex flex-col gap-3">
      <Grid cols="4m2">
        <KpiCard title="Staff in Run" value={run.headcount} />
        <KpiCard title="Net" value={amount(run.net_pay, true)} tone="ok" />
      </Grid>
      <Chain stack label={`${formatMonth(run.period)} run`} steps={lifeOf(run.status)} />
      <ProblemLine run={run} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * A run, opened
 * ------------------------------------------------------------------ */

function RunCard({ id, gone }: { id: string; gone: () => void }) {
  const phone = useIsPhone();
  const d = useApi("GET /api/v1/payroll/runs/:id", { params: { id } });
  if (d.error) return <ErrorState error={d.error} onRetry={d.reload} />;
  if (!d.data)
    return (
      <Card>
        <LoadingRows />
      </Card>
    );
  const r = d.data;
  const open = r.status === "draft" || r.status === "computed";
  const facts: Array<[ReactNode, ReactNode]> = [["Number", r.number]];
  const holder = waitingOn(r);
  if (holder) facts.push(["Waiting On", holder]);
  if (r.submitted_by_name) facts.push(["Submitted By", `${r.submitted_by_name}${r.submitted_at ? `, ${formatDate(r.submitted_at)}` : ""}`]);
  if (r.approved_by_name) facts.push(["Approved By", `${r.approved_by_name}${r.approved_at ? `, ${formatDate(r.approved_at)}` : ""}`]);
  if (r.paid_on) facts.push(["Paid On", `${formatDate(r.paid_on)}${r.payment_reference ? `, ${r.payment_reference}` : ""}`]);
  if (r.returned_reason && open) facts.push(["Sent Back", <span key="b" data-copy="content">{r.returned_reason}</span>]);
  return (
    <Card>
      <CardHeader record title={`${formatMonth(r.period)} Run`} right={runPill(r.status)} />
      <Grid cols="4m2">
        <KpiCard title="Staff in Run" value={r.headcount} />
        <KpiCard title="Gross" value={amount(r.gross_pay, true)} />
        <KpiCard title="Deductions" value={amount(r.total_deductions, true)} tone="warn" />
        <KpiCard title="Net" value={amount(r.net_pay, true)} tone="ok" />
      </Grid>
      <div className="mt-3">
        <Chain stack={phone} label={`${formatMonth(r.period)} run`} steps={lifeOf(r.status)} />
      </div>
      <div className="mt-3">
        <KeyValue items={facts} />
      </div>
      <ProblemLine run={r} />
      <Adjustments run={r} />
      {open && <LeftOut run={r} />}
      <RunActions run={r} gone={gone} />
    </Card>
  );
}

/** The problem line: how many problems block Submit and how many are warnings, with Open. */
function ProblemLine({ run }: { run: PayrollRun }) {
  const modal = useModal();
  const open = run.status === "draft" || run.status === "computed";
  if (!open || run.blocking_problems + run.warnings === 0) return null;
  const words = `${run.blocking_problems} blocking, ${run.warnings} ${run.warnings === 1 ? "warning" : "warnings"}`;
  return (
    <Banner
      className="mt-3"
      tone={run.blocking_problems ? "err" : "warn"}
      action={
        <Button size="sm" onClick={() => modal.open({ title: "Run Problems", wide: true, body: () => <Problems run={run} /> })}>
          Open
        </Button>
      }
    >
      <HelpTerm help={BLOCKING_HELP}>{words}</HelpTerm>
    </Banner>
  );
}

/** A run's problems, blocking first, 25 a page; a person in one can be left out of the run from here. */
function Problems({ run }: { run: PayrollRun }) {
  const modal = useModal();
  const list = usePaged("GET /api/v1/payroll/runs/:id/problems", { params: { id: run.payroll_run_id } });
  const mayEdit = run.can_compute;
  return (
    <DataView
      bare
      caption="Run Problems"
      list={list}
      rowKey={(p) => `${p.code}:${p.payslip_id ?? ""}`}
      noun="problem"
      empty={{ icon: "check", title: "No Problems" }}
      columns={[
        { key: "w", label: "Employee", render: (p: PayrollProblem) => (p.employee ? <Who name={p.employee.display_name} sub={p.employee.department} /> : "The run") },
        { key: "m", label: "Problem", render: (p: PayrollProblem) => <span data-copy="content">{p.message}</span> },
        { key: "a", label: "Fix", desktop: true, render: (p: PayrollProblem) => <span data-copy="content">{p.action}</span> },
        { key: "s", label: "Severity", badge: true, render: (p: PayrollProblem) => <Pill tone={p.severity === "blocking" ? "err" : "warn"}>{p.severity === "blocking" ? "Blocking" : "Warning"}</Pill> },
        {
          key: "x",
          label: "",
          render: (p: PayrollProblem) => {
            const who = p.employee;
            return mayEdit && who ? (
              <Button size="sm" onClick={() => modal.open({ title: "Exclude Person", body: (close) => <ExcludeForm run={run} person={who} close={close} /> })}>
                Exclude
              </Button>
            ) : null;
          },
        },
      ]}
    />
  );
}

/** The run's adjustments, with Add Adjustment while it may change. */
function Adjustments({ run }: { run: PayrollRun }) {
  const modal = useModal();
  const confirm = useConfirm();
  const list = usePaged("GET /api/v1/payroll/runs/:id/adjustments", { params: { id: run.payroll_run_id } });
  const remove = useMutation("DELETE /api/v1/payroll/runs/:id/adjustments/:adjustment_id");
  const editable = run.can_compute;
  if (!editable && list.rows.length === 0) return null;
  const drop = async (a: PayrollAdjustment) => {
    if (!(await confirm({ title: "Remove Adjustment", body: `${a.label} for ${a.employee.display_name} comes off this run.`, confirmLabel: "Remove Adjustment", cancelLabel: "Keep It", destructive: true }))) return;
    try {
      await remove.run({ params: { id: run.payroll_run_id, adjustment_id: a.payroll_adjustment_id } });
      refresh();
      toast("Adjustment removed");
    } catch (e) {
      failed(e, "Adjustment not removed");
    }
  };
  return (
    <div className="mt-3">
      <CardHeader
        title={<HelpTerm help={ADJUSTMENT_HELP}>Adjustments</HelpTerm>}
        right={
          editable && (
            <Button size="sm" icon="plus" onClick={() => modal.open({ title: "Add Adjustment", body: (close) => <AdjustmentForm run={run} close={close} /> })}>
              Add Adjustment
            </Button>
          )
        }
      />
      {list.rows.length > 0 && (
        <DataView
          bare
          caption="Adjustments"
          list={list}
          rowKey={(a) => a.payroll_adjustment_id}
          noun="adjustment"
          columns={[
            { key: "e", label: "Employee", render: (a: PayrollAdjustment) => <Who name={a.employee.display_name} sub={a.employee.department} /> },
            { key: "l", label: "Label", render: (a: PayrollAdjustment) => <span data-copy="content">{a.label}</span> },
            { key: "k", label: "Kind", desktop: true, render: (a: PayrollAdjustment) => (a.kind === "earning" ? "Earning" : "Deduction") },
            { key: "a", label: "Amount", align: "n", render: (a: PayrollAdjustment) => amount(a.pay_amount) },
            { key: "x", label: "", render: (a: PayrollAdjustment) => (editable ? <IconButton icon="trash" label={`Remove ${a.label}`} onClick={() => drop(a)} /> : null) },
          ]}
        />
      )}
    </div>
  );
}

/** The people left out of the run, each with Include while it may change. */
function LeftOut({ run }: { run: PayrollRun }) {
  const list = usePaged("GET /api/v1/payslips", { filters: { run_id: run.payroll_run_id, status: "excluded" } });
  const include = useMutation("POST /api/v1/payroll/runs/:id/include");
  if (list.rows.length === 0) return null;
  const back = async (p: Payslip) => {
    try {
      refresh(await include.run({ params: { id: run.payroll_run_id }, body: { employee_id: p.employee.employee_id } }));
      toast(`${p.employee.display_name} is back in the run`);
    } catch (e) {
      failed(e, "Person not included");
    }
  };
  return (
    <div className="mt-3">
      <CardHeader title="Left Out" />
      <DataView
        bare
        caption="Left Out"
        rows={list.rows}
        rowKey={(p) => p.payslip_id}
        columns={[
          { key: "e", label: "Employee", render: (p: Payslip) => <Who name={p.employee.display_name} sub={p.employee.department} /> },
          { key: "r", label: "Reason", render: (p: Payslip) => <span data-copy="content">{p.excluded_reason}</span> },
          { key: "x", label: "", render: (p: Payslip) => (run.can_compute ? <Button size="sm" onClick={() => back(p)}>Include</Button> : null) },
        ]}
        footer={<Pager page={list.page} onPage={list.setPage} noun="person" nounPlural="people" label="Left Out" />}
      />
    </div>
  );
}

/** Every press the reader may make on the run now, the main one last (full width in the sheet's footer on a phone). */
function RunActions({ run, gone }: { run: PayrollRun; gone: () => void }) {
  const modal = useModal();
  const confirm = useConfirm();
  const mayEdit = usePayrollGrant("edit");
  const mayExport = usePayrollGrant("export");
  const compute = useMutation("POST /api/v1/payroll/runs/:id/compute");
  const submit = useMutation("POST /api/v1/payroll/runs/:id/submit");
  const approve = useMutation("POST /api/v1/workflow/instances/:id/approve");
  const discard = useMutation("DELETE /api/v1/payroll/runs/:id");
  const email = useMutation("POST /api/v1/payroll/runs/:id/email-payslips");
  const id = run.payroll_run_id;
  const month = formatMonth(run.period);
  const out = run.status === "approved" || run.status === "paid";
  const open = run.status === "draft" || run.status === "computed";

  const computeRun = async () => {
    try {
      refresh(await compute.run({ params: { id }, body: {} }));
      toast("Run computed");
    } catch (e) {
      failed(e, "Run not computed");
    }
  };
  const submitRun = async () => {
    try {
      refresh(await submit.run({ params: { id }, body: run.net_pay ? { expected_net_total: run.net_pay } : {} }));
      toast("Sent for approval");
    } catch (e) {
      // A changed total or a problem is answered after the run computed again: what now stands is read back.
      refresh();
      failed(e, "Run not sent");
    }
  };
  const approveRun = async () => {
    if (!run.workflow_instance_id) return;
    if (!(await confirm({ title: "Approve Run", body: `${month} locks and its payslips publish.`, confirmLabel: "Approve Run", cancelLabel: "Not Yet" }))) return;
    try {
      await approve.run({ params: { id: run.workflow_instance_id }, body: {} });
      await decided(id);
      refresh();
      toast(`${month} approved`);
    } catch (e) {
      failed(e, "Run not approved");
    }
  };
  const discardRun = async () => {
    if (!(await confirm({ title: "Discard Run", body: `${month} and its payslips are deleted.`, confirmLabel: "Discard Run", cancelLabel: "Keep Run", destructive: true }))) return;
    try {
      await discard.run({ params: { id } });
      gone();
      refresh();
      toast("Run discarded");
    } catch (e) {
      failed(e, "Run not discarded");
    }
  };
  const emailAll = async () => {
    try {
      const sent = await email.run({ params: { id }, body: { resend: false } });
      if (sent.queued > 0) return void toast("Payslips are being emailed");
      if (!(await confirm({ title: "Email Again", body: "Everyone has had their payslip. Send it to everyone again?", confirmLabel: "Email Again", cancelLabel: "Not Now" }))) return;
      await email.run({ params: { id }, body: { resend: true } });
      refresh();
      toast("Payslips are being emailed");
    } catch (e) {
      failed(e, "Payslips not emailed");
    }
  };
  const files = (path: "payslips-export" | "statutory-report") => () => saveExport(api.call(`POST /api/v1/payroll/runs/:id/${path}` as "POST /api/v1/payroll/runs/:id/payslips-export", { params: { id }, body: {} }));

  const buttons: ReactNode[] = [];
  if (run.can_discard) buttons.push(<Button key="discard" variant="danger" onClick={discardRun}>Discard</Button>);
  if (open && mayEdit) buttons.push(<Button key="exclude" onClick={() => modal.open({ title: "Exclude Person", body: (close) => <ExcludeForm run={run} close={close} /> })}>Exclude</Button>);
  if (run.can_compute) buttons.push(<Button key="compute" variant={run.can_submit ? undefined : "primary"} icon="rotate" onClick={computeRun}>Compute Run</Button>);
  if (out && mayEdit) buttons.push(<Button key="email" icon="mail" onClick={emailAll}>Email All Payslips</Button>);
  if (out && mayExport) buttons.push(<ExportButton key="all" message="Payslips downloaded" onExport={files("payslips-export")}>Download All</ExportButton>);
  if (out && run.advanced && mayExport) buttons.push(<ExportButton key="statutory" message="Report downloaded" onExport={files("statutory-report")}>Statutory Report</ExportButton>);
  if (run.can_decide && run.workflow_instance_id) {
    const wid = run.workflow_instance_id;
    buttons.push(<Button key="reject" variant="danger" onClick={() => modal.open({ title: "Reject Run", body: (close) => <DecisionForm run={run} wid={wid} verb="reject" close={close} /> })}>Reject</Button>);
    buttons.push(<Button key="back" onClick={() => modal.open({ title: "Send Back", body: (close) => <DecisionForm run={run} wid={wid} verb="request-changes" close={close} /> })}>Send Back</Button>);
    buttons.push(<Button key="approve" variant="primary" icon="ok" onClick={approveRun}>Approve</Button>);
  }
  if (run.can_submit) buttons.push(<Button key="submit" variant="primary" onClick={submitRun}>Submit for Approval</Button>);
  if (run.can_pay) buttons.push(<Button key="paid" variant="primary" onClick={() => modal.open({ title: "Mark Paid", body: (close) => <PaidForm run={run} close={close} /> })}>Mark Paid</Button>);
  if (buttons.length === 0) return null;
  return <FormFooter>{buttons}</FormFooter>;
}

/* ------------------------------------------------------------------ *
 * Forms
 * ------------------------------------------------------------------ */

/** New Run: the month, picked; one run a month, never a month still to come. */
function NewRunForm({ close, opened }: { close: () => void; opened: (r: PayrollRun) => void }) {
  const f = useContractForm({ period: `${todayIso().slice(0, 7)}-01` }, payroll.PayrollRunCreate);
  const create = useMutation("POST /api/v1/payroll/runs");
  const submit = async () => {
    if (!f.check()) return;
    try {
      const r = await create.run({ body: { period: f.values.period } });
      refresh();
      close();
      opened(r);
      toast(`Run opened for ${formatMonth(r.period)}`);
    } catch (e) {
      landed(e, f.setServerErrors, "Run not opened");
    }
  };
  return (
    <>
      <Field label="Month" {...f.status("period")}>
        <MonthField max={todayIso()} {...f.field("period")} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>
          Open Run
        </Button>
      </FormFooter>
    </>
  );
}

type AdjustmentValues = { kind: "earning" | "deduction"; label: string; amount: string; reason: string };
const KINDS: Array<readonly [AdjustmentValues["kind"], string]> = [
  ["earning", "Earning"],
  ["deduction", "Deduction"],
];

/** Add Adjustment: a one-off earning or deduction for one person in this run, with its reason. */
function AdjustmentForm({ run, close }: { run: PayrollRun; close: () => void }) {
  const [who, setWho] = useState<PersonRef[]>([]);
  const [tried, setTried] = useState(false);
  const bodyOf = (v: AdjustmentValues) => ({ employee_id: who[0]?.employee_id ?? "", kind: v.kind, label: v.label.trim(), amount: toMoneyString(v.amount), reason: v.reason.trim() });
  const f = useContractForm<AdjustmentValues>(
    { kind: "earning", label: "", amount: "", reason: "" },
    {
      // The person is the picker's, checked beside the fields; the rest are the contract's own.
      safeParse: (v: AdjustmentValues) => {
        const r = payroll.PayrollAdjustmentAdd.safeParse(bodyOf(v));
        return r.success ? r : { ...r, error: { ...r.error, issues: r.error.issues.filter((i) => i.path[0] !== "employee_id") } };
      },
    },
  );
  const add = useMutation("POST /api/v1/payroll/runs/:id/adjustments");
  const submit = async () => {
    setTried(true);
    const clean = f.check();
    if (!clean || !who[0]) return;
    try {
      await add.run({ params: { id: run.payroll_run_id }, body: bodyOf(f.values) });
      refresh();
      close();
      toast("Adjustment added");
    } catch (e) {
      landed(e, f.setServerErrors, "Adjustment not added");
    }
  };
  return (
    <>
      <Field label="Employee" state={tried && !who[0] ? "bad" : undefined} message="Pick a person">
        <EmployeePicker value={who} onChange={setWho} placeholder="Search people" />
      </Field>
      <Field label="Kind" {...f.status("kind")}>
        <ChoiceField options={KINDS} {...f.field("kind")} />
      </Field>
      <Field label="Label" {...f.status("label")}>
        <TextField {...f.field("label")} placeholder="October bonus" />
      </Field>
      <Field label="Amount" {...f.status("amount")}>
        <MoneyField {...f.field("amount")} />
      </Field>
      <Field label="Reason" {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} placeholder="Quarterly target met" rows={2} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>
          Add Adjustment
        </Button>
      </FormFooter>
    </>
  );
}

/** Exclude: leave one person out of this run, with the reason; from a problem, the person is already named. */
function ExcludeForm({ run, person, close }: { run: PayrollRun; person?: PersonRef; close: () => void }) {
  const [who, setWho] = useState<PersonRef[]>(person ? [person] : []);
  const [tried, setTried] = useState(false);
  const f = useContractForm({ reason: "" }, { safeParse: (v: { reason: string }) => payroll.PayrollRunExclude.pick({ reason: true }).safeParse({ reason: v.reason }) });
  const exclude = useMutation("POST /api/v1/payroll/runs/:id/exclude");
  const submit = async () => {
    setTried(true);
    const clean = f.check();
    if (!clean || !who[0]) return;
    try {
      refresh(await exclude.run({ params: { id: run.payroll_run_id }, body: { employee_id: who[0].employee_id, reason: f.values.reason.trim() } }));
      close();
      toast(`${who[0].display_name} left out of the run`);
    } catch (e) {
      if (e instanceof ApiError && e.fields.employee_id) setTried(true);
      landed(e, f.setServerErrors, "Person not excluded");
    }
  };
  return (
    <>
      <Field label="Employee" state={tried && !who[0] ? "bad" : undefined} message="Pick a person">
        <EmployeePicker value={who} onChange={setWho} placeholder="Search people" />
      </Field>
      <Field label="Reason" {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} placeholder="Final settlement" rows={3} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>
          Exclude Person
        </Button>
      </FormFooter>
    </>
  );
}

/** Mark Paid: the day the money was sent, never a day still to come, and the bank's reference if there is one. */
function PaidForm({ run, close }: { run: PayrollRun; close: () => void }) {
  const f = useContractForm(
    { paid_on: todayIso(), payment_reference: "" },
    { safeParse: (v: { paid_on: string; payment_reference: string }) => payroll.PayrollRunPaid.safeParse({ paid_on: v.paid_on, payment_reference: v.payment_reference.trim() || undefined }) },
  );
  const paid = useMutation("POST /api/v1/payroll/runs/:id/mark-paid");
  const submit = async () => {
    if (!f.check()) return;
    try {
      const reference = f.values.payment_reference.trim();
      refresh(await paid.run({ params: { id: run.payroll_run_id }, body: { paid_on: f.values.paid_on, ...(reference && { payment_reference: reference }) } }));
      close();
      toast("Run marked paid");
    } catch (e) {
      landed(e, f.setServerErrors, "Run not marked paid");
    }
  };
  return (
    <>
      <Field label="Paid On" {...f.status("paid_on")}>
        <DateField max={todayIso()} {...f.field("paid_on")} />
      </Field>
      <Field label="Payment Reference" optional {...f.status("payment_reference")}>
        <TextField {...f.field("payment_reference")} placeholder="GTB-0045812" />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>
          Mark Paid
        </Button>
      </FormFooter>
    </>
  );
}

/** Send Back and Reject on the approval's own routes, each with its reason; either returns the run to Draft. */
function DecisionForm({ run, wid, verb, close }: { run: PayrollRun; wid: string; verb: "reject" | "request-changes"; close: () => void }) {
  const f = useContractForm({ reason: "" }, workflow.ReasonBody);
  const reject = useMutation("POST /api/v1/workflow/instances/:id/reject");
  const back = useMutation("POST /api/v1/workflow/instances/:id/request-changes");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await (verb === "reject" ? reject : back).run({ params: { id: wid }, body: { reason: f.values.reason.trim() } });
      await decided(run.payroll_run_id);
      refresh();
      close();
      toast(verb === "reject" ? "Run rejected" : "Run sent back");
    } catch (e) {
      landed(e, f.setServerErrors, verb === "reject" ? "Run not rejected" : "Run not sent back");
    }
  };
  return (
    <>
      <Field label={verb === "request-changes" ? <HelpTerm help={SEND_BACK_HELP}>Reason</HelpTerm> : "Reason"} {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} placeholder="Overtime missing" rows={3} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant={verb === "reject" ? "danger" : "primary"} onClick={submit}>
          {verb === "reject" ? "Reject Run" : "Send Back"}
        </Button>
      </FormFooter>
    </>
  );
}
