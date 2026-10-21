import { useEffect, useMemo, useRef, useState } from "react";
import type { HomeReport, HomeReportFormat, HomeReportRun, HomeReportSummary } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { saveFile } from "@/api/download";
import { saveRun } from "@/api/exports";
import { useApi, useMutation, usePaged, type PagedResult } from "@/api/hooks";
import { useSearchParams } from "@/lib/router";
import { useScreenAction } from "@/shell/screen-action";
import {
  Button,
  Card,
  CardHeader,
  content,
  DataView,
  EmptyState,
  ErrorState,
  formatCount,
  formatDateTime,
  Grid,
  Grow,
  IconButton,
  Inline,
  KeyValue,
  KpiCard,
  KpiGrid,
  LoadingRows,
  Menu,
  ModalFooter,
  PageHeader,
  Pager,
  Pill,
  Sub,
  toast,
  useConfirm,
  useIsPhone,
  useModal,
  type DataViewColumn,
  type MenuItem,
} from "@mycity/ui";
import { audienceLine, formatName, REPORT_ARCHIVED, REPORT_STATUS, RUN_DONE, RUN_STATUS, scheduleLine, sourceName } from "./labels";
import { refreshReports, useReportForms, type ReportForms } from "./ReportForm";

/**
 * Home · Reports (#3, docs/guides/home.md §10): the four counts, a card for each report the
 * reader may see (their own, those they receive, and the shared ones whose source they may
 * open), and Recent Runs. Every figure is the server's (GET /home/reports/summary,
 * /home/reports, /home/report-runs); the screen words it. The tab needs `home.reports`;
 * ./index.tsx shows the lock to anyone else.
 *
 * A card is the report's name, its status, its source, its schedule in words and who receives
 * it, with Run Now, and for its owner or the CEO (`can_edit`) Edit Report, Pause Report or
 * Resume Report and Archive Report. Run Now makes one file for the reader, asking the format
 * only when the report has both, and answers with the run's number; the run is Pending in
 * Recent Runs until its file is there, and Recent Runs reads itself again meanwhile. A finished
 * run downloads from the vault (GET /documents/:id/content).
 *
 * The two shells (§10.2): on desktop the cards three to a row and Recent Runs as a table; on a
 * phone the counts two to a row, the cards one to a row, and each run a card (report and number,
 * run, recipient, status) without its format. New Report is the page's action and the floating
 * button's.
 *
 * Links (⌘K): `?id=<report>` opens that report once it is read (an archived one too, which
 * neither changes nor runs), and `?run=<run>` opens that run, however far back it is, read on its
 * own (GET /home/report-runs/:id); closing either takes the link out of the address, and one the
 * reader may not see is toasted and taken out. `?action=new` opens New Report.
 */

/** The formats Run Now offers for a report: its schedule's, or both for a report run On Demand. */
export function runFormats(report: Pick<HomeReport, "schedule">): HomeReportFormat[] {
  return report.schedule ? [...report.schedule.formats] : ["pdf", "xlsx"];
}

/** How long after it was asked for a Pending run is still worth waiting for on screen. */
const WATCH_MS = 10 * 60_000;
/** How often Recent Runs reads itself again while a run on it is Pending. */
const RELOAD_MS = 10_000;

/** Is a run on the page still being made, recently enough that its file is worth waiting for? */
export const awaited = (runs: Array<Pick<HomeReportRun, "status" | "run_at">>, now = Date.now()) => runs.some((r) => r.status === "pending" && now - Date.parse(r.run_at) < WATCH_MS);

interface FormatButtonProps {
  label: string;
  formats: HomeReportFormat[];
  busy: boolean;
  onRun: (format: HomeReportFormat) => void;
  /** A choice's words, from the format's name ("Run as PDF"). */
  item: (format: string) => string;
  /** Small on a card (the default); the page header's own size beside its other actions. */
  size?: "sm" | "md";
}

/**
 * A button that makes one file in a format: the format straight away when there is one, a choice
 * (a menu; an action sheet on a phone) when there are two. Run Now on a report, and the
 * Overview's Export, both use it.
 */
export function FormatButton({ label, formats, busy, onRun, item, size = "sm" }: FormatButtonProps) {
  if (formats.length === 1)
    return (
      <Button size={size} busy={busy} onClick={() => onRun(formats[0])}>
        {label}
      </Button>
    );
  return (
    <Menu
      label="Choose Format"
      trigger={(p) => (
        <Button {...p} size={size} busy={busy}>
          {label}
        </Button>
      )}
      items={formats.map((format) => ({ label: item(formatName(format)), icon: "doc", onSelect: () => onRun(format) }))}
    />
  );
}

/**
 * Run Now: one file of the report for the reader, waited on and downloaded here, toasted with
 * its number ("RPT-0215 downloaded"). It waits in Recent Runs as Pending meanwhile.
 */
function RunNow({ report }: { report: HomeReport }) {
  const run = useMutation("POST /api/v1/home/reports/:id/run");
  const [waiting, setWaiting] = useState(false);
  const go = async (format: HomeReportFormat) => {
    setWaiting(true);
    try {
      // A key per press, so a request sent again is the same press. Pressed again while its file
      // waits, the server answers the same run.
      const asked = run.run({ params: { id: report.saved_report_id }, body: { format }, idempotencyKey: crypto.randomUUID() });
      void asked.then(() => refreshReports(), () => undefined);
      const { run: done, saved } = await saveRun(asked, (id) => api.call("GET /api/v1/home/report-runs/:id", { params: { id } }));
      refreshReports();
      if (saved) toast(`${done.number} downloaded`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Report not run. Try again.");
    } finally {
      setWaiting(false);
    }
  };
  return <FormatButton label="Run Now" formats={runFormats(report)} busy={run.pending || waiting} onRun={(format) => void go(format)} item={(format) => `Run as ${format}`} />;
}

interface ReportActions {
  /** Pause Report or Resume Report: a report on a schedule, running or paused. */
  setRunning: (report: HomeReport, running: boolean) => Promise<void>;
  /** Archive Report: asks first, since it leaves the list and stops for good. */
  archive: (report: HomeReport) => Promise<void>;
}

/** What the owner of a report (or the CEO) may do to it, beyond Edit Report. */
function useReportActions(): ReportActions {
  const schedule = useMutation("PATCH /api/v1/home/reports/:id/schedule");
  const archiving = useMutation("POST /api/v1/home/reports/:id/archive");
  const confirm = useConfirm();
  const { run: setSchedule } = schedule;
  const { run: archiveRun } = archiving;

  return useMemo(
    () => ({
      setRunning: async (report, running) => {
        try {
          await setSchedule({ params: { id: report.saved_report_id }, body: { active: running } });
          refreshReports();
          toast(running ? "Report resumed" : "Report paused");
        } catch (e) {
          toast.error(e instanceof ApiError ? e.message : "Report not changed. Try again.");
        }
      },
      archive: async (report) => {
        const sure = await confirm({ title: "Archive Report", body: "It stops running and leaves this list. Its runs stay.", confirmLabel: "Archive Report", destructive: true });
        if (!sure) return;
        try {
          await archiveRun({ params: { id: report.saved_report_id }, body: {} });
          refreshReports();
          toast("Report archived");
        } catch (e) {
          toast.error(e instanceof ApiError ? e.message : "Report not archived. Try again.");
        }
      },
    }),
    [setSchedule, archiveRun, confirm],
  );
}

/** The owner's actions on a report, as a menu (an action sheet on a phone); Archive Report comes last, in red. */
function ownerItems(report: HomeReport, forms: ReportForms, actions: ReportActions, before?: () => void): MenuItem[] {
  const first = (fn: () => void) => () => {
    before?.();
    fn();
  };
  const running = report.schedule?.active === true;
  return [
    { label: "Edit Report", icon: "edit", onSelect: first(() => forms.openEdit(report)) },
    ...(report.schedule ? [{ label: running ? "Pause Report" : "Resume Report", icon: running ? "pause" : "play", onSelect: first(() => void actions.setRunning(report, !running)) } as MenuItem] : []),
    "sep",
    { label: "Archive Report", icon: "book", danger: true, onSelect: first(() => void actions.archive(report)) },
  ];
}

/** The report's facts, on its card and in its sheet. */
function facts(report: HomeReport) {
  const s = report.schedule;
  return [
    ["Source", sourceName(report.report_key)],
    ["Schedule", s && scheduleLine(s)],
    ["Audience", s && audienceLine(s.audience)],
  ] as const;
}

/** Its status, or Archived for one a link opened after it was archived. */
function statusPill(report: Pick<HomeReport, "status" | "archived_at">) {
  const pill = report.archived_at === null ? REPORT_STATUS[report.status] : REPORT_ARCHIVED;
  return <Pill tone={pill.tone}>{pill.text}</Pill>;
}

/** The owner's menu, for a report its reader may change. */
function OwnerMenu({ report, forms, actions, before }: { report: HomeReport; forms: ReportForms; actions: ReportActions; before?: () => void }) {
  return <Menu label="Report Actions" trigger={(p) => <IconButton {...p} icon="dots" label={`Actions for ${report.name}`} />} items={ownerItems(report, forms, actions, before)} />;
}

function ReportCard({ report, forms, actions }: { report: HomeReport; forms: ReportForms; actions: ReportActions }) {
  return (
    <Card as="article" className="flex flex-col">
      <CardHeader record title={report.name} actions={statusPill(report)} />
      <KeyValue items={facts(report)} />
      <Inline justify="end" className="mt-auto pt-3">
        {report.can_edit && <OwnerMenu report={report} forms={forms} actions={actions} />}
        <RunNow report={report} />
      </Inline>
    </Card>
  );
}

/**
 * A report opened from a link (⌘K): its facts, who owns it and when it runs next, and what the
 * reader may do. An archived report is shown as it was left, with nothing to do but close it.
 */
function ReportSheet({ report, forms, actions, close }: { report: HomeReport; forms: ReportForms; actions: ReportActions; close: () => void }) {
  const next = report.schedule?.next_run_at ?? null;
  const live = report.archived_at === null;
  return (
    <>
      <KeyValue items={[["Status", statusPill(report)], ...facts(report), ["Owner", report.owner_name], ["Next Run", next && formatDateTime(next)]]} />
      <ModalFooter>
        <Button onClick={close}>Close</Button>
        <Grow />
        {live && report.can_edit && <OwnerMenu report={report} forms={forms} actions={actions} before={close} />}
        {live && <RunNow report={report} />}
      </ModalFooter>
    </>
  );
}

/** The four counts over the reports the reader may see; two to a row on a phone (KpiGrid). */
function ReportCounts({ summary }: { summary: HomeReportSummary }) {
  return (
    <KpiGrid>
      <KpiCard title="Scheduled" value={formatCount(summary.scheduled)} />
      <KpiCard title="Paused" value={formatCount(summary.paused)} tone={summary.paused > 0 ? "warn" : undefined} />
      <KpiCard title="Runs This Month" value={formatCount(summary.runs_this_month)} />
      <KpiCard title="Recipients" value={formatCount(summary.recipients)} />
    </KpiGrid>
  );
}

/** Is a run's file there to download? */
const hasFile = (run: HomeReportRun) => run.status === "done" && !!run.document_id;

/** Download a run's file from the vault, named by its number: small in Recent Runs, the sheet's main action in a run's sheet. */
function DownloadRun({ run, main = false }: { run: HomeReportRun; main?: boolean }) {
  const file = `/api/v1/documents/${run.document_id}/content`;
  return (
    <Button size={main ? "md" : "sm"} variant={main ? "primary" : "default"} icon="download" aria-label={`Download ${run.number}`} onClick={() => saveFile(file, `${run.number}.${run.format}`)}>
      Download
    </Button>
  );
}

/** A run's status in words: Done once its file is there, else Pending, Failed or Skipped. */
function runPill(run: HomeReportRun) {
  // A done run always carries its file; one that somehow does not is shown as still being made.
  const status = hasFile(run) ? RUN_DONE : RUN_STATUS[run.status === "done" ? "pending" : run.status];
  return <Pill tone={status.tone}>{status.text}</Pill>;
}

/** A run's status on Recent Runs: Pending, Failed or Skipped, or once its file is there, Download. */
function RunState({ run }: { run: HomeReportRun }) {
  return hasFile(run) ? <DownloadRun run={run} /> : runPill(run);
}

/** A run opened from a link (⌘K), however far back it is: what Recent Runs shows of it, and Download once its file is there. */
function RunSheet({ run, close }: { run: HomeReportRun; close: () => void }) {
  return (
    <>
      <KeyValue items={[["Report", run.report_name], ["Run", formatDateTime(run.run_at)], ["Recipient", run.recipient_name], ["Format", formatName(run.format)], ["Status", runPill(run)]]} />
      <ModalFooter>
        <Button onClick={close}>Close</Button>
        {hasFile(run) && <DownloadRun run={run} main />}
      </ModalFooter>
    </>
  );
}

/** Recent Runs, newest first: Number and Format are desktop's; on a phone the number sits under the report. */
function runColumns(phone: boolean): DataViewColumn<HomeReportRun>[] {
  return [
    { key: "number", label: "Number", desktop: true, render: (r) => r.number },
    {
      key: "report",
      label: "Report",
      render: (r) =>
        phone ? (
          <span className="flex flex-col">
            {r.report_name}
            <Sub record>{r.number}</Sub>
          </span>
        ) : (
          r.report_name
        ),
    },
    { key: "run_at", label: "Run", render: (r) => formatDateTime(r.run_at) },
    { key: "recipient", label: "Recipient", render: (r) => r.recipient_name },
    { key: "format", label: "Format", desktop: true, render: (r) => formatName(r.format) },
    { key: "status", label: "Status", render: (r) => <RunState run={r} /> },
  ];
}

/** Recent Runs reads itself again, with the counts, while a run on it is still being made. */
function useWhilePending(runs: PagedResult<HomeReportRun>, reloadCounts: () => void) {
  const waiting = awaited(runs.rows);
  const { reload, rows } = runs;
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => {
      reload();
      reloadCounts();
    }, RELOAD_MS);
    return () => clearTimeout(t);
  }, [waiting, rows, reload, reloadCounts]);
}

/**
 * A link to one record (`?id=` a report, `?run=` a run): it opens once it is read, and closing it
 * takes the link out of the address; a link to one the reader may not see is toasted, `missing`,
 * and taken out.
 * @param read  the record's own GET, enabled while the link is there
 * @param open  opens the record, given what takes the link out when it closes
 */
function useLinked<T>(param: "id" | "run", id: string | null, read: { data: T | undefined; error: unknown }, idOf: (record: T) => string, open: (record: T, unlink: () => void) => void, missing: string) {
  const [, setParams] = useSearchParams();
  const shown = useRef<string | null>(null);
  // The newest of each, so a link taken out when its sheet closes leaves the rest of the address as it is by then.
  const latest = useRef({ open, idOf, setParams });
  latest.current = { open, idOf, setParams };
  useEffect(() => {
    const unlink = () => latest.current.setParams({ [param]: null }, { replace: true });
    if (id === null) {
      shown.current = null;
      return;
    }
    if (shown.current === id) return;
    if (read.data !== undefined && latest.current.idOf(read.data) === id) {
      shown.current = id;
      latest.current.open(read.data, unlink);
    } else if (read.error) {
      shown.current = id;
      unlink();
      toast.error(missing);
    }
  }, [param, id, read.data, read.error, missing]);
}

export function Reports({ linked }: { linked: string | null }) {
  const phone = useIsPhone();
  const modal = useModal();
  const forms = useReportForms();
  const actions = useReportActions();
  const [params] = useSearchParams();

  const summary = useApi("GET /api/v1/home/reports/summary");
  const list = usePaged("GET /api/v1/home/reports");
  const runs = usePaged("GET /api/v1/home/report-runs");
  useWhilePending(runs, summary.reload);

  useScreenAction({ label: "New Report", onSelect: forms.openNew });

  const target = useApi("GET /api/v1/home/reports/:id", { params: { id: linked ?? "" }, enabled: linked !== null });
  useLinked(
    "id",
    linked,
    target,
    (report) => report.saved_report_id,
    (report, unlink) =>
      modal.open({
        title: <span {...content}>{report.name}</span>,
        onClose: unlink,
        body: (close) => <ReportSheet report={report} forms={forms} actions={actions} close={close} />,
      }),
    "Report not found",
  );

  const linkedRun = params.get("run");
  const runTarget = useApi("GET /api/v1/home/report-runs/:id", { params: { id: linkedRun ?? "" }, enabled: linkedRun !== null });
  useLinked(
    "run",
    linkedRun,
    runTarget,
    (run) => run.home_report_run_id,
    (run, unlink) => modal.open({ title: <span {...content}>{run.number}</span>, onClose: unlink, body: (close) => <RunSheet run={run} close={close} /> }),
    "Run not found",
  );

  return (
    <>
      <PageHeader
        title="Reports"
        actions={
          <Button variant="primary" icon="plus" onClick={forms.openNew}>
            New Report
          </Button>
        }
      />
      {summary.error ? <ErrorState error={summary.error} onRetry={summary.reload} /> : summary.data ? <ReportCounts summary={summary.data} /> : <LoadingRows count={2} />}
      {list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : list.rows.length > 0 ? (
        <>
          <Grid cols={3} scroll={false} flush>
            {list.rows.map((report) => (
              <ReportCard key={report.saved_report_id} report={report} forms={forms} actions={actions} />
            ))}
          </Grid>
          <Pager page={list.page} onPage={list.setPage} noun="report" label="Reports" className="px-0" />
        </>
      ) : list.loading ? (
        <LoadingRows count={3} />
      ) : (
        <EmptyState title="No Reports Yet" />
      )}
      <div className="mt-3">
        <DataView title="Recent Runs" list={runs} rowKey={(r) => r.home_report_run_id} noun="run" columns={runColumns(phone)} empty={{ title: "No Runs Yet" }} />
      </div>
    </>
  );
}
