import { useState } from "react";
import { useApi, useMutation, usePaged } from "@/api/hooks";
import type { Payslip, PayslipDetail } from "@mycity/contract/contract.gen.ts";
import { Button, Card, DataView, DesktopOnly, ErrorState, formatDate, formatMoney, formatMonth, InlineSelect, ListDetail, LoadingRows, Money, PageHeader, Pager, Paper, PaperFoot, PaperLogo, PaperTable, PaperTitle, PhoneOnly, Pill, TapList, toast, todayIso, useModal, useSideBySide } from "@mycity/ui";
import { hrefFor, useRouter } from "@/lib/router";

/** A published payslip's month: paid, paid with a deduction, or still in the run (approved, the money not yet transferred). */
const statusPill = (r: Payslip) => (r.run_status !== "paid" ? <Pill tone="warn">In the run</Pill> : r.has_deduction ? <Pill tone="warn">Paid, deduction</Pill> : <Pill tone="ok">Paid</Pill>);

const THIS_YEAR = () => Number(todayIso().slice(0, 4));

export function MyPayslipsPage() {
  const [year, setYear] = useState<string | undefined>(undefined);
  const summary = useApi("GET /api/v1/ess/payslips/summary", { query: year ? { year: Number(year) } : {} });
  const y = summary.data?.year ? String(summary.data.year) : year;
  const list = usePaged("GET /api/v1/ess/payslips", { filters: y ? { year: Number(y) } : {}, enabled: !!y });
  const [selId, setSelId] = useState<string | null>(null);
  const beside = useSideBySide();
  const picked = list.rows.find((r) => r.payslip_id === selId) ?? null;
  const sel = picked ?? list.rows[0];
  // The latest payslip shows unasked only beside the list; elsewhere a month opens when it is pressed (F31).
  const shown = beside ? sel : picked;
  const modal = useModal();
  const email = useMutation("POST /api/v1/ess/payslips/:id/email");
  const s = summary.data;
  if (summary.error) return <ErrorState error={summary.error} onRetry={summary.reload} />;
  // The years a person can read run from the first the contract allows to this one; a year with no payslip says so.
  const now = THIS_YEAR();
  const years = Array.from({ length: now - 2020 + 1 }, (_, i) => now - i);
  const idx = years.indexOf(Number(y));
  const yearPicker = s && (
    <span className="inline-flex h-8.5 max-md:h-11.5 items-center overflow-hidden rounded-full border border-input bg-background">
      <button type="button" aria-label="Previous year" disabled={idx >= years.length - 1} onClick={() => setYear(String(years[idx + 1]))} className="h-full px-3 text-xs font-semibold text-muted-foreground disabled:opacity-35 max-md:min-w-11">‹</button>
      <InlineSelect aria-label="Year" value={y ?? ""} onChange={setYear} options={years.map(String)} className="h-full border-x border-border bg-background px-2.5 text-xs font-strong" />
      <button type="button" aria-label="Next year" disabled={idx <= 0} onClick={() => setYear(String(years[idx - 1]))} className="h-full px-3 text-xs font-semibold text-muted-foreground disabled:opacity-35 max-md:min-w-11">›</button>
    </span>
  );
  const openSlip = (r: Payslip) => modal.open({ title: `Payslip, ${formatMonth(r.period)}`, wide: true, full: true, body: <SlipPaper id={r.payslip_id} own /> });
  return (
    <>
      <PageHeader
        title="My Payslips"
        sub={s ? `${s.year}, year to date` : " "}
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
          {[["Gross", <Money value={s.gross_pay} />], ["Net received", <Money value={s.net_pay} />], ["Payslips", String(s.payslips)]].map(([l, v]) => (
            <div key={l as string} className="min-w-32 flex-1 border-r border-border px-3.5 py-3 max-md:min-w-1/2 max-md:border-b">
              <span className="text-2xs font-semibold tracking-caps text-subtle-foreground uppercase">{l}</span>
              <b className="mt-0.5 block text-lg font-bold tracking-tight">{v}</b>
            </div>
          ))}
          <button type="button" onClick={() => modal.open({ title: "Salary Deductions", sub: "Every month that carried a deduction, and the query behind it", wide: true, body: <Deductions /> })} className="min-w-32 flex-1 border-r border-border px-3.5 py-3 text-left last:border-r-0 hover:bg-accent max-md:min-w-1/2 max-md:border-b">
            <span className="text-2xs font-semibold tracking-caps text-subtle-foreground uppercase">Deductions</span>
            <b className={`mt-0.5 block text-lg font-bold tracking-tight ${s.total_deductions === "0.00" ? "text-success" : "text-warning"}`}>{formatMoney(s.total_deductions ?? "0.00")}</b>
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
        <TapList items={list.rows.map((r) => ({ key: r.payslip_id, title: formatMonth(r.period), sub: `Net ${formatMoney(r.net_pay ?? "0.00")}`, end: statusPill(r), onSelect: () => openSlip(r) }))} />
        <Pager page={list.page} onPage={list.setPage} noun="payslip" className="px-0" />
      </PhoneOnly>
      <DesktopOnly>
        <ListDetail
          cols="1/1.5"
          open={picked !== null}
          onClose={() => setSelId(null)}
          title={picked ? `Payslip, ${formatMonth(picked.period)}` : "Payslip"}
          list={
            <DataView
              title={`Payslips, ${y ?? ""}`}
              rows={list.rows}
              rowKey={(r) => r.payslip_id}
              loading={list.loading}
              selectedKey={sel?.payslip_id}
              onRowClick={(r) => setSelId(r.payslip_id)}
              columns={[
                { key: "m", label: "Month", render: (r) => formatMonth(r.period) },
                { key: "n", label: "Net", align: "n", render: (r) => <Money value={r.net_pay} /> },
                { key: "s", label: "Status", render: statusPill },
                { key: "x", label: "", render: (r) => <Button size="sm" icon="doc" onClick={(e) => (e.stopPropagation(), toast(`${r.number}.pdf downloading`))}>PDF</Button> },
              ]}
              footer={<Pager page={list.page} onPage={list.setPage} noun="payslip" />}
            />
          }
          detail={shown ? <SlipPaper id={shown.payslip_id} own /> : <Card><LoadingRows /></Card>}
        />
      </DesktopOnly>
    </>
  );
}

/** A payslip as Paper, from its own (`own`, My Payslips) or a Payroll reader's route: the same shape either way. */
export function SlipPaper({ id, own = false }: { id: string; own?: boolean }) {
  return own ? <OwnSlip id={id} /> : <StaffSlip id={id} />;
}

function OwnSlip({ id }: { id: string }) {
  const { data: s } = useApi("GET /api/v1/ess/payslips/:id", { params: { id } });
  return s ? <SlipView s={s} /> : <Card><LoadingRows /></Card>;
}

function StaffSlip({ id }: { id: string }) {
  const { data: s } = useApi("GET /api/v1/payslips/:id", { params: { id } });
  return s ? <SlipView s={s} /> : <Card><LoadingRows /></Card>;
}

function SlipView({ s }: { s: PayslipDetail }) {
  const earnings = s.lines.filter((l) => l.kind === "earning");
  const deductions = s.lines.filter((l) => l.kind === "deduction");
  return (
    <Paper note="This is the document the engine produces. Downloads as PDF.">
      <PaperLogo reference={`PAYSLIP · ${formatMonth(s.period).slice(0, 3).toUpperCase()}-${s.period.slice(0, 4)}`} />
      <PaperTitle sub={`${s.employee.display_name}${s.employee.job_title ? ` · ${s.employee.job_title}` : ""} · ${s.status === "published" ? `Pay date ${formatDate(s.pay_date)}` : "Preview"}`}>Payslip, {formatMonth(s.period)}</PaperTitle>
      <PaperTable head={["Earnings", "Amount"]} rows={earnings.map((e) => [e.label, e.pay_amount === null ? "Restricted" : formatMoney(e.pay_amount)])} totals={[["Gross pay", s.gross_pay === null ? "Restricted" : formatMoney(s.gross_pay)]]} />
      <div className="mt-3.5">
        <PaperTable head={["Deductions", "Amount"]} rows={deductions.map((d) => [`${d.label}${d.detail ? ` (${d.detail})` : ""}`, d.pay_amount === null ? "Restricted" : formatMoney(d.pay_amount)])} totals={[["Net pay", s.net_pay === null ? "Restricted" : formatMoney(s.net_pay)]]} />
      </div>
      {s.bank_name && <p className="!mt-3.5 text-2xs text-paper-faint">Paid to {s.bank_name}, account ending {s.account_last4}.</p>}
      <PaperFoot>
        <span>{s.status === "published" ? "Published" : "Awaiting Approval"}</span>
        <span className="ml-auto">{s.number}</span>
      </PaperFoot>
    </Paper>
  );
}

/** What became of an instalment, in the words My Payslips uses. */
const OUTCOME: Record<string, string> = { scheduled: "Scheduled", in_run: "In the run", applied: "Deducted", cancelled: "Cancelled" };

function Deductions() {
  const list = usePaged("GET /api/v1/ess/deductions");
  const { navigate } = useRouter();
  return (
    <>
      <DataView
        rows={list.rows}
        rowKey={(r) => r.payroll_deduction_instalment_id}
        loading={list.loading}
        empty={{ title: "No Deductions", text: "Nothing has ever been deducted from your pay." }}
        columns={[
          { key: "m", label: "Month", render: (r) => formatMonth(r.period) },
          { key: "a", label: "Amount", align: "n", render: (r) => <Money value={r.pay_amount} /> },
          { key: "r", label: "Reason", render: (r) => r.reason },
          { key: "q", label: "Query", render: (r) => r.query_number ?? "None" },
          { key: "o", label: "Outcome", render: (r) => <Pill tone={r.status === "applied" ? "neutral" : "warn"}>{OUTCOME[r.status]}</Pill> },
        ]}
        footer={<Pager page={list.page} onPage={list.setPage} noun="deduction" />}
      />
      <Button className="mt-3" onClick={() => navigate(hrefFor("ess", "my-queries"))}>Open My Queries</Button>
    </>
  );
}
