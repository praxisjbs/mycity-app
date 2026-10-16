import { useState } from "react";
import { useApi, useMutation, usePaged } from "@/api/hooks";
import type { PayslipRow } from "@/api/types/payroll";
import "@/api/types/payroll";
import { Button, Card, DataView, DesktopOnly, EmptyState, ErrorState, formatDate, formatMoney, formatMonth, Grid, InlineSelect, LoadingRows, Money, PageHeader, Pager, Paper, PaperFoot, PaperLogo, PaperTable, PaperTitle, PhoneOnly, Pill, TapList, toast, useModal } from "@mycity/ui";
import { hrefFor, useRouter } from "@/lib/router";

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
  if (summary.error) return <ErrorState error={summary.error} onRetry={summary.reload} />;
  const years = s?.years ?? [];
  const idx = years.indexOf(Number(y));
  const yearPicker = s && (
    <span className="inline-flex h-8.5 max-md:h-11.5 items-center overflow-hidden rounded-full border border-input bg-background">
      <button type="button" aria-label="Previous year" disabled={idx >= years.length - 1} onClick={() => setYear(String(years[idx + 1]))} className="h-full px-3 text-xs font-semibold text-muted-foreground disabled:opacity-35 max-md:min-w-11">‹</button>
      <InlineSelect aria-label="Year" value={y ?? ""} onChange={setYear} options={years.map(String)} className="h-full border-x border-border bg-background px-2.5 text-xs font-strong" />
      <button type="button" aria-label="Next year" disabled={idx <= 0} onClick={() => setYear(String(years[idx - 1]))} className="h-full px-3 text-xs font-semibold text-muted-foreground disabled:opacity-35 max-md:min-w-11">›</button>
    </span>
  );
  const openSlip = (r: PayslipRow) =>
    r.status === "in_run"
      ? modal.open({ title: formatMonth(r.period), body: <EmptyState icon="clock" title="In This Month’s Run" text="It appears once the run is approved." /> })
      : modal.open({ title: `Payslip, ${formatMonth(r.period)}`, wide: true, body: <SlipPaper id={r.payslip_id} /> });
  return (
    <>
      <PageHeader
        title="My Payslips"
        sub={s ? (s.next_payday ? `${s.year}, year to date` : String(s.year)) : " "}
        actions={
          <>
            {yearPicker}
            <Button onClick={() => sel && email.run({ params: { id: sel.payslip_id }, body: {} }).then(() => toast("Sent to your work email"))}>Email a Copy</Button>
            <Button variant="primary" onClick={() => toast(`Zipping ${s?.year} payslips. They arrive in Mailbox.`)}>Download All</Button>
          </>
        }
      />
      {s && (
        <div className="mb-3 flex flex-wrap overflow-hidden rounded-card border border-border bg-card">
          {[["Gross", <Money value={s.gross} />], ["Net received", <Money value={s.net} />], ["Payslips", String(s.count)]].map(([l, v]) => (
            <div key={l as string} className="min-w-32 flex-1 border-r border-border px-3.5 py-3 max-md:min-w-1/2 max-md:border-b">
              <span className="text-2xs font-semibold tracking-caps text-subtle-foreground uppercase">{l}</span>
              <b className="mt-0.5 block text-lg font-bold tracking-tight">{v}</b>
            </div>
          ))}
          <button type="button" onClick={() => modal.open({ title: "Salary Deductions", sub: "Every month that carried a deduction, and the query behind it", wide: true, body: <Deductions /> })} className="min-w-32 flex-1 border-r border-border px-3.5 py-3 text-left last:border-r-0 hover:bg-accent max-md:min-w-1/2 max-md:border-b">
            <span className="text-2xs font-semibold tracking-caps text-subtle-foreground uppercase">Deductions</span>
            <b className={`mt-0.5 block text-lg font-bold tracking-tight ${s.deductions === "0.00" ? "text-success" : "text-warning"}`}>{formatMoney(s.deductions)}</b>
            <span className="mt-0.5 block text-2xs font-semibold text-accent-foreground">View Details</span>
          </button>
          {s.next_payday && (
            <div className="min-w-32 flex-1 px-3.5 py-3 max-md:min-w-1/2">
              <span className="text-2xs font-semibold tracking-caps text-subtle-foreground uppercase">Next payday</span>
              <b className="mt-0.5 block text-lg font-bold tracking-tight">{formatDate(s.next_payday)}</b>
            </div>
          )}
        </div>
      )}
      <PhoneOnly>
        <TapList items={list.rows.map((r) => ({ key: r.payslip_id, title: formatMonth(r.period), sub: `Net ${formatMoney(r.net)}`, right: statusPill(r), onClick: () => openSlip(r) }))} />
        <Pager page={list.page} onPage={list.setPage} noun="payslip" className="px-0" />
      </PhoneOnly>
      <DesktopOnly>
        <Grid cols="1/1.5">
          <DataView
            title={`Payslips, ${y ?? ""}`}
            rows={list.rows}
            rowKey={(r) => r.payslip_id}
            loading={list.loading}
            selectedKey={sel?.payslip_id}
            onRowClick={(r) => (r.status === "in_run" ? openSlip(r) : setSelId(r.payslip_id))}
            columns={[
              { key: "m", label: "Month", render: (r) => formatMonth(r.period) },
              { key: "n", label: "Net", align: "n", render: (r) => <Money value={r.net} /> },
              { key: "s", label: "Status", render: statusPill },
              { key: "x", label: "", render: (r) => (r.status === "in_run" ? <span className="text-2xs text-subtle-foreground">On approval</span> : <Button size="sm" icon="doc" onClick={(e) => (e.stopPropagation(), toast(`${r.number}.pdf downloading`))}>PDF</Button>) },
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
      <div className="mt-3.5">
        <PaperTable head={["Deductions", "Amount"]} rows={s.deduction_lines.map((d) => [`${d.label}${d.reference ? ` (${d.reference})` : ""}`, formatMoney(d.amount)])} totals={[["Net pay", formatMoney(s.net)]]} />
      </div>
      <p className="!mt-3.5 text-2xs text-paper-faint">Paid to {s.bank_name}, account ending {s.account_last4}.</p>
      <PaperFoot>
        <span>{s.approved_by ? `Approved by ${s.approved_by}` : "Awaiting Approval"}</span>
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
      <DataView
        rows={list.rows}
        rowKey={(r) => r.period}
        loading={list.loading}
        empty={{ title: "No Deductions", text: "Nothing has ever been deducted from your pay." }}
        columns={[
          { key: "m", label: "Month", render: (r) => formatMonth(r.period) },
          { key: "a", label: "Amount", align: "n", render: (r) => <Money value={r.amount} /> },
          { key: "r", label: "Reason", render: (r) => r.reason },
          { key: "q", label: "Query", render: (r) => r.query_number },
          { key: "o", label: "Outcome", render: (r) => <Pill tone={r.outcome.tone}>{r.outcome.text}</Pill> },
        ]}
        footer={<Pager page={list.page} onPage={list.setPage} noun="deduction" />}
      />
      <Button className="mt-3" onClick={() => navigate(hrefFor("ess", "my-queries"))}>Open My Queries</Button>
    </>
  );
}
