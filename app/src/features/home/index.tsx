import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { HomeReport } from "@/api/types/home";
import { useMe } from "@/auth/AuthProvider";
import { useUrlAction } from "@/shell/screen-action";
import type { ModuleScreenProps } from "@/shell/screens";
import { mayUseTab } from "./access";
import { Alerts } from "./Alerts";
import { KpiRow } from "./blocks";
import { Gated } from "./Gated";
import { Overview } from "./Overview";
import { Team } from "./Team";
import { Button, DataView, ErrorState, Field, formatDateTime, FormFooter, Grid, PageHeader, Pager, Pill, rules, SelectField, TextField, Tile, toast, useContractForm, useModal } from "@mycity/ui";

/**
 * Home (docs/guides/home.md §2): Overview for every employee, and Team, Alerts and Reports for
 * the holders of their capabilities (./access). Anyone else finds those tabs in their place,
 * locked (./Gated), and the tab reads nothing.
 */
export default function Home({ tab, id }: ModuleScreenProps) {
  const me = useMe();
  if (tab === "team") return mayUseTab(me, "team") ? <Team /> : <Gated title="Team" />;
  if (tab === "alerts") return mayUseTab(me, "alerts") ? <Alerts linked={id} /> : <Gated title="Alerts" />;
  if (tab === "reports") return mayUseTab(me, "reports") ? <Reports /> : <Gated title="Reports" />;
  return <Overview linked={id} />;
}

const RSTATUS = { scheduled: ["ok", "Scheduled"], paused: ["neutral", "Paused"], on_demand: ["info", "On demand"] } as const;

function Reports() {
  const modal = useModal();
  const summary = useApi("GET /api/v1/home/reports/summary");
  const reports = usePaged("GET /api/v1/home/reports");
  const runs = usePaged("GET /api/v1/home/report-runs");
  const run = useMutation("POST /api/v1/home/reports/:id/run");
  const openNewReport = () => modal.open({ title: "New Report", body: (close) => <ReportForm close={close} /> });
  /* Home's New opens this tab asking for a new report. */
  useUrlAction("new", openNewReport);
  const runNow = async (r: HomeReport) => {
    const res = await run.run({ params: { id: r.home_report_id }, body: { format: "pdf" } });
    invalidate("/api/v1/home/report-runs");
    toast(`${res.number} generated. Download it from Recent Runs.`);
  };
  return (
    <>
      <PageHeader title="Reports" sub="Scheduled and on demand · Managers and the CEO" actions={<Button variant="primary" icon="plus" onClick={openNewReport}>New Report</Button>} />
      {summary.data && <KpiRow items={summary.data.kpis} />}
      {reports.error && <ErrorState error={reports.error} onRetry={reports.reload} />}
      <Grid cols={3}>
        {reports.rows.map((r) => (
          <Tile key={r.home_report_id} title={r.name} text={r.cadence}>
            <Pill tone={RSTATUS[r.status][0]}>{RSTATUS[r.status][1]}</Pill>
            <Pill>{r.audience}</Pill>
            <Button size="sm" className="ml-auto" busy={run.pending} onClick={() => runNow(r)}>
              Run Now
            </Button>
          </Tile>
        ))}
      </Grid>
      <Pager page={reports.page} onPage={reports.setPage} noun="report" className="px-0" />
      <Grid cols={2} className="mt-3">
        <DataView
          title="Recent Runs"
          rows={runs.rows}
          rowKey={(r) => r.run_id}
          loading={runs.loading}
          onRowClick={(r) => toast(`${r.number} downloading`)}
          columns={[
            { key: "r", label: "Report", render: (r) => r.report },
            { key: "l", label: "Last Run", render: (r) => formatDateTime(r.run_at) },
            { key: "p", label: "Recipients", desktop: true, render: (r) => r.recipients },
            { key: "f", label: "Format", render: (r) => r.formats },
          ]}
          footer={<Pager page={runs.page} onPage={runs.setPage} noun="run" />}
        />
      </Grid>
    </>
  );
}

function ReportForm({ close }: { close: () => void }) {
  const f = useContractForm({ name: "", source: "attendance", schedule: "Every weekday at 18:00", recipients: "" }, { name: rules.required("Name the report"), recipients: rules.required("Who receives it") });
  const save = useMutation("POST /api/v1/home/reports");
  const submit = async () => {
    if (!f.check()) return;
    await save.run({ body: { ...f.values, formats: ["pdf"] } });
    invalidate("/api/v1/home/reports");
    close();
    toast("Report scheduled");
  };
  return (
    <>
      <Field label="Report Name" {...f.field("name")}>
        <TextField {...f.field("name")} placeholder="Weekly leave summary" />
      </Field>
      <Field label="Source" info="The query the report runs: the same one its screen uses, so a report never disagrees with a page.">
        <SelectField options={[["attendance", "Attendance"], ["tasks", "Tasks"], ["expenses", "Expenses"], ["recruitment", "Recruitment"], ["partnerships", "Partnerships"]]} {...f.field("source")} />
      </Field>
      <Field label="Schedule">
        <SelectField options={[["Every weekday at 18:00", "Every weekday at 18:00"], ["Mondays at 08:00", "Mondays at 08:00"], ["First working day of the month", "First working day of the month"], ["On demand", "On demand only"]]} {...f.field("schedule")} />
      </Field>
      <Field label="Recipients" {...f.field("recipients")}>
        <TextField {...f.field("recipients")} placeholder="Operations, CEO" />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>
          Schedule Report
        </Button>
      </FormFooter>
    </>
  );
}
