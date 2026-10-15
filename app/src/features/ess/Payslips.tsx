import { useState } from "react";
import { useApi, useMutation, usePaged } from "@/api/hooks";
import type { PayslipRow } from "@/api/types/payroll";
import "@/api/types/payroll";
import { Button } from "@/components/ui/Button";
import { EmptyState, Pill, TapList } from "@/components/ui/data";
import { Card, DesktopOnly, Grid, MobileOnly, PageHead } from "@/components/ui/layout";
import { useModal } from "@/components/ui/Modal";
import { Money } from "@/components/ui/Money";
import { Paper, PaperFoot, PaperLogo, PaperTable, PaperTitle } from "@/components/ui/Paper";
import { ErrorBlock, LoadingRows, Pager, Table } from "@/components/ui/Table";
import { toast } from "@/components/ui/Toast";
import { formatDate, formatMoney, formatMonth } from "@/lib/format";
import { hrefFor, useRouter } from "@/lib/router";
import { InlineSelect } from "@/components/form";

const statusPill = (r: PayslipRow) => (r.status === "in_run" ? <Pill tone="warn">In the run</Pill> : r.has_query_deduction ? <Pill tone="warn">Paid, deduction</Pill> : <Pill tone="ok">Paid</Pill>);

export function MyPayslipsPage() {
  const [year, setYear] = useState<string | undefined>(undefined);
  const summary = useApi("GET /api/v1/payslips/summary", { query: year ? { year } : {} });
  const y = summary.data?.year ? String(summary.data.year) : year;
  const list = usePaged("GET /api/v1/payslips", { filters: { scope: "own", ...(y && { year: y }) }, enabled: !!y });
  const [selId, setSelId] = useState<string | null>(null);
  const sel = list.rows.find((r) => r.payslip_id === selId) ?? list.rows.find((r) => r.status === "paid");
  const modal = useModal();
  const email = useMutation("POST /api/v1/payslips/:id/email");
  const s = summary.data;
  if (summary.error) return <ErrorBlock error={summary.error} onRetry={summary.reload} />;
  const years = s?.years ?? [];
  const idx = years.indexOf(Number(y));
  const yearPicker = s && (
    <span className="inline-flex h-[34px] items-center overflow-hidden rounded-full border border-input bg-background">
      <button type="button" aria-label="Previous year" disabled={idx >= years.length - 1} onClick={() => setYear(String(years[idx + 1]))} className="h-full px-3 text-[12.5px] font-semibold text-muted-foreground disabled:opacity-35">‹</button>
      <InlineSelect aria-label="Year" value={y ?? ""} onChange={setYear} options={years.map(String)} className="h-full border-x border-border bg-background px-2.5 text-[12.5px] font-[650]" />
      <button type="button" aria-label="Next year" disabled={idx <= 0} onClick={() => setYear(String(years[idx - 1]))} className="h-full px-3 text-[12.5px] font-semibold text-muted-foreground disabled:opacity-35">›</button>
    </span>
  );
  const openSlip = (r: PayslipRow) =>
    r.status === "in_run"
      ? modal.open({ title: formatMonth(r.period), body: <EmptyState icon="clock" title="In this month’s run" text="It appears once the run is approved." /> })
      : modal.open({ title: `Payslip, ${formatMonth(r.period)}`, wide: true, body: <SlipPaper id={r.payslip_id} /> });
  return (
    <>
      <PageHead
        title="My Payslips"
        sub={s ? (s.next_payday ? `${s.year}, year to date` : String(s.year)) : " "}
        actions={
          <>
            {yearPicker}
            <Button onClick={() => sel && email.run({ params: { id: sel.payslip_id }, body: {} }).then(() => toast("Sent to your work email"))}>Email Me a Copy</Button>
            <Button variant="primary" onClick={() => toast(`Zipping ${s?.year} payslips. They arrive in Mailbox.`)}>Download All</Button>
          </>
        }
      />
      {s && (
        <div className="mb-3 flex flex-wrap overflow-hidden rounded-card border border-border bg-card">
          {[["Gross", <Money value={s.gross} />], ["Net received", <Money value={s.net} />], ["Payslips", String(s.count)]].map(([l, v]) => (
            <div key={l as string} className="min-w-[128px] flex-1 border-r border-border px-[14px] py-3 max-md:min-w-[50%] max-md:border-b">
              <span className="text-[11px] font-semibold tracking-[.07em] text-subtle-foreground uppercase">{l}</span>
              <b className="mt-[3px] block text-[17px] font-bold tracking-[-.02em]">{v}</b>
            </div>
          ))}
          <button type="button" onClick={() => modal.open({ title: "Salary Deductions", sub: "Every month that carried a deduction, and the query behind it", wide: true, body: <Deductions /> })} className="min-w-[128px] flex-1 border-r border-border px-[14px] py-3 text-left last:border-r-0 hover:bg-accent max-md:min-w-[50%] max-md:border-b">
            <span className="text-[11px] font-semibold tracking-[.07em] text-subtle-foreground uppercase">Deductions</span>
            <b className={`mt-[3px] block text-[17px] font-bold tracking-[-.02em] ${s.deductions === "0.00" ? "text-success" : "text-warning"}`}>{formatMoney(s.deductions)}</b>
            <span className="mt-0.5 block text-[11.5px] font-semibold text-accent-foreground">View Details</span>
          </button>
          {s.next_payday && (
            <div className="min-w-[128px] flex-1 px-[14px] py-3 max-md:min-w-[50%]">
              <span className="text-[11px] font-semibold tracking-[.07em] text-subtle-foreground uppercase">Next payday</span>
              <b className="mt-[3px] block text-[17px] font-bold tracking-[-.02em]">{formatDate(s.next_payday)}</b>
            </div>
          )}
        </div>
      )}
      <MobileOnly>
        <TapList items={list.rows.map((r) => ({ key: r.payslip_id, title: formatMonth(r.period), sub: `Net ${formatMoney(r.net)}`, right: statusPill(r), onClick: () => openSlip(r) }))} />
        <Pager page={list.page} onPage={list.setPage} noun="payslip" className="px-0" />
      </MobileOnly>
      <DesktopOnly>
        <Grid cols="1/1.5">
          <Table
            title={`Payslips, ${y ?? ""}`}
            right={<span className="text-[11.5px] text-subtle-foreground">Click a month to preview it</span>}
            rows={list.rows}
            rowKey={(r) => r.payslip_id}
            loading={list.loading}
            selectedKey={sel?.payslip_id}
            onRowClick={(r) => (r.status === "in_run" ? openSlip(r) : setSelId(r.payslip_id))}
            columns={[
              { key: "m", label: "Month", render: (r) => formatMonth(r.period) },
              { key: "n", label: "Net", align: "n", render: (r) => <Money value={r.net} /> },
              { key: "s", label: "Status", render: statusPill },
              { key: "x", label: "", render: (r) => (r.status === "in_run" ? <span className="text-[11.5px] text-subtle-foreground">On approval</span> : <Button size="sm" icon="doc" onClick={(e) => (e.stopPropagation(), toast(`${r.number}.pdf downloading`))}>PDF</Button>) },
            ]}
            footer={<Pager page={list.page} onPage={list.setPage} noun="payslip" />}
          />
          {sel ? <SlipPaper id={sel.payslip_id} /> : <Card><LoadingRows /></Card>}
        </Grid>
      </DesktopOnly>
    </>
  );
}

export function SlipPaper({ id }: { id: string }) {
  const { data: s } = useApi("GET /api/v1/payslips/:id", { params: { id } });
  if (!s) return <Card><LoadingRows /></Card>;
  return (
    <Paper note="This is the document the engine produces. Downloads as PDF.">
      <PaperLogo reference={`PAYSLIP · ${formatMonth(s.period).slice(0, 3).toUpperCase()}-${s.period.slice(0, 4)}`} />
      <PaperTitle sub={`${s.employee.display_name} · ${s.job_title} · ${s.grade}${s.paid_on ? ` · Paid ${formatDate(s.paid_on)}` : ""}`}>Payslip, {formatMonth(s.period)}</PaperTitle>
      <PaperTable head={["Earnings", "Amount"]} rows={s.earnings.map((e) => [e.label, formatMoney(e.amount)])} totals={[["Gross pay", formatMoney(s.gross)]]} />
      <div className="mt-[14px]">
        <PaperTable head={["Deductions", "Amount"]} rows={s.deduction_lines.map((d) => [`${d.label}${d.reference ? ` (${d.reference})` : ""}`, formatMoney(d.amount)])} totals={[["Net pay", formatMoney(s.net)]]} />
      </div>
      <p className="!mt-[14px] text-[11px] text-paper-faint">Paid to {s.bank_name}, account ending {s.account_last4}.</p>
      <PaperFoot>
        <span>{s.approved_by ? `Approved by ${s.approved_by}` : "Awaiting approval"}</span>
        <span className="ml-auto">{s.number}</span>
      </PaperFoot>
    </Paper>
  );
}

function Deductions() {
  const list = usePaged("GET /api/v1/payslips/deductions", { filters: { scope: "own" } });
  const { navigate } = useRouter();
  return (
    <>
      <Table
        rows={list.rows}
        rowKey={(r) => r.period}
        loading={list.loading}
        empty={{ title: "No deductions", text: "Nothing has ever been deducted from your pay." }}
        columns={[
          { key: "m", label: "Month", render: (r) => formatMonth(r.period) },
          { key: "a", label: "Amount", align: "n", render: (r) => <Money value={r.amount} /> },
          { key: "r", label: "Reason", render: (r) => r.reason },
          { key: "q", label: "Query", render: (r) => r.query_number },
          { key: "o", label: "Outcome", render: (r) => <Pill tone={r.outcome.tone}>{r.outcome.text}</Pill> },
        ]}
        footer={<Pager page={list.page} onPage={list.setPage} noun="deduction" />}
      />
      <p className="mt-3 text-[11.5px] text-subtle-foreground">A deduction always starts as a query. It reaches your payslip only if the query is upheld.</p>
      <Button className="mt-3" onClick={() => navigate(hrefFor("ess", "my-queries"))}>Open My Queries</Button>
    </>
  );
}
