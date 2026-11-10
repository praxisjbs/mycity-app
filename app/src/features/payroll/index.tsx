import { useState } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { PayrollRun, Payslip } from "@mycity/contract/contract.gen.ts";

import { SlipPaper } from "@/features/ess/Payslips";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { ChainCard, ExportAction, PagedTable } from "@/features/shared/sections";
import type { ModuleScreenProps } from "@/shell/screens";
import Configurations from "./Configurations";
import Deductions from "./Deductions";
import { AreaChart, Button, Card, DetailPane, formatMoneyShort, formatMonth, Grid, LoadingRows, Money, PageHeader, StatStrip, StatusPill, toast, todayIso, useIsPhone, useModal, Who } from "@mycity/ui";

export default function Payroll({ tab }: ModuleScreenProps) {
  if (tab === "payslips") return <Payslips />;
  if (tab === "deductions") return <Deductions />;
  if (tab === "configurations") return <Configurations />;
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
