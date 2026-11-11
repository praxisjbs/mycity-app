import type { PayrollRun, Payslip, PayslipDetail } from "@mycity/contract/contract.gen.ts";
import type { ReactNode } from "react";
import { ApiError } from "@/api/client";
import { saveFile, useFileBlob } from "@/api/download";
import { useMe } from "@/auth/AuthProvider";
import { RESTRICTED_HELP } from "@/features/people/status";
import { DocumentPreview, EmptyState, formatDate, formatMoney, formatMonth, HelpTerm, Money, Paper, PaperFoot, PaperLogo, PaperTable, PaperTitle, Pill, toast } from "@mycity/ui";

/**
 * What Payroll Runs, Payslips and ESS · My Payslips share (docs/guides/payroll.md §10): the words of a run's and a
 * payslip's status, an amount that may be Restricted, and the payslip itself, drawn from its lines while it is a
 * preview (and while its PDF loads) and the document engine's PDF once it is published.
 */

type Tone = "ok" | "warn" | "info" | "neutral" | "err";

/** A run's five statuses, in the order a run walks them (§6.9). */
export const RUN_STATUSES: ReadonlyArray<PayrollRun["status"]> = ["draft", "computed", "submitted", "approved", "paid"];
export const RUN_WORDS: Record<PayrollRun["status"], string> = { draft: "Draft", computed: "Computed", submitted: "Submitted", approved: "Approved", paid: "Paid" };
const RUN_TONE: Record<PayrollRun["status"], Tone> = { draft: "neutral", computed: "info", submitted: "warn", approved: "info", paid: "ok" };
export const runPill = (status: PayrollRun["status"]) => <Pill tone={RUN_TONE[status]}>{RUN_WORDS[status]}</Pill>;

/** A payslip's status to a Payroll reader: Preview until its run is approved, then Published; Excluded when left out. */
const SLIP_WORDS: Record<Payslip["status"], { tone: Tone; text: string }> = {
  draft: { tone: "neutral", text: "Preview" },
  published: { tone: "ok", text: "Published" },
  excluded: { tone: "warn", text: "Excluded" },
};
export const slipPill = (s: Payslip["status"]) => <Pill tone={SLIP_WORDS[s].tone}>{SLIP_WORDS[s].text}</Pill>;

/** An amount as a row or a figure shows it: the figure, or Restricted where the salary is masked from the reader (§6.13). */
export function amount(v: string | null, short = false): ReactNode {
  if (v !== null) return <Money value={v} short={short} />;
  return (
    <span className="text-subtle-foreground">
      <HelpTerm help={RESTRICTED_HELP}>Restricted</HelpTerm>
    </span>
  );
}

/** What went wrong, in the API's own words, or the screen's fallback. */
export const failed = (e: unknown, fallback: string) => toast.error(e instanceof ApiError ? e.message : fallback);

/** A 422's fields on the form, or a toast for anything else. */
export function landed(e: unknown, set: (fields: Record<string, string[]>) => void, fallback: string) {
  if (e instanceof ApiError && Object.keys(e.fields).length) set(e.fields);
  else failed(e, fallback);
}

/** Whether the signed-in person holds `action` on Payroll (the CEO passes every check). The API still decides. */
export function usePayrollGrant(action: "view" | "create" | "edit" | "delete" | "approve" | "export"): boolean {
  const me = useMe();
  return me.is_ceo || Boolean(me.grants.payroll?.includes(action));
}

/* ------------------------------------------------------------------ *
 * The payslip
 * ------------------------------------------------------------------ */

const pdfOf = (s: PayslipDetail, own: boolean) => (own ? `/api/v1/ess/payslips/${s.payslip_id}/pdf` : `/api/v1/payslips/${s.payslip_id}/pdf`);

/** Download PDF: the payslip's own file, saved on this device as its number. */
export const downloadSlip = (s: PayslipDetail, own: boolean) => saveFile(pdfOf(s, own), `${s.number}.pdf`);

/**
 * The payslip as it is read: a person left out says so; a preview (and a published payslip until its PDF has loaded,
 * or on the in-browser mock, which holds no file) is drawn from its lines; a published one whose PDF has rendered is
 * that PDF (ess.md §6).
 */
export function PayslipBody({ s, own }: { s: PayslipDetail; own: boolean }) {
  const ready = s.status === "published" && s.pdf_ready;
  const { blob, href } = useFileBlob(ready ? pdfOf(s, own) : null);
  if (s.status === "excluded") return <EmptyState bare icon="user" title="Not in This Run" text={s.excluded_reason ? <span data-copy="content">{s.excluded_reason}</span> : undefined} />;
  if (ready && blob && href) return <DocumentPreview name={`${s.number}.pdf`} mime="application/pdf" href={href} file={blob} height="page" />;
  return <SlipPaper s={s} />;
}

/** A payslip drawn from its lines: earnings, deductions, the net and the bank it is paid to. */
export function SlipPaper({ s }: { s: PayslipDetail }) {
  const earnings = s.lines.filter((l) => l.kind === "earning");
  const deductions = s.lines.filter((l) => l.kind === "deduction");
  const cash = (v: string | null) => (v === null ? "Restricted" : formatMoney(v));
  const who = [s.employee.display_name, s.staff_number, s.employee.job_title].filter(Boolean).join(" · ");
  return (
    <Paper>
      <PaperLogo reference={s.number} />
      <PaperTitle sub={`${who} · ${s.status === "published" ? `Pay Date ${formatDate(s.pay_date)}` : "Preview"}`}>Payslip, {formatMonth(s.period)}</PaperTitle>
      <PaperTable head={["Earnings", "Amount"]} rows={earnings.map((l) => [l.detail ? `${l.label} (${l.detail})` : l.label, cash(l.pay_amount)])} totals={[["Gross Pay", cash(s.gross_pay)]]} />
      <div className="mt-3.5">
        <PaperTable
          head={["Deductions", "Amount"]}
          rows={deductions.length ? deductions.map((l) => [l.detail ? `${l.label} (${l.detail})` : l.label, cash(l.pay_amount)]) : [["None", formatMoney("0.00")]]}
          totals={[["Net Pay", cash(s.net_pay)]]}
        />
      </div>
      {s.bank_name && (
        <p className="mt-3.5 text-2xs text-paper-faint">
          {s.bank_name}
          {s.account_last4 ? `, account ending ${s.account_last4}` : ""}
        </p>
      )}
      <PaperFoot>
        <span>{s.status === "published" ? "Published" : "Preview"}</span>
        <span className="ml-auto">{s.number}</span>
      </PaperFoot>
    </Paper>
  );
}
