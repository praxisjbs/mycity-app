import type { PayrollRun, Payslip } from "@mycity/contract/contract.gen.ts";
import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { saveExport } from "@/api/exports";
import { invalidate, useApi, useInfinite, useMutation, usePaged } from "@/api/hooks";
import { PagedTable } from "@/features/shared/sections";
import { paging } from "@/features/shared/wire";
import { Button, Card, ErrorState, ExportButton, FilterSelect, formatMonth, FormFooter, HelpTerm, IconButton, ListDetail, LoadingRows, Menu, PageHeader, Pill, StatStrip, toast, useConfirm, useIsPhone, Who } from "@mycity/ui";
import { amount, downloadSlip, failed, PayslipBody, slipPill, usePayrollGrant } from "./parts";

/**
 * Payroll · Payslips (docs/guides/payroll.md §2, §6.10, §10): a month's payslips, a Preview until its run is approved
 * and Published after, 25 a page and searched by person on the server. A payslip opens in the shared Modal at every
 * width, the centred dialog on desktop and a full sheet on a phone (F31 as amended for payslips, §10.3), with Download
 * PDF for a `payroll` edit holder once it is published. Email All Payslips and Download All wait for the approval; on
 * a phone they sit in the run's overflow.
 */

const PREVIEW_HELP = "A payslip is a preview until the run is approved. Staff see it once it is.";

export default function PaySlips({ id }: { id: string | null }) {
  const summary = useApi("GET /api/v1/payroll/runs/summary");
  const runs = useInfinite("GET /api/v1/payroll/runs");
  const [chosen, setChosen] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(id);
  useEffect(() => setPick(id), [id]);
  // A payslip opened by its link shows its own run's month.
  const linked = useApi("GET /api/v1/payslips/:id", { params: { id: id ?? "" }, enabled: !!id });
  const runId = chosen ?? linked.data?.payroll_run_id ?? summary.data?.current?.payroll_run_id ?? null;
  const run = useApi("GET /api/v1/payroll/runs/:id", { params: { id: runId ?? "" }, enabled: !!runId });
  const list = usePaged("GET /api/v1/payslips", { filters: { run_id: runId ?? undefined }, enabled: !!runId });
  const r = run.data ?? null;
  const out = r !== null && (r.status === "approved" || r.status === "paid");

  if (summary.error) return <ErrorState error={summary.error} onRetry={summary.reload} />;
  const months: Array<[string, string]> = runs.rows.map((x) => [x.payroll_run_id, formatMonth(x.period)]);
  return (
    <>
      <PageHeader
        title="Payslips"
        sub={r ? `${formatMonth(r.period)} ${out ? "run" : "preview"}` : " "}
        actions={
          <>
            {runId && <FilterSelect label="Month" value={runId} onChange={(v) => (setChosen(v), setPick(null))} options={months} valueLabel={r ? formatMonth(r.period) : undefined} {...paging(runs)} />}
            {r && out && <RunFiles run={r} />}
          </>
        }
      />
      {r && (
        <StatStrip
          label="Payslip figures"
          items={[
            { label: "Payslips", value: r.headcount },
            { label: "Gross", value: amount(r.gross_pay) },
            { label: "Deductions", value: amount(r.total_deductions), tone: "warn" },
            { label: "Net", value: amount(r.net_pay), tone: "ok" },
            { label: "Visible to Staff", value: out ? "Published" : "On approval", desktop: true },
          ]}
        />
      )}
      {!summary.data ? (
        <Card>
          <LoadingRows />
        </Card>
      ) : (
        <ListDetail
          layout="modal"
          size="wide"
          full
          open={pick !== null}
          onClose={() => setPick(null)}
          title="Payslip"
          list={
            <PagedTable<Payslip>
              title={out ? "Published" : <HelpTerm help={PREVIEW_HELP}>Preview</HelpTerm>}
              list={list}
              search="Search people"
              rowKey={(p) => p.payslip_id}
              onRowClick={(p) => setPick(p.payslip_id)}
              noun="payslip"
              empty={list.q ? undefined : { title: "No Payslips Yet", text: "They appear once the run is computed." }}
              columns={[
                { key: "e", label: "Employee", render: (p) => <Who name={p.employee.display_name} sub={p.employee.department} /> },
                { key: "g", label: "Gross", align: "n", desktop: true, render: (p) => amount(p.gross_pay) },
                { key: "d", label: "Deductions", align: "n", desktop: true, render: (p) => amount(p.total_deductions) },
                { key: "n", label: "Net", align: "n", render: (p) => amount(p.net_pay) },
                { key: "s", label: "Status", badge: true, render: (p) => slipPill(p.status) },
              ]}
            />
          }
          detail={pick && <StaffPayslip id={pick} />}
        />
      )}
    </>
  );
}

/** One payslip as a Payroll reader opens it, with Download PDF for a `payroll` edit holder once it is published. */
function StaffPayslip({ id }: { id: string }) {
  const d = useApi("GET /api/v1/payslips/:id", { params: { id } });
  const mayDownload = usePayrollGrant("edit");
  if (d.error) return <ErrorState error={d.error} onRetry={d.reload} />;
  if (!d.data) return <LoadingRows />;
  const s = d.data;
  return (
    <>
      {s.status === "published" && !s.pdf_ready && <Pill tone="info" className="mb-2">Preparing</Pill>}
      <PayslipBody s={s} own={false} />
      {mayDownload && s.status === "published" && s.pdf_ready && (
        <FormFooter>
          <Button variant="primary" icon="download" onClick={() => downloadSlip(s, false)}>
            Download PDF
          </Button>
        </FormFooter>
      )}
    </>
  );
}

/** Email All Payslips and Download All of an approved run: buttons on desktop, the run's overflow on a phone. */
function RunFiles({ run }: { run: PayrollRun }) {
  const phone = useIsPhone();
  const confirm = useConfirm();
  const mayEdit = usePayrollGrant("edit");
  const mayExport = usePayrollGrant("export");
  const email = useMutation("POST /api/v1/payroll/runs/:id/email-payslips");
  const id = run.payroll_run_id;
  const emailAll = async () => {
    try {
      const sent = await email.run({ params: { id }, body: { resend: false } });
      if (sent.queued === 0) {
        if (!(await confirm({ title: "Email Again", body: "Everyone has had their payslip. Send it to everyone again?", confirmLabel: "Email Again", cancelLabel: "Not Now" }))) return;
        await email.run({ params: { id }, body: { resend: true } });
      }
      invalidate("/api/v1/payslips");
      toast("Payslips are being emailed");
    } catch (e) {
      failed(e, "Payslips not emailed");
    }
  };
  const downloadAll = () => saveExport(api.call("POST /api/v1/payroll/runs/:id/payslips-export", { params: { id }, body: {} }));
  if (!mayEdit && !mayExport) return null;
  if (phone) {
    return (
      <Menu
        label="Run Payslips"
        trigger={<IconButton icon="dots" label="More Actions" />}
        items={[
          ...(mayEdit ? [{ label: "Email All Payslips", icon: "mail" as const, onSelect: () => void emailAll() }] : []),
          ...(mayExport ? [{ label: "Download All", icon: "download" as const, onSelect: () => void downloadAll().catch((e: unknown) => failed(e, "Payslips not downloaded")) }] : []),
        ]}
      />
    );
  }
  return (
    <>
      {mayEdit && (
        <Button icon="mail" onClick={emailAll}>
          Email All Payslips
        </Button>
      )}
      {mayExport && (
        <ExportButton message="Payslips downloaded" onExport={downloadAll}>
          Download All
        </ExportButton>
      )}
    </>
  );
}
