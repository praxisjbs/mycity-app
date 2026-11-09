import { useState } from "react";
import { ApiError, api } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import "@/api/types/payroll";
import type { PayrollRun, Payslip } from "@mycity/contract/contract.gen.ts";
import type { Grade, PayrollDeduction } from "@/api/types/payroll";
import type { PersonRef } from "@/api/types/common";

import { SlipPaper } from "@/features/ess/Payslips";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { ChainCard, ExportAction, KvCard, PagedTable } from "@/features/shared/sections";
import type { ModuleScreenProps } from "@/shell/screens";
import { AreaChart, BandChart, Banner, Button, Card, CardHeader, Chain, DataView, DateField, DetailPane, Field, formatMoneyShort, formatMonth, FormFooter, Grid, Icon, LoadingRows, Money, MoneyField, PageHeader, rules, StatStrip, StatusPill, TextAreaField, TextField, toast, todayIso, useContractForm, useIsPhone, useModal, Who } from "@mycity/ui";
import { EmployeePicker } from "@/features/shared/pickers";

export default function Payroll({ tab }: ModuleScreenProps) {
  if (tab === "payslips") return <Payslips />;
  if (tab === "deductions") return <Deductions />;
  // Salary Structure and Statutory fold into Configurations (docs/guides/payroll.md §2); the prototype
  // shows both until PR 7 rebuilds this screen on the real API.
  if (tab === "configurations") {
    return (
      <>
        <Structure />
        <StatutoryTab />
      </>
    );
  }
  return <Runs />;
}

const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : "Something went wrong");

/* ───────────── Runs ───────────── */

/** The chain a run walks, with where it stands: Draft, Computed, Submitted, Approved, Paid. */
const STAGES: Array<{ status: PayrollRun["status"]; label: string }> = [
  { status: "draft", label: "Draft" },
  { status: "computed", label: "Computed" },
  { status: "submitted", label: "Submitted" },
  { status: "approved", label: "Approved" },
  { status: "paid", label: "Paid" },
];
const chainOf = (status: PayrollRun["status"]) => {
  const at = STAGES.findIndex((x) => x.status === status);
  return STAGES.map((x, i) => ({ label: x.label, state: i < at || status === "paid" ? ("done" as const) : i === at ? ("now" as const) : null }));
};
const TONE: Record<PayrollRun["status"], "neutral" | "info" | "warn" | "ok"> = { draft: "neutral", computed: "neutral", submitted: "warn", approved: "info", paid: "ok" };
const WORDS: Record<PayrollRun["status"], string> = { draft: "Draft", computed: "Computed", submitted: "Submitted", approved: "Approved", paid: "Paid" };
const pill = (status: PayrollRun["status"]) => ({ tone: TONE[status], text: WORDS[status] });

function Runs() {
  const s = useApi("GET /api/v1/payroll/runs/summary");
  const list = usePaged("GET /api/v1/payroll/runs");
  const compute = useMutation("POST /api/v1/payroll/runs/:id/compute");
  const submit = useMutation("POST /api/v1/payroll/runs/:id/submit");
  const approve = useMutation("POST /api/v1/workflow/instances/:id/approve");
  const paid = useMutation("POST /api/v1/payroll/runs/:id/mark-paid");
  const c = s.data?.current;
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      invalidate("/api/v1/payroll", "/api/v1/payslips", "/api/v1/workflow");
      toast(msg);
    } catch (e) {
      fail(e);
    }
  };
  return (
    <>
      <PageHeader
        title="Payroll Runs"
        sub={c ? formatMonth(c.period) : " "}
        actions={
          c && (
            <>
              {c.can_compute && <Button onClick={() => act(() => compute.run({ params: { id: c.payroll_run_id }, body: {} }), "Run computed")}>Compute Run</Button>}
              {c.can_submit && <Button variant="primary" onClick={() => act(() => submit.run({ params: { id: c.payroll_run_id }, body: c.net_pay ? { expected_net_total: c.net_pay } : {} }), "Sent for approval")}>Submit for Approval</Button>}
              {c.can_decide && c.workflow_instance_id && <Button variant="primary" icon="ok" onClick={() => act(() => approve.run({ params: { id: c.workflow_instance_id! }, body: {} }), `${formatMonth(c.period)} approved and locked`)}>Approve</Button>}
              {c.can_pay && <Button variant="primary" onClick={() => act(() => paid.run({ params: { id: c.payroll_run_id }, body: { paid_on: todayIso() } }), "Marked paid")}>Mark Paid</Button>}
            </>
          )
        }
      />
      {c && (
        <>
          <KpiTiles
            items={[
              { label: "Staff in Run", value: String(c.headcount) },
              { label: "Gross", value: c.gross_pay === null ? "Restricted" : formatMoneyShort(c.gross_pay) },
              { label: "Deductions", value: c.total_deductions === null ? "Restricted" : <Money value={c.total_deductions} />, tone: "warn" },
              { label: "Net", value: c.net_pay === null ? "Restricted" : formatMoneyShort(c.net_pay), tone: "ok" },
            ]}
          />
          <ChainCard steps={chainOf(c.status)} />
        </>
      )}
      <PagedTable<PayrollRun>
        title="Run History"
        list={list}
        rowKey={(r) => r.payroll_run_id}
        noun="run"
        columns={[
          { key: "m", label: "Month", render: (r) => <span className="font-semibold">{formatMonth(r.period)}</span> },
          { key: "s", label: "Staff", align: "n", render: (r) => r.headcount },
          { key: "g", label: "Gross", align: "n", render: (r) => (r.gross_pay === null ? "Restricted" : <Money value={r.gross_pay} />), desktop: true },
          { key: "n", label: "Net", align: "n", render: (r) => (r.net_pay === null ? "Restricted" : <Money value={r.net_pay} />) },
          { key: "a", label: "Approved By", render: (r) => r.approved_by_name ?? "Not yet", desktop: true },
          { key: "st", label: "Status", render: (r) => <StatusPill s={pill(r.status)} /> },
        ]}
      />
      <Grid cols={2} className="mt-3">
        {s.data ? (
          <AreaChart
            title="Net Payroll by Month"
            values={s.data.trend.map((t) => Number(t.net_pay ?? 0))}
            labels={s.data.trend.map((t) => formatMonth(t.period).slice(0, 3))}
          />
        ) : (
          <Card><LoadingRows /></Card>
        )}
      </Grid>
    </>
  );
}

/* ───────────── Payslips ───────────── */

function Payslips() {
  const modal = useModal();
  const s = useApi("GET /api/v1/payroll/runs/summary");
  const c = s.data?.current;
  const list = usePaged("GET /api/v1/payslips", { filters: c ? { run_id: c.payroll_run_id } : {}, enabled: !!c });
  const phone = useIsPhone();
  const [sel, setSel] = useState<Payslip | null>(null);
  // Under the list on desktop the first payslip with a deduction shows unasked; on a phone one opens when tapped (F31).
  const shown = sel ?? (phone ? null : (list.rows.find((r) => r.has_deduction) ?? list.rows[0] ?? null));
  const email = useMutation("POST /api/v1/payroll/runs/:id/email-payslips");
  const locked = c && (c.status === "approved" || c.status === "paid");
  return (
    <>
      <PageHeader
        title="Payslips"
        sub={c ? `${formatMonth(c.period)} ${locked ? "run" : "preview"}` : " "}
        actions={
          <>
            <Button icon="mail" disabled={!c} onClick={async () => { try { await email.run({ params: { id: c!.payroll_run_id }, body: {} }); toast(`Payslips are being emailed to ${c!.headcount} staff`); } catch (e) { fail(e); } }}>Email All</Button>
            {c && <ExportAction source="payroll.payslips" filters={{ period: c.period.slice(0, 7) }} label="Download All" />}
          </>
        }
      />
      {c && <StatStrip items={[{ label: "Payslips", value: c.headcount }, { label: "Gross", value: c.gross_pay === null ? "Restricted" : <Money value={c.gross_pay} /> }, { label: "Deductions", value: c.total_deductions === null ? "Restricted" : <Money value={c.total_deductions} />, tone: "warn" }, { label: "Net", value: c.net_pay === null ? "Restricted" : <Money value={c.net_pay} /> }, { label: "Visible to Staff", value: locked ? "Yes" : "On approval", desktop: true }]} />}
      <PagedTable<Payslip>
        title={locked ? "This Run" : "Preview"}
        list={list}
        search="Search people"
        rowKey={(r) => r.payslip_id}
        noun="payslip"
        onRowClick={setSel}
        columns={[
          { key: "e", label: "Employee", render: (r) => <Who name={r.employee.display_name} sub={r.employee.department ?? undefined} /> },
          { key: "g", label: "Gross", align: "n", render: (r) => <Money value={r.gross_pay} /> },
          { key: "d", label: "Deductions", align: "n", render: (r) => (r.has_deduction ? <Money value={r.total_deductions} /> : "None"), desktop: true },
          { key: "n", label: "Net", align: "n", render: (r) => <b><Money value={r.net_pay} /></b> },
          { key: "p", label: "", render: (r) => <Button size="sm" icon="doc" onClick={(e) => (e.stopPropagation(), modal.open({ title: `${r.employee.display_name} · ${formatMonth(r.period)}`, wide: true, body: <SlipPaper id={r.payslip_id} /> }))}>PDF</Button> },
        ]}
      />
      <DetailPane open={sel !== null} onClose={() => setSel(null)} title="Payslip" full>
        {shown && (
          <div className="mt-3 phone:mt-0">
            <SlipPaper id={shown.payslip_id} />
            {shown.has_deduction && <p className="mt-3 text-2xs text-subtle-foreground">{shown.employee.display_name} carries a deduction accepted into this run from Queries and Sanctions. The line names its reason, not the sanction.</p>}
          </div>
        )}
      </DetailPane>
    </>
  );
}

/* ───────────── Salary structure ───────────── */

function Structure() {
  const modal = useModal();
  const s = useApi("GET /api/v1/payroll/grades/summary");
  const list = usePaged("GET /api/v1/payroll/grades");
  const scale = Number(s.data?.scale_max ?? 1) * 1.05;
  const pct = (m: string) => (Number(m) / scale) * 100;
  return (
    <>
      <PageHeader title="Salary Structure" sub="Grades and bands" actions={<Button variant="primary" icon="plus" onClick={() => modal.open({ title: "Add Grade", body: (close) => <GradeForm close={close} /> })}>Add Grade</Button>} />
      {s.data && <KpiTiles items={[{ label: "Grades", value: String(s.data.grades) }, { label: "Staff Placed", value: String(s.data.placed) }, { label: "Below Band Minimum", value: String(s.data.below_minimum), tone: s.data.below_minimum ? "warn" : "ok" }, { label: "Above Maximum", value: String(s.data.above_maximum), tone: s.data.above_maximum ? "warn" : "ok" }]} />}
      {list.rows.length > 0 && (
        <BandChart
          title="BandChart by Grade"
          scale={`₦0 to ${formatMoneyShort(String(Math.round(scale)))}`}
          rows={list.rows.map((g) => ({ label: `${g.code} · ${g.band}`, sub: `${g.staff} staff`, from: pct(g.minimum), middle: pct(g.midpoint), to: pct(g.maximum), value: `${formatMoneyShort(g.minimum)} to ${formatMoneyShort(g.maximum)}` }))}
        />
      )}
      <Grid cols={2} className="mt-3">
        <PagedTable<Grade>
          title="Grades"
          list={list}
          rowKey={(g) => g.grade_id}
          noun="grade"
          columns={[
            { key: "c", label: "Grade", render: (g) => <span className="font-semibold">{g.code}</span> },
            { key: "b", label: "Band", render: (g) => g.band },
            { key: "mn", label: "Minimum", align: "n", render: (g) => <Money value={g.minimum} />, desktop: true },
            { key: "md", label: "Midpoint", align: "n", render: (g) => <Money value={g.midpoint} /> },
            { key: "mx", label: "Maximum", align: "n", render: (g) => <Money value={g.maximum} />, desktop: true },
            { key: "s", label: "Staff", align: "n", render: (g) => g.staff },
          ]}
        />
      </Grid>
    </>
  );
}

function GradeForm({ close }: { close: () => void }) {
  const f = useContractForm({ code: "", band: "", minimum: "", midpoint: "", maximum: "", effective_from: "" }, {
    code: (v) => (!/^G\d{1,2}$/.test(v) ? "Like G7" : null),
    band: (v) => (!v.trim() ? "Name the band" : null),
    minimum: (v) => (!(Number(v) > 0) ? "Enter the minimum" : null),
    midpoint: (v, a) => (!(Number(v) > Number(a.minimum)) ? "Above the minimum" : null),
    maximum: (v, a) => (!(Number(v) > Number(a.midpoint)) ? "Above the midpoint" : null),
    effective_from: (v) => (!v ? "Pick the start date" : null),
  });
  const save = useMutation("POST /api/v1/payroll/grades");
  const submit = async () => {
    if (!f.check()) return;
    try {
      const g = await save.run({ body: f.values });
      invalidate("/api/v1/payroll/grades");
      close();
      toast(`${g.code} added`);
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Field label="Grade" {...f.field("code")}><TextField {...f.field("code")} placeholder="G7" onChange={(v) => f.set("code", v.toUpperCase())} /></Field>
      <Field label="Band" {...f.field("band")}><TextField {...f.field("band")} placeholder="Principal" /></Field>
      <Field label="Minimum" {...f.field("minimum")}><MoneyField {...f.field("minimum")} /></Field>
      <Field label="Midpoint" {...f.field("midpoint")}><MoneyField {...f.field("midpoint")} /></Field>
      <Field label="Maximum" {...f.field("maximum")}><MoneyField {...f.field("maximum")} /></Field>
      <Field label="Applies From" {...f.field("effective_from")}><DateField {...f.field("effective_from")} min={todayIso()} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Add Grade</Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Deductions ───────────── */

function Deductions() {
  const modal = useModal();
  const s = useApi("GET /api/v1/payroll/deductions/summary");
  const list = usePaged("GET /api/v1/payroll/deductions");
  const accept = useMutation("POST /api/v1/payroll/deductions/:id/accept");
  const f = s.data?.focus;
  const doAccept = async (runs: 1 | 2) => {
    if (!f) return;
    try {
      await accept.run({ params: { id: f.deduction_id }, body: { runs } });
      invalidate("/api/v1/payroll");
      toast(runs === 2 ? "Accepted, spread over two runs" : "Accepted into this month's run");
    } catch (e) {
      fail(e);
    }
  };
  return (
    <>
      <PageHeader
        title="Deductions"
        sub={`Pending and applied · attendance tiers ${s.data?.tiers_on ? "on" : "off"}`}
        actions={<Button variant="primary" icon="plus" onClick={() => modal.open({ title: "Add Deduction", body: (close) => <DeductionForm close={close} /> })}>Add Deduction</Button>}
      />
      {s.data && <KpiTiles items={[{ label: "Pending Acceptance", value: String(s.data.pending), tone: s.data.pending ? "warn" : "ok" }, { label: "Applied, This Month", value: <Money value={s.data.applied_this_period} /> }, { label: "Recovered This Year", value: <Money value={s.data.recovered_this_year} />, tone: "ok" }, { label: "Sources", value: String(s.data.sources) }]} />}
      <PagedTable<PayrollDeduction>
        title="All Deductions"
        list={list}
        search="Search people or reasons"
        rowKey={(d) => d.deduction_id}
        noun="deduction"
        wide
        columns={[
          { key: "e", label: "Employee", render: (d) => <Who name={d.employee.display_name} sub={d.employee.department ?? undefined} /> },
          { key: "r", label: "Reason", render: (d) => d.reason },
          { key: "s", label: "Source", render: (d) => d.source, desktop: true },
          { key: "a", label: "Amount", align: "n", render: (d) => <Money value={d.amount} /> },
          { key: "m", label: "Month", render: (d) => formatMonth(d.period).split(" ")[0] },
          { key: "st", label: "Status", render: (d) => <StatusPill s={d.status} /> },
        ]}
      />
      <Grid cols={2} className="mt-3">
        {f ? (
          <Card>
            <CardHeader title={f.title} right={<StatusPill s={{ tone: "warn", text: "Needs acceptance" }} />} />
            <Chain steps={f.chain.map((x) => ({ label: x.label, state: x.state ?? undefined }))} />
            <p className="mt-2.5 text-2xs text-subtle-foreground">{f.note}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" icon="ok" busy={accept.pending} onClick={() => doAccept(1)}>Accept This Month</Button>
              <Button busy={accept.pending} onClick={() => doAccept(2)}>Split Across Runs</Button>
              <Button onClick={() => modal.open({ title: "Waive Deduction", body: (close) => <Waive id={f.deduction_id} close={close} /> })}>Waive</Button>
            </div>
          </Card>
        ) : (
          <Card><CardHeader title="Nothing Pending" /><p className="text-xs text-subtle-foreground">Every deduction raised has been accepted or waived.</p></Card>
        )}
        <KvCard
          title="Deduction Tiers, From Attendance"
          items={[
            ["Current policy", <StatusPill key="p" s={s.data?.tiers_on ? { tone: "ok", text: "On · applies to future reviewed outcomes" } : { tone: "neutral", text: "Off · configuration preserved" }} />],
            ["Up to 1 hour late", "10% of the day"],
            ["Up to 2 hours", "20% of the day"],
            ["Up to 3 hours", "30% of the day"],
            ["Beyond 3 hours", "Treated as absence, by decision"],
            ["Who sets these", "Operations, in Settings, Attendance Policy"],
            ["Automatic?", "No. The figure is computed. A person accepts it"],
          ]}
        />
      </Grid>
    </>
  );
}

function Waive({ id, close }: { id: string; close: () => void }) {
  const f = useContractForm({ reason: "" }, { reason: rules.min(6, "At least 6 characters") });
  const reason = f.values.reason;
  const waive = useMutation("POST /api/v1/payroll/deductions/:id/waive");
  return (
    <>
      <Field label="Why It Is Waived" {...f.field("reason")}><TextAreaField {...f.field("reason")} placeholder="Damaged laptop" /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={waive.pending} onClick={async () => { if (!f.check()) return; try { await waive.run({ params: { id }, body: { reason } }); invalidate("/api/v1/payroll"); close(); toast("Deduction waived"); } catch (e) { fail(e); } }}>Waive</Button>
      </FormFooter>
    </>
  );
}

function DeductionForm({ close }: { close: () => void }) {
  const [who, setWho] = useState<PersonRef[]>([]);
  const [tried, setTried] = useState(false);
  const f = useContractForm({ reason: "", amount: "" }, { reason: (v) => (!v.trim() ? "Give a reason" : null), amount: (v) => (!(Number(v) > 0) ? "Enter the amount" : null) });
  const save = useMutation("POST /api/v1/payroll/deductions");
  const submit = async () => {
    setTried(true);
    if (!f.check() || !who.length) return;
    try {
      await save.run({ body: { employee_id: who[0].employee_id, reason: f.values.reason.trim(), amount: f.values.amount, period: new Date().toISOString().slice(0, 7) } });
      invalidate("/api/v1/payroll/deductions");
      close();
      toast("Deduction added. It waits for acceptance");
    } catch (e) {
      f.setServerErrors(save.fields);
      if (e instanceof ApiError && !e.fields) toast(e.message);
    }
  };
  return (
    <>
      <Field label="Employee" state={tried && !who.length ? "bad" : undefined} message={tried && !who.length ? "Pick the employee" : undefined}><EmployeePicker value={who} onChange={setWho} /></Field>
      <Field label="Reason" {...f.field("reason")}><TextField {...f.field("reason")} placeholder="Salary advance repayment" /></Field>
      <Field label="Amount" {...f.field("amount")}><MoneyField {...f.field("amount")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Add Deduction</Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Statutory ───────────── */

function StatutoryTab() {
  const modal = useModal();
  const s = useApi("GET /api/v1/payroll/statutory");
  const d = s.data;
  return (
    <>
      <PageHeader
        title="Statutory"
        sub={`Advanced payroll · ${d?.enabled ? "on" : "off by default"}`}
        actions={!d?.enabled && <Button variant="primary" onClick={() => modal.open({ title: "Switch On Advanced Payroll", body: (close) => <Enable close={close} /> })}>Switch On</Button>}
      />
      {d && !d.enabled && (
        <div className="mb-3 flex items-start gap-2.5 rounded-card bg-warning-soft p-3.5 text-warning">
          <Icon name="alert" className="mt-0.5 flex-none" />
          <div>
            <h2 data-ui="title" className="text-sm font-semibold">Advanced Payroll Off</h2>
            <p className="mt-1 text-2xs">MyCity runs simple payroll: gross, attendance and query deductions, net. Nothing statutory appears anywhere until this is switched on.</p>
          </div>
        </div>
      )}
      {d?.enabled && <Banner tone="ok" icon="ok">Advanced payroll is on from {d.effective_from?.split("-").reverse().join("/")}. Runs before that date are unchanged.</Banner>}
      <DataView
        title="Nigerian Statutory Items"
        rows={d?.items ?? []}
        rowKey={(r) => r.item}
        loading={s.loading}
        columns={[
          { key: "i", label: "Item", render: (r) => <span className="font-semibold">{r.item}</span> },
          { key: "k", label: "Type", render: (r) => r.kind },
          { key: "r", label: "Rate", render: (r) => r.rate },
          { key: "b", label: "Base", render: (r) => r.base, desktop: true },
          { key: "s", label: "Status", render: (r) => <StatusPill s={r.status} /> },
        ]}
      />
      <Grid cols={2} className="mt-3">
        <DataView
          title="Progressive BandChart"
          right={<span className="text-2xs text-subtle-foreground">Effective dated</span>}
          rows={d?.paye_bands ?? []}
          rowKey={(r) => `${r.label}-${r.annual}-${r.rate}`}
          loading={s.loading}
          columns={[
            { key: "l", label: "PAYE Band", render: (r) => r.label },
            { key: "a", label: "Annual", align: "n", render: (r) => <Money value={r.annual} /> },
            { key: "r", label: "Rate", align: "n", render: (r) => r.rate },
          ]}
        />
      </Grid>
    </>
  );
}

function Enable({ close }: { close: () => void }) {
  const [from, setFrom] = useState("");
  const [tried, setTried] = useState(false);
  const go = async () => {
    setTried(true);
    if (!from) return;
    try {
      await api.call("POST /api/v1/payroll/statutory/enable", { body: { effective_from: from } });
      invalidate("/api/v1/payroll");
      close();
      toast("Advanced payroll switched on for future runs");
    } catch (e) {
      fail(e);
    }
  };
  return (
    <>
      <Banner tone="warn">PAYE, pension, NHF, ITF and NSITF will apply to every run from this date. Locked runs never change.</Banner>
      <Field label="From" state={tried && !from ? "bad" : undefined} message={tried && !from ? "Pick the first day it applies" : undefined}><DateField value={from} onChange={setFrom} min={todayIso()} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={go}>Switch On</Button>
      </FormFooter>
    </>
  );
}


