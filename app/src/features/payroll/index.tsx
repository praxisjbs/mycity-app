import { useState } from "react";
import { ApiError, api } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import "@/api/types/payroll";
import type { Grade, PayrollDeduction, PayslipRow, RunRow } from "@/api/types/payroll";
import type { PersonRef } from "@/api/types/common";
import { Button, formatMoneyShort, formatMonth, Icon, todayIso, Banner, Quote, Who, Card, CardHeader, Grid, PageHeader, useModal, Money, toast, StatusPill, MoneyField, DateField, Field, FormRow, TextField, TextAreaField, useForm } from "@mycity/ui";
import { AreaChart, Bands } from "@/components/ui/charts";
import { Chain, StatStrip } from "@/components/ui/data";
import { LoadingRows, Table } from "@/components/ui/Table";

import { SlipPaper } from "@/features/ess/Payslips";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { ChainCard, ExportButton, KvCard, ModalFoot, PagedTable } from "@/features/shared/sections";
import type { ModuleScreenProps } from "@/shell/screens";
import { PersonPicker } from "@/components/form";

export default function Payroll({ tab }: ModuleScreenProps) {
  if (tab === "payslips") return <Payslips />;
  if (tab === "salary-structure") return <Structure />;
  if (tab === "deductions") return <Deductions />;
  if (tab === "statutory") return <StatutoryTab />;
  return <Runs />;
}

const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : "Something went wrong");

/* ───────────── Runs ───────────── */

function Runs() {
  const s = useApi("GET /api/v1/payroll/runs/summary");
  const list = usePaged("GET /api/v1/payroll/runs");
  const submit = useMutation("POST /api/v1/payroll/runs/:id/submit");
  const approve = useMutation("POST /api/v1/payroll/runs/:id/approve");
  const paid = useMutation("POST /api/v1/payroll/runs/:id/paid");
  const c = s.data?.current;
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      invalidate("/api/v1/payroll", "/api/v1/payslips");
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
              {c.can_submit && <Button variant="primary" onClick={() => act(() => submit.run({ params: { id: c.run_id }, body: {} }), "Submitted to the CEO for approval")}>Submit for Approval</Button>}
              {c.can_approve && <Button variant="primary" icon="ok" onClick={() => act(() => approve.run({ params: { id: c.run_id }, body: {} }), `${formatMonth(c.period)} approved and locked. Payslips are now visible to staff`)}>Approve and Lock</Button>}
              {c.can_pay && <Button variant="primary" onClick={() => act(() => paid.run({ params: { id: c.run_id }, body: { paid_on: todayIso() } }), "Marked paid")}>Mark Paid</Button>}
              {!c.can_submit && !c.can_approve && !c.can_pay && <Button disabled>{c.status.text}</Button>}
            </>
          )
        }
      />
      {c && (
        <>
          <KpiTiles items={[{ label: "Staff in Run", value: String(c.headcount) }, { label: "Gross", value: formatMoneyShort(c.gross) }, { label: "Deductions", value: <Money value={c.deductions} />, tone: "warn" }, { label: "Net", value: formatMoneyShort(c.net), tone: "ok" }]} />
          <ChainCard steps={c.chain} note="A run is submitted to the CEO for approval. Approval locks it; payslips become visible to staff." />
        </>
      )}
      <PagedTable<RunRow>
        title="Run History"
        list={list}
        rowKey={(r) => r.run_id}
        noun="run"
        columns={[
          { key: "m", label: "Month", render: (r) => <span className="font-semibold">{formatMonth(r.period)}</span> },
          { key: "s", label: "Staff", align: "n", render: (r) => r.headcount },
          { key: "g", label: "Gross", align: "n", render: (r) => <Money value={r.gross} />, desktop: true },
          { key: "n", label: "Net", align: "n", render: (r) => <Money value={r.net} /> },
          { key: "a", label: "Approved By", render: (r) => r.approved_by ?? "Not yet", desktop: true },
          { key: "st", label: "Status", render: (r) => <StatusPill s={r.status} /> },
        ]}
      />
      <Grid cols={2} className="mt-3">
        {s.data ? <AreaChart title="Net Payroll by Month" values={s.data.trend.values.map(Number)} labels={s.data.trend.labels} note={s.data.trend_note} /> : <Card><LoadingRows /></Card>}
        <Card>
          <CardHeader title="What Locking Does" />
          <KvCardBody />
          <Quote className="mt-3">Switching statutory items on recomputes future runs only. A locked run stays exactly as it was paid.</Quote>
        </Card>
      </Grid>
    </>
  );
}

function KvCardBody() {
  const rows: Array<[string, string]> = [
    ["Before approval", "Figures recompute whenever attendance or a deduction changes"],
    ["On approval", "The run is frozen. Payslips become visible to staff"],
    ["After locking", "Nothing recomputes it. Not a policy change, not a corrected punch"],
    ["A correction", "Goes in the next run as an adjustment line, with its reason"],
    ["Why", "A payslip someone has already been paid against must never change"],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-[13px] md:grid-cols-[122px_minmax(0,1fr)] md:gap-y-[9px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents"><dt className="text-[12px] text-subtle-foreground">{k}</dt><dd className="font-[550] max-md:mb-2">{v}</dd></div>
      ))}
    </dl>
  );
}

/* ───────────── Payslips ───────────── */

function Payslips() {
  const modal = useModal();
  const s = useApi("GET /api/v1/payroll/runs/summary");
  const c = s.data?.current;
  const list = usePaged("GET /api/v1/payslips", { filters: { scope: "all", ...(c ? { period: c.period } : {}) }, enabled: !!c });
  const [sel, setSel] = useState<PayslipRow | null>(null);
  const shown = sel ?? list.rows.find((r) => r.has_query_deduction) ?? list.rows[0] ?? null;
  const email = useMutation("POST /api/v1/payroll/runs/:id/email-payslips");
  const locked = c && c.stage !== "awaiting_approval" && c.stage !== "review";
  return (
    <>
      <PageHeader
        title="Payslips"
        sub={c ? `${formatMonth(c.period)} ${locked ? "run" : "preview"}` : " "}
        actions={
          <>
            <Button icon="mail" disabled={!c || email.pending} onClick={async () => { try { await email.run({ params: { id: c!.run_id }, body: {} }); toast(`Payslips are being emailed to ${c!.headcount} staff`); } catch (e) { fail(e); } }}>Email All</Button>
            {c && <ExportButton source="payroll.payslips" filters={{ period: c.period }} label="Download All" />}
          </>
        }
      />
      {c && <StatStrip items={[{ label: "Payslips", value: c.headcount }, { label: "Gross", value: <Money value={c.gross} /> }, { label: "Deductions", value: <Money value={c.deductions} />, tone: "warn" }, { label: "Net", value: <Money value={c.net} /> }, { label: "Visible to Staff", value: locked ? "Yes" : "On approval", desktop: true }]} />}
      <PagedTable<PayslipRow>
        title={locked ? "This Run" : "Preview"}
        list={list}
        search="Search people"
        rowKey={(r) => r.payslip_id}
        noun="payslip"
        onRowClick={setSel}
        columns={[
          { key: "e", label: "Employee", render: (r) => <Who name={r.employee.display_name} sub={r.employee.department ?? undefined} /> },
          { key: "g", label: "Gross", align: "n", render: (r) => <Money value={r.gross} /> },
          { key: "d", label: "Deductions", align: "n", render: (r) => (r.has_query_deduction ? <Money value={r.deductions} /> : "None"), desktop: true },
          { key: "n", label: "Net", align: "n", render: (r) => <b><Money value={r.net} /></b> },
          { key: "p", label: "", render: (r) => <Button size="sm" icon="doc" onClick={(e) => (e.stopPropagation(), modal.open({ title: `${r.employee.display_name} · ${formatMonth(r.period)}`, wide: true, body: <SlipPaper id={r.payslip_id} /> }))}>PDF</Button> },
        ]}
      />
      {shown && (
        <div className="mt-3">
          <SlipPaper id={shown.payslip_id} />
          {shown.has_query_deduction && <p className="mt-3 text-[11.5px] text-subtle-foreground">{shown.employee.display_name} carries a deduction accepted into this run from Queries and Sanctions. The line names its reason, not the sanction.</p>}
        </div>
      )}
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
        <Bands
          title="Bands by Grade"
          scaleLabel={`₦0 to ${formatMoneyShort(String(Math.round(scale)))}`}
          rows={list.rows.map((g) => ({ label: `${g.code} · ${g.band}`, sub: `${g.staff} staff`, minPct: pct(g.minimum), midPct: pct(g.midpoint), maxPct: pct(g.maximum), value: `${formatMoneyShort(g.minimum)} to ${formatMoneyShort(g.maximum)}` }))}
          note="The tick is the midpoint. A new hire is normally placed between the minimum and the midpoint."
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
        <KvCard
          title="What a Band Controls"
          items={[
            ["Offers", "A salary outside the band warns the recruiter"],
            ["Reviews", "A rating does not move a grade. A promotion does"],
            ["Promotion", "Changes the grade, which changes the band, which changes pay"],
            ["Field security", "Bands are masked from Manager and Staff roles"],
            ["Effective dating", "A band change applies from a date, never retrospectively"],
            ["Above maximum", "Flagged, not blocked"],
          ]}
        />
      </Grid>
      <p className="mt-3 text-[11.5px] text-subtle-foreground">Placeholder bands. MyCity has been asked for their real structure so these are replaced before M6 is demonstrated.</p>
    </>
  );
}

function GradeForm({ close }: { close: () => void }) {
  const f = useForm({ code: "", band: "", minimum: "", midpoint: "", maximum: "", effective_from: "" }, {
    code: (v) => (!/^G\d{1,2}$/.test(v) ? "Like G7" : null),
    band: (v) => (!v.trim() ? "Name the band" : null),
    minimum: (v) => (!(Number(v) > 0) ? "Enter the minimum" : null),
    midpoint: (v, a) => (!(Number(v) > Number(a.minimum)) ? "Above the minimum" : null),
    maximum: (v, a) => (!(Number(v) > Number(a.midpoint)) ? "Above the midpoint" : null),
    effective_from: (v) => (!v ? "Pick the date it applies from" : null),
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
      <FormRow>
        <Field label="Grade" {...f.field("code")}><TextField {...f.field("code")} placeholder="G7" onChange={(v) => f.set("code", v.toUpperCase())} /></Field>
        <Field label="Band" {...f.field("band")}><TextField {...f.field("band")} placeholder="Principal" /></Field>
      </FormRow>
      <FormRow>
        <Field label="Minimum" {...f.field("minimum")}><MoneyField {...f.field("minimum")} /></Field>
        <Field label="Midpoint" {...f.field("midpoint")}><MoneyField {...f.field("midpoint")} /></Field>
      </FormRow>
      <FormRow>
        <Field label="Maximum" {...f.field("maximum")}><MoneyField {...f.field("maximum")} /></Field>
        <Field label="Applies From" {...f.field("effective_from")}><DateField {...f.field("effective_from")} min={todayIso()} /></Field>
      </FormRow>
      <ModalFoot>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={save.pending} onClick={submit}>Add Grade</Button>
      </ModalFoot>
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
            <p className="mt-[11px] text-[11.5px] text-subtle-foreground">{f.note}</p>
            <div className="mt-[13px] flex flex-wrap gap-2">
              <Button variant="primary" icon="ok" disabled={accept.pending} onClick={() => doAccept(1)}>Accept Into This Month</Button>
              <Button disabled={accept.pending} onClick={() => doAccept(2)}>Spread Over Two Runs</Button>
              <Button onClick={() => modal.open({ title: "Waive Deduction", body: (close) => <Waive id={f.deduction_id} close={close} /> })}>Waive</Button>
            </div>
          </Card>
        ) : (
          <Card><CardHeader title="Nothing Pending" /><p className="text-[12.5px] text-subtle-foreground">Every deduction raised has been accepted or waived.</p></Card>
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
      <p className="mt-3 text-[11.5px] text-subtle-foreground">A deduction from a sanction never enters a run automatically. Someone has to accept it.</p>
    </>
  );
}

function Waive({ id, close }: { id: string; close: () => void }) {
  const [reason, setReason] = useState("");
  const waive = useMutation("POST /api/v1/payroll/deductions/:id/waive");
  return (
    <>
      <Field label="Why It Is Waived" state={reason && reason.trim().length < 6 ? "bad" : undefined}><TextAreaField value={reason} onChange={setReason} placeholder="Damaged laptop" /></Field>
      <ModalFoot>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={reason.trim().length < 6 || waive.pending} onClick={async () => { try { await waive.run({ params: { id }, body: { reason } }); invalidate("/api/v1/payroll"); close(); toast("Deduction waived"); } catch (e) { fail(e); } }}>Waive</Button>
      </ModalFoot>
    </>
  );
}

function DeductionForm({ close }: { close: () => void }) {
  const [who, setWho] = useState<PersonRef[]>([]);
  const [tried, setTried] = useState(false);
  const f = useForm({ reason: "", amount: "" }, { reason: (v) => (!v.trim() ? "Give the reason; it is the payslip line" : null), amount: (v) => (!(Number(v) > 0) ? "Enter the amount" : null) });
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
      <Field label="Employee" state={tried && !who.length ? "bad" : undefined} message={tried && !who.length ? "Pick the employee" : undefined}><PersonPicker value={who} onChange={setWho} /></Field>
      <Field label="Reason" {...f.field("reason")}><TextField {...f.field("reason")} placeholder="Salary advance repayment" /></Field>
      <Field label="Amount" {...f.field("amount")}><MoneyField {...f.field("amount")} /></Field>
      <ModalFoot>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={save.pending} onClick={submit}>Add Deduction</Button>
      </ModalFoot>
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
        <div className="mb-3 flex items-start gap-2.5 rounded-card bg-warning-soft p-[14px] text-warning">
          <Icon name="alert" className="mt-0.5 flex-none" />
          <div>
            <h3 className="text-[13.5px] font-semibold">Advanced payroll is off</h3>
            <p className="mt-1 text-[11.5px]">MyCity runs simple payroll: gross, attendance and query deductions, net. Nothing statutory appears anywhere until this is switched on.</p>
          </div>
        </div>
      )}
      {d?.enabled && <Banner tone="ok" icon="ok">Advanced payroll is on from {d.effective_from?.split("-").reverse().join("/")}. Runs before that date are unchanged.</Banner>}
      <Table
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
        <Table
          title="Progressive Bands, Configured and Dormant"
          right={<span className="text-[11.5px] text-subtle-foreground">Effective dated</span>}
          rows={d?.paye_bands ?? []}
          rowKey={(r) => `${r.label}-${r.annual}-${r.rate}`}
          loading={s.loading}
          columns={[
            { key: "l", label: "PAYE Band", render: (r) => r.label },
            { key: "a", label: "Annual", align: "n", render: (r) => <Money value={r.annual} /> },
            { key: "r", label: "Rate", align: "n", render: (r) => r.rate },
          ]}
        />
        <KvCard
          title="Why It Is Built but Off"
          items={[
            ["The ask", "MyCity asked for simple payroll. Gross, deductions, net"],
            ["The risk", "Statutory payroll added later is a rewrite, not a setting"],
            ["The answer", "Build it now, configure it, leave it off"],
            ["Switching on", "Recomputes future runs only. A locked run never changes"],
            ["Rates", "Effective dated, so a rate change next year does not rewrite this one"],
            ["Handover", "Documented in the handover pack either way"],
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
      <ModalFoot>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={go}>Switch On</Button>
      </ModalFoot>
    </>
  );
}


