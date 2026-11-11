import type { EssDeductionRow, Payslip } from "@mycity/contract/contract.gen.ts";
import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { saveExport } from "@/api/exports";
import { useApi, useMutation, usePaged } from "@/api/hooks";
import { amount, downloadSlip, failed, PayslipBody } from "@/features/payroll/parts";
import { PagedTable } from "@/features/shared/sections";
import { hrefFor, useRouter } from "@/lib/router";
import { Button, DataView, ErrorState, ExportButton, formatDate, formatMonth, FormFooter, HelpTerm, IconButton, ListDetail, LoadingRows, Money, PageHeader, Pill, StatStrip, toast, todayIso, useModal } from "@mycity/ui";

/**
 * ESS · My Payslips (docs/guides/payroll.md §2, §3.7, §10; docs/guides/ess.md §10): a person's own published payslips, a
 * year at a time, with the year's figures and Next Payday. A month opens its payslip in the shared Modal at every width,
 * the centred dialog on desktop and a full sheet on a phone (F31 as amended for payslips), with Download PDF and Email a
 * Copy; Deductions opens every month that carried one. A month whose run is approved and not yet paid reads In the run
 * (§13.3 item 2, JBS Praxis 11/11/2026); nothing shows before the CEO approves it.
 */

const IN_THE_RUN_HELP = "Approved. The pay is not yet transferred.";
/** The first year the contract reads (EssPayslipQuery). */
const FIRST_YEAR = 2020;
const thisYear = () => Number(todayIso().slice(0, 4));

/** A month's status: Paid, Paid with a deduction, or In the run (approved, the money not yet sent). */
function monthPill(r: Payslip) {
  if (r.run_status !== "paid")
    return (
      <HelpTerm help={IN_THE_RUN_HELP}>
        <Pill tone="warn">In the run</Pill>
      </HelpTerm>
    );
  return r.has_deduction ? <Pill tone="warn">Paid with a deduction</Pill> : <Pill tone="ok">Paid</Pill>;
}

export function MyPayslipsPage({ id = null }: { id?: string | null }) {
  const modal = useModal();
  const profile = useApi("GET /api/v1/ess/profile");
  const [year, setYear] = useState(thisYear);
  const summary = useApi("GET /api/v1/ess/payslips/summary", { query: { year } });
  const list = usePaged("GET /api/v1/ess/payslips", { filters: { year } });
  const [pick, setPick] = useState<string | null>(null);
  const s = summary.data;
  // The years run from the person's start (or the first the contract reads) to this one.
  const first = Math.max(FIRST_YEAR, Number(profile.data?.start_date?.slice(0, 4) ?? FIRST_YEAR));
  const openDeductions = () => modal.open({ title: "Salary Deductions", wide: true, body: () => <Deductions /> });
  // A link names a payslip (the bell's "Your payslip is ready", ⌘K) or a deduction or instalment (a deduction's notice,
  // the assistant's citation): the payslip opens once it is found as the person's own, anything else opens Deductions.
  const linked = useApi("GET /api/v1/ess/payslips/:id", { params: { id: id ?? "" }, enabled: !!id });
  const handled = useRef<string | null>(null);
  const toDeductions = useRef(openDeductions);
  toDeductions.current = openDeductions;
  useEffect(() => {
    if (!id || handled.current === id || (!linked.data && !linked.error)) return;
    handled.current = id;
    if (linked.data) setPick(id);
    else toDeductions.current();
  }, [id, linked.data, linked.error]);
  if (summary.error) return <ErrorState error={summary.error} onRetry={summary.reload} />;
  return (
    <>
      <PageHeader
        title="My Payslips"
        sub={`${year}, year to date`}
        actions={
          <>
            <span className="flex items-center gap-1" role="group" aria-label="Year">
              <IconButton icon="left" label="Previous Year" disabled={year <= first} onClick={() => setYear(year - 1)} />
              <b className="min-w-12 text-center text-sm tabular-nums" aria-live="polite">
                {year}
              </b>
              <IconButton icon="right" label="Next Year" disabled={year >= thisYear()} onClick={() => setYear(year + 1)} />
            </span>
            <ExportButton message="Payslips downloaded" onExport={() => saveExport(api.call("POST /api/v1/ess/payslips/export", { body: { year } }))}>
              Download All
            </ExportButton>
          </>
        }
      />
      <StatStrip
        label="Payslip figures"
        items={[
          { label: "Gross", value: s ? <Money value={s.gross_pay} /> : "", desktop: true },
          { label: "Net Received", value: s ? <Money value={s.net_pay} /> : "", tone: "ok" },
          { label: "Payslips", value: s ? s.payslips : "" },
          { label: "Deductions", value: s ? <Money value={s.total_deductions ?? "0.00"} /> : "", tone: s && s.total_deductions !== "0.00" ? "warn" : undefined, onOpen: openDeductions, action: "View Details" },
          { label: "Next Payday", value: s?.next_payday ? formatDate(s.next_payday) : "" },
        ]}
      />
      <ListDetail
        layout="modal"
        size="wide"
        full
        open={pick !== null}
        onClose={() => setPick(null)}
        title="Payslip"
        list={
          <PagedTable<Payslip>
            title={`${year} Payslips`}
            list={list}
            rowKey={(r) => r.payslip_id}
            onRowClick={(r) => setPick(r.payslip_id)}
            noun="payslip"
            empty={{ title: "No Payslips", text: "Nothing was paid in this year." }}
            columns={[
              { key: "m", label: "Month", render: (r) => <span className="font-semibold">{formatMonth(r.period)}</span> },
              { key: "n", label: "Net", align: "n", render: (r) => amount(r.net_pay) },
              { key: "s", label: "Status", badge: true, render: monthPill },
            ]}
          />
        }
        detail={pick && <OwnPayslip id={pick} />}
      />
    </>
  );
}

/** The person's own payslip, with Download PDF and Email a Copy once its PDF has rendered. */
function OwnPayslip({ id }: { id: string }) {
  const d = useApi("GET /api/v1/ess/payslips/:id", { params: { id } });
  const email = useMutation("POST /api/v1/ess/payslips/:id/email");
  if (d.error) return <ErrorState error={d.error} onRetry={d.reload} />;
  if (!d.data) return <LoadingRows />;
  const s = d.data;
  const copy = async () => {
    try {
      await email.run({ params: { id }, body: {} });
      toast("Sent to your work email");
    } catch (e) {
      failed(e, "Copy not sent");
    }
  };
  return (
    <>
      {!s.pdf_ready && <Pill tone="info" className="mb-2">Preparing</Pill>}
      <PayslipBody s={s} own />
      {s.pdf_ready && (
        <FormFooter>
          <Button icon="mail" onClick={copy}>
            Email a Copy
          </Button>
          <Button variant="primary" icon="download" onClick={() => downloadSlip(s, true)}>
            Download PDF
          </Button>
        </FormFooter>
      )}
    </>
  );
}

/** What became of an instalment, in the words My Payslips uses. */
const OUTCOME: Record<EssDeductionRow["status"], string> = { scheduled: "Scheduled", in_run: "In the run", applied: "Deducted", cancelled: "Cancelled" };

/** Every month that carried a deduction, and each instalment still to come, with its query. */
function Deductions() {
  const list = usePaged("GET /api/v1/ess/deductions");
  const { navigate } = useRouter();
  return (
    <>
      <DataView
        bare
        caption="Salary Deductions"
        list={list}
        rowKey={(r) => r.payroll_deduction_instalment_id}
        noun="deduction"
        empty={{ title: "No Deductions", text: "Nothing has been deducted from your pay." }}
        columns={[
          { key: "m", label: "Month", render: (r: EssDeductionRow) => formatMonth(r.period) },
          { key: "a", label: "Amount", align: "n", render: (r: EssDeductionRow) => <Money value={r.pay_amount} /> },
          { key: "r", label: "Reason", render: (r: EssDeductionRow) => <span data-copy="content">{r.instalments > 1 ? `${r.reason}, ${r.instalment} of ${r.instalments}` : r.reason}</span> },
          { key: "q", label: "Query", render: (r: EssDeductionRow) => r.query_number ?? "None" },
          { key: "o", label: "Outcome", badge: true, render: (r: EssDeductionRow) => <Pill tone={r.status === "applied" ? "neutral" : "warn"}>{OUTCOME[r.status]}</Pill> },
        ]}
      />
      <FormFooter>
        <Button onClick={() => navigate(hrefFor("ess", "my-queries"))}>Open My Queries</Button>
      </FormFooter>
    </>
  );
}
