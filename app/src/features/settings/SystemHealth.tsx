import { useEffect, useState } from "react";
import type {
  CheckChange,
  CheckDetail,
  FaultDetail,
  FaultRow,
  HealthCheck,
  PerformancePoint,
  QueueRow,
  SchedulerRow,
} from "@mycity/contract/contract.gen.ts";
import { api } from "@/api/client";
import { saveExport } from "@/api/exports";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { KpiTiles } from "@/features/shared/KpiTiles";
import {
  Banner,
  Bars,
  Button,
  Card,
  CardHeader,
  DataView,
  Details,
  DesktopOnly,
  EmptyState,
  ErrorState,
  Field,
  FilterSelect,
  formatDateTime,
  FormFooter,
  Grid,
  HelpTerm,
  KeyValue,
  LoadingRows,
  PageHeader,
  PhoneOnly,
  Pill,
  SearchInput,
  SegmentedControl,
  SidePanel,
  TextAreaField,
  Tick,
  toast,
  Toolbar,
  useIsPhone,
  useModal,
} from "@mycity/ui";

type Tone = "ok" | "warn" | "err" | "info" | "neutral";
type FaultStatusFilter = FaultRow["status"] | "active" | "all";
type Filters = { status: FaultStatusFilter; severity?: FaultRow["severity"] };

const STATE: Record<HealthCheck["state"], { tone: Tone; text: string }> = {
  up: { tone: "ok", text: "Up" },
  degraded: { tone: "warn", text: "Degraded" },
  down: { tone: "err", text: "Down" },
};

const FAULT_STATUS: Record<FaultRow["status"], { tone: Tone; text: string }> = {
  open: { tone: "err", text: "Open" },
  handling: { tone: "warn", text: "Being Handled" },
  fixed: { tone: "ok", text: "Fixed" },
  ignored: { tone: "neutral", text: "Ignored" },
};

const SEVERITY: Record<FaultRow["severity"], { tone: Tone; text: string }> = {
  fatal: { tone: "err", text: "Crash" },
  error: { tone: "err", text: "Error" },
  warning: { tone: "warn", text: "Warning" },
  notice: { tone: "neutral", text: "Form" },
};

const ORIGIN: Record<FaultRow["origin"], string> = {
  server: "API",
  worker: "Worker",
  job: "Job",
  browser: "Browser",
};

const JOB_STATE: Record<SchedulerRow["state"], { tone: Tone; text: string }> = {
  on_time: { tone: "ok", text: "On Time" },
  failing: { tone: "err", text: "Failing" },
  late: { tone: "warn", text: "Late" },
  waiting: { tone: "neutral", text: "Not Due Yet" },
};

const CAME_BACK = "A fault somebody marked fixed that has happened again.";
const SET_AS = "What the code declared: an interval in milliseconds, or a cron pattern read in Lagos time.";
const NOT_DUE = "Started recently and not yet at its first slot. Not late.";
const FAILED_KEPT = "Failed jobs still kept, up to the last 5,000, not only today's.";

/** Status and an open check read again this often, while the page is on screen. */
const REFRESH_MS = 30_000;

/** Calls `read` every `ms` while the tab is visible, so the screen follows the system without a press. */
function useEvery(ms: number, read: () => void) {
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") read();
    }, ms);
    return () => clearInterval(t);
  }, [ms, read]);
}

/** When a check entered its state, as a line a person reads. */
const sinceText = (since: string | null) => (since ? `Since ${formatDateTime(since)}` : "Changed Just Now");
const PEOPLE = "How many different people hit this fault. Never who they are.";
const BRIEF = "One Markdown file with everything an AI needs to fix the ticked faults.";

/**
 * Settings · System Health (docs/guides/system-health.md): whether the ERP is well, how
 * it has behaved, and every fault the code reported, grouped with a status the team
 * shares. Ticking faults downloads a brief an AI can work from.
 *
 * Only the Implementation Team and the System Administrator hold `system_health`.
 */
export function StatusTab() {
  const { can } = useAuth();
  const status = useApi("GET /api/v1/system-health/status");
  useEvery(REFRESH_MS, status.reload);
  const [open, setOpen] = useState<HealthCheck | null>(null);
  const s = status.data;

  // The worker writes the file; when the worker is what is down, the server's own watch
  // has already mailed one (docs/runbooks/system-health.md §7).
  const brief = async () => {
    await saveExport(api.call("POST /api/v1/system-health/status-briefs", { body: {} }));
    toast("Status brief ready");
  };

  if (status.error)
    return (
      <>
        <PageHeader title="System Health" />
        <Card>
          <ErrorState error={status.error} onRetry={status.reload} />
        </Card>
      </>
    );

  return (
    <>
      <PageHeader
        title="Status"
        sub={s ? `Build ${s.release.slice(0, 12)}` : " "}
        actions={
          s ? (
            <>
              <Pill tone={s.state === "ready" ? "ok" : s.state === "degraded" ? "warn" : "err"}>
                {s.state === "ready" ? "All Up" : s.state === "degraded" ? "Degraded" : "Unavailable"}
              </Pill>
              {can("system_health", "export") && (
                <Button icon="download" onClick={brief}>
                  Download Brief
                </Button>
              )}
            </>
          ) : undefined
        }
      />
      {s && (
        <KpiTiles
          mobileCols={2}
          items={[
            { label: "Checks Down", value: String(s.checks.filter((c) => c.state !== "up").length), tone: s.checks.some((c) => c.state !== "up") ? "err" : "ok" },
            { label: "Open Faults", value: String(s.faults_open), tone: s.faults_open ? "warn" : "ok" },
            { label: "New Today", value: String(s.faults_new_24h) },
            { label: "Came Back", value: String(s.faults_returned_24h), tone: s.faults_returned_24h ? "warn" : undefined },
          ]}
        />
      )}
      <Checks checks={s?.checks} loading={status.loading} onOpen={setOpen} />
      <SidePanel open={!!open} onClose={() => setOpen(null)} title={open?.label ?? "Check"} size="wide">
        {open && <CheckSheet key={open.key} check={open} />}
      </SidePanel>
    </>
  );
}

/** Settings · Performance: how the app answered, and what the server has left. */
export function PerformanceTab() {
  return (
    <>
      <PageHeader title="Performance" sub="How the app answered" />
      <Performance />
    </>
  );
}

/** Settings · Faults: every fault the code reported, grouped, with the brief. */
export function FaultsTab() {
  const { can } = useAuth();
  return (
    <>
      <PageHeader title="Faults" sub="What the code reported" />
      <Faults canEdit={can("system_health", "edit")} canExport={can("system_health", "export")} />
    </>
  );
}

/* ───────────── Status ───────────── */

/**
 * The readiness checks. Everything up is one quiet line, because a wall of green
 * teaches people to stop reading it; anything not up is a card with where to look.
 */
function Checks({ checks, loading, onOpen }: { checks?: HealthCheck[]; loading: boolean; onOpen: (c: HealthCheck) => void }) {
  const [showAll, setShowAll] = useState(false);
  if (loading && !checks)
    return (
      <Card className="mt-3">
        <LoadingRows count={4} />
      </Card>
    );
  const all = checks ?? [];
  const bad = all.filter((c) => c.state !== "up");
  const shown = showAll || bad.length === 0 ? all : bad;
  return (
    <Card className="mt-3">
      <CardHeader
        title="Checks"
        right={
          <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
            {showAll || bad.length === 0 ? "Show Fewer" : "Show All"}
          </Button>
        }
      />
      {bad.length === 0 && !showAll ? (
        <p className="text-sm text-muted-foreground">Every one of the {all.length} checks is up.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((c) => (
            <div key={c.key} className="flex items-start gap-2.5 border-b border-border py-2 last:border-b-0">
              <Pill tone={STATE[c.state].tone}>{STATE[c.state].text}</Pill>
              <div className="min-w-0 flex-1">
                <div data-copy="content" className="text-sm font-semibold">{c.label}</div>
                <div data-copy="content" className="text-xs text-muted-foreground">{c.detail}</div>
                {c.state !== "up" && (
                  <div data-copy="content" className="text-xs text-subtle-foreground">
                    {sinceText(c.since)}
                  </div>
                )}
                {c.look_at && <Details title="Where to Look">{c.look_at}</Details>}
              </div>
              <Button size="sm" variant="ghost" onClick={() => onOpen(c)}>
                Open
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/**
 * One check, opened: what its probe measured, since when, the jobs or queues behind it,
 * and its changes over 7 days. On a phone it starts with what is not well; the figures,
 * the history and the jobs on time wait behind Show More (guide §10.2).
 */
function CheckSheet({ check }: { check: HealthCheck }) {
  const phone = useIsPhone();
  const [more, setMore] = useState(false);
  const read = useApi("GET /api/v1/system-health/checks/:key", { params: { key: check.key } });
  useEvery(REFRESH_MS, read.reload);
  const history = usePaged("GET /api/v1/system-health/checks/:key/history", { params: { key: check.key } });
  const d: CheckDetail | undefined = read.data;

  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  if (!d) return <LoadingRows count={6} />;

  const full = !phone || more;
  const jobs = d.jobs && (full ? d.jobs : d.jobs.filter((j) => j.state === "late" || j.state === "failing"));
  const queues = d.queues && (full ? d.queues : d.queues.filter((q) => q.waiting || q.active || q.delayed || q.last_failure));

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Pill tone={STATE[d.state].tone}>{STATE[d.state].text}</Pill>
        <span data-copy="content" className="text-xs text-subtle-foreground">
          {sinceText(d.since)}
        </span>
      </div>
      <p data-copy="content" className="text-sm">{d.detail}</p>
      {d.look_at && <Details title="Where to Look">{d.look_at}</Details>}
      {d.unread.length > 0 && (
        <Banner tone="warn" className="mt-3">
          <span data-copy="content">{d.unread.join(". ")}</span>
        </Banner>
      )}

      {full && d.facts.length > 0 && <KeyValue className="mt-3" items={d.facts.map((f) => [f.label, f.value])} />}

      {jobs && (
        <DataView<SchedulerRow>
          className="mt-3"
          title="Jobs"
          wide
          rows={jobs}
          rowKey={(j) => j.name}
          noun="job"
          empty={{ title: "All On Time", icon: "check" }}
          columns={[
            {
              key: "job",
              label: "Job",
              render: (j) => (
                <div className="min-w-0">
                  <b data-copy="content" className="block truncate">{j.name}</b>
                  {j.summary && (
                    <span data-copy="content" className="block text-xs text-subtle-foreground">
                      {j.summary}
                    </span>
                  )}
                  {j.last_error && (
                    <span data-copy="content" className="wrap-any block text-xs text-destructive line-clamp-3">
                      {j.last_error}
                    </span>
                  )}
                </div>
              ),
            },
            {
              key: "set",
              label: <HelpTerm help={SET_AS}>Set As</HelpTerm>,
              render: (j) => (
                <div className="min-w-0">
                  <span data-copy="content" className="block">{j.cadence}</span>
                  <span data-copy="content" className="block text-2xs text-subtle-foreground">{j.set_as}</span>
                </div>
              ),
            },
            { key: "last", label: "Last Run", render: (j) => (j.last_run_at ? formatDateTime(j.last_run_at) : "Never") },
            {
              key: "result",
              label: "Result",
              desktop: true,
              render: (j) => (j.last_ok === null ? null : <Pill tone={j.last_ok ? "ok" : "err"}>{j.last_ok ? "Ran" : "Failed"}</Pill>),
            },
            { key: "next", label: "Next Run", desktop: true, render: (j) => (j.next_run_at ? formatDateTime(j.next_run_at) : null) },
            {
              key: "state",
              label: "State",
              render: (j) => (
                <div className="min-w-0">
                  {j.state === "waiting" ? (
                    <HelpTerm help={NOT_DUE}>
                      <Pill tone={JOB_STATE.waiting.tone}>{JOB_STATE.waiting.text}</Pill>
                    </HelpTerm>
                  ) : (
                    <Pill tone={JOB_STATE[j.state].tone}>{JOB_STATE[j.state].text}</Pill>
                  )}
                  {j.reason && j.state !== "waiting" && (
                    <span data-copy="content" className="block text-xs text-subtle-foreground">{j.reason}</span>
                  )}
                </div>
              ),
            },
          ]}
        />
      )}

      {queues && (
        <DataView<QueueRow>
          className="mt-3"
          title="Queues"
          wide
          rows={queues}
          rowKey={(q) => q.queue}
          noun="queue"
          empty={{ title: "Nothing Waiting", icon: "check" }}
          columns={[
            {
              key: "queue",
              label: "Queue",
              render: (q) => (
                <div className="min-w-0">
                  <b data-copy="content" className="block truncate">{q.queue}</b>
                  {q.summary && (
                    <span data-copy="content" className="block text-xs text-subtle-foreground">
                      {q.summary}
                    </span>
                  )}
                </div>
              ),
            },
            { key: "waiting", label: "Waiting", align: "n", render: (q) => q.waiting.toLocaleString("en-NG") },
            { key: "active", label: "Active", align: "n", desktop: true, render: (q) => q.active.toLocaleString("en-NG") },
            { key: "delayed", label: "Delayed", align: "n", desktop: true, render: (q) => q.delayed.toLocaleString("en-NG") },
            { key: "failed", label: <HelpTerm help={FAILED_KEPT}>Failed</HelpTerm>, align: "n", render: (q) => q.failed.toLocaleString("en-NG") },
            {
              key: "last",
              label: "Newest Failure",
              desktop: true,
              render: (q) =>
                q.last_failure ? (
                  <span data-copy="content" className="wrap-any block text-xs line-clamp-2">
                    {q.last_failed_at ? `${formatDateTime(q.last_failed_at)}: ` : ""}
                    {q.last_failure}
                  </span>
                ) : null,
            },
          ]}
        />
      )}

      {full && (
        <DataView<CheckChange>
          className="mt-3"
          title="Changes"
          list={history}
          rowKey={(r) => `${r.at}-${r.to}`}
          noun="change"
          empty={{ title: "No Changes", text: "Same state all week.", icon: "check" }}
          columns={[
            { key: "at", label: "When", render: (r) => formatDateTime(r.at) },
            {
              key: "to",
              label: "Became",
              render: (r) => (
                <div className="flex flex-wrap items-center gap-1">
                  <Pill tone={STATE[r.from].tone}>{STATE[r.from].text}</Pill>
                  <Pill tone={STATE[r.to].tone}>{STATE[r.to].text}</Pill>
                </div>
              ),
            },
            { key: "detail", label: "It Said", desktop: true, render: (r) => <span data-copy="content">{r.detail}</span> },
          ]}
        />
      )}

      {!full && (
        <Button className="mt-3 w-full" onClick={() => setMore(true)}>
          Show More
        </Button>
      )}
    </>
  );
}

/* ───────────── Performance ───────────── */

/**
 * A day or a week of snapshots: how the app answered, and what the server has left.
 *
 * The empty state is deliberate. "Nothing recorded yet" reads like good news, and the
 * first release of this screen showed exactly that for an hour while the job behind it
 * was never started. So an empty chart says which of the two it is.
 */
function Performance() {
  const [range, setRange] = useState<"24h" | "7d">("24h");
  const p = useApi("GET /api/v1/system-health/performance", { query: { range } });
  const d = p.data;
  const span = range === "24h" ? "day" : "week";

  if (p.error)
    return (
      <Card>
        <ErrorState error={p.error} onRetry={p.reload} />
      </Card>
    );
  if (!d)
    return (
      <Card>
        <LoadingRows count={6} />
      </Card>
    );

  const bars = (pick: (x: PerformancePoint) => number | null, unit: string) => {
    const vals = d.points.map(pick).filter((v): v is number => v !== null);
    const worst = Math.max(1, ...vals);
    return d.points
      .filter((x) => pick(x) !== null)
      .slice(-14)
      .map((x) => ({
        label: formatDateTime(x.at),
        value: `${pick(x)}${unit}`,
        percent: Math.round(((pick(x) as number) * 100) / worst),
      }));
  };

  const served = d.points.some((x) => x.requests !== null);
  const resourced = d.points.some((x) => x.disk_free_pct !== null);
  const latest = [...d.points].reverse().find((x) => x.disk_free_pct !== null);

  return (
    <>
      <Card>
        <CardHeader
          title="Over Time"
          right={<SegmentedControl value={range} onChange={(v) => setRange(v as "24h" | "7d")} options={[["24h", "Day"], ["7d", "Week"]]} />}
        />
        {!d.recording && (
          <Banner tone="warn">
            {d.last_snapshot_at
              ? "The five minute job has stopped, so nothing is recording. See Status, Background Jobs."
              : "No snapshot has ever been taken, so the job is not running. See Status, Background Jobs."}
          </Banner>
        )}
        <KeyValue
          items={[
            ["Every check up", `${d.uptime_pct}% of the ${span}`],
            ["Not recorded", d.gap_minutes ? `${d.gap_minutes} minutes` : "None"],
            ["Disk free", latest?.disk_free_pct != null ? `${latest.disk_free_pct}%` : null],
            ["Memory used", latest?.memory_used_pct != null ? `${latest.memory_used_pct}%` : null],
            ["Database", latest?.database_mb != null ? `${latest.database_mb} MB` : null],
          ]}
        />
      </Card>

      {d.recording && d.points.length > 0 && (
        <Grid cols={2} className="mt-3">
          <Card>
            <CardHeader title="Requests" />
            {served ? (
              <>
                <Bars rows={bars((x) => x.mean_ms, " ms")} note={`Average response time, by ${range === "24h" ? "hour" : "day"}`} />
                <Bars
                  className="mt-3"
                  rows={bars((x) => (x.error_pct === null ? null : Math.round(Number(x.error_pct))), "%")}
                  note="Share of requests that failed"
                />
              </>
            ) : (
              <EmptyState icon="chart" title="No Traffic Yet" text="Figures appear once people use the app." />
            )}
          </Card>
          <Card>
            <CardHeader title="Server Resources" />
            {resourced ? (
              <>
                <Bars rows={bars((x) => x.disk_free_pct, "%")} note="Disk free" />
                <Bars className="mt-3" rows={bars((x) => x.memory_used_pct, "%")} note="Memory used" />
              </>
            ) : (
              <EmptyState icon="chart" title="Not Recorded Yet" text="Resource figures start with the next snapshot." />
            )}
          </Card>
        </Grid>
      )}

      {d.recording && d.points.length > 0 && (
        <Grid cols={2} className="mt-3">
          <Card>
            <CardHeader title="Open Faults" />
            <Bars rows={bars((x) => x.faults, "")} note={`By ${range === "24h" ? "hour" : "day"}`} />
          </Card>
        </Grid>
      )}
    </>
  );
}

/* ───────────── Faults ───────────── */

function Faults({ canEdit, canExport }: { canEdit: boolean; canExport: boolean }) {
  const modal = useModal();
  const [filters, setFilters] = useState<Filters>({ status: "active" });
  const [picked, setPicked] = useState<string[]>([]);
  const list = usePaged("GET /api/v1/system-health/faults", { filters });
  const bulk = useMutation("POST /api/v1/system-health/faults/bulk");

  const onPage = list.rows.map((f) => f.error_group_id);
  const allPicked = onPage.length > 0 && onPage.every((id) => picked.includes(id));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const togglePage = () => setPicked((p) => (allPicked ? p.filter((id) => !onPage.includes(id)) : [...new Set([...p, ...onPage])]));
  const done = () => {
    setPicked([]);
    invalidate("/api/v1/system-health");
  };

  const download = async () => {
    const ids = picked.slice(0, 25);
    await saveExport(api.call("POST /api/v1/system-health/briefs", { body: { error_group_ids: ids } }));
    toast(`Brief for ${ids.length} ready`);
    done();
  };

  const mark = async (next: "fixed" | "ignored" | "open") => {
    const { changed } = await bulk.run({ body: { error_group_ids: picked.slice(0, 50), status: next } });
    toast(`${changed} marked ${FAULT_STATUS[next].text.toLowerCase()}`);
    done();
  };

  const filterFields = (
    <>
      <FilterSelect
        label="Status"
        value={filters.status}
        onChange={(v) => setFilters((f) => ({ ...f, status: v as FaultStatusFilter }))}
        options={[["active", "Open or Handling"], ["open", "Open"], ["handling", "Being Handled"], ["fixed", "Fixed"], ["ignored", "Ignored"], ["all", "Any Status"]]}
      />
      <FilterSelect
        label="Severity"
        value={filters.severity ?? ""}
        onChange={(v) => setFilters((f) => ({ ...f, severity: (v || undefined) as FaultRow["severity"] | undefined }))}
        options={[["", "Any Severity"], ["fatal", "Crash"], ["error", "Error"], ["warning", "Warning"], ["notice", "Form"]]}
      />
    </>
  );

  return (
    <>
      <DesktopOnly>
        <Toolbar label="Faults" className="mt-3">
          <SearchInput value={list.q} onChange={list.setQ} placeholder="Message or route" />
          {filterFields}
        </Toolbar>
      </DesktopOnly>
      <PhoneOnly>
        <div className="mt-3">
          <SearchInput value={list.q} onChange={list.setQ} placeholder="Message or route" />
        </div>
      </PhoneOnly>

      {picked.length > 0 && (
        <Card className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-sm">{picked.length} picked</b>
            {canExport && (
              <HelpTerm help={BRIEF}>
                <Button variant="primary" icon="download" onClick={download}>
                  Download Brief
                </Button>
              </HelpTerm>
            )}
            {canEdit && <Button onClick={() => mark("fixed")}>Mark Fixed</Button>}
            {canEdit && <Button onClick={() => mark("ignored")}>Ignore Faults</Button>}
            {canEdit && filters.status !== "active" && <Button onClick={() => mark("open")}>Open Again</Button>}
            <Button variant="ghost" onClick={() => setPicked([])}>
              Clear Picked
            </Button>
          </div>
        </Card>
      )}

      <DataView<FaultRow>
        className="mt-3"
        title="Faults"
        list={list}
        rowKey={(f) => f.error_group_id}
        noun="fault"
        onRowClick={(f) =>
          modal.open({
            title: f.title,
            wide: true,
            body: (close) => <Fault id={f.error_group_id} canEdit={canEdit} close={close} />,
          })
        }
        empty={{ title: "Nothing Has Failed", text: "Faults show here within five minutes.", icon: "check" }}
        columns={[
          {
            key: "tick",
            label: <Tick checked={allPicked} onChange={togglePage} label="Select Page" />,
            render: (f) => <Tick checked={picked.includes(f.error_group_id)} onChange={() => toggle(f.error_group_id)} label={`Select ${f.title}`} />,
          },
          {
            key: "fault",
            label: "Fault",
            render: (f) => (
              <div className="min-w-0">
                <b data-copy="content" className="block truncate">{f.title}</b>
                <span className="text-xs text-subtle-foreground">
                  {ORIGIN[f.origin]}
                  {f.route ? ` · ${f.route}` : ""}
                </span>
              </div>
            ),
          },
          { key: "severity", label: "Severity", render: (f) => <Pill tone={SEVERITY[f.severity].tone}>{SEVERITY[f.severity].text}</Pill> },
          { key: "today", label: "Today", align: "n", sortable: true, render: (f) => f.today.toLocaleString("en-NG") },
          { key: "total", label: "On Record", align: "n", desktop: true, render: (f) => f.total.toLocaleString("en-NG") },
          { key: "people", label: <HelpTerm help={PEOPLE}>People</HelpTerm>, align: "n", desktop: true, render: (f) => f.people.toLocaleString("en-NG") },
          { key: "last", label: "Last Seen", desktop: true, sortable: true, render: (f) => formatDateTime(f.last_seen_at) },
          {
            key: "status",
            label: "Status",
            render: (f) => (
              <>
                <Pill tone={FAULT_STATUS[f.status].tone}>{FAULT_STATUS[f.status].text}</Pill>
                {f.came_back && (
                  <HelpTerm help={CAME_BACK}>
                    <Pill tone="warn">Came Back</Pill>
                  </HelpTerm>
                )}
              </>
            ),
          },
        ]}
      />
    </>
  );
}

/** One fault: what it is, when, the latest occurrences, and what the team decided. */
function Fault({ id, canEdit, close }: { id: string; canEdit: boolean; close: () => void }) {
  const f = useApi("GET /api/v1/system-health/faults/:id", { params: { id } });
  const patch = useMutation("PATCH /api/v1/system-health/faults/:id");
  const [note, setNote] = useState("");
  const [showStack, setShowStack] = useState(false);
  const d: FaultDetail | undefined = f.data;

  if (f.error) return <ErrorState error={f.error} onRetry={f.reload} />;
  if (!d) return <LoadingRows count={6} />;

  const set = async (status: FaultDetail["status"]) => {
    await patch.run({ params: { id }, body: { status, ...(note.trim() ? { note: note.trim() } : {}) } });
    invalidate("/api/v1/system-health");
    close();
    toast(`Marked ${FAULT_STATUS[status].text.toLowerCase()}`);
  };

  const worst = Math.max(1, ...d.daily.map((x) => x.events));

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <Pill tone={SEVERITY[d.severity].tone}>{SEVERITY[d.severity].text}</Pill>
        <Pill tone={FAULT_STATUS[d.status].tone}>{FAULT_STATUS[d.status].text}</Pill>
        {d.came_back && <Pill tone="warn">Came Back {d.regressions}</Pill>}
      </div>
      <p data-copy="content" className="text-sm">{d.plainly}</p>
      <KeyValue
        className="mt-3"
        items={[
          ["Where", d.frame ?? d.route ?? "Not recorded"],
          ["Route", d.route],
          ["First seen", `${formatDateTime(d.first_seen_at)} on ${d.first_release ?? "an unknown build"}`],
          ["Last seen", `${formatDateTime(d.last_seen_at)} on ${d.last_release ?? "an unknown build"}`],
          ["How often", `${d.today} today, ${d.total} on record, ${d.people} people`],
          ["Held by", d.assigned_name],
        ]}
      />
      <DesktopOnly unmount>
        <Bars
          className="mt-3"
          rows={d.daily.map((x) => ({ label: x.day, value: String(x.events), percent: Math.round((x.events * 100) / worst) }))}
          note="The last 14 days"
        />
      </DesktopOnly>

      {d.occurrences[0] && (
        <Card className="mt-3" as="section">
          <CardHeader
            title="Latest"
            level={3}
            right={
              d.occurrences[0].stack ? (
                <Button size="sm" variant="ghost" onClick={() => setShowStack((v) => !v)}>
                  {showStack ? "Hide Stack" : "Show Stack"}
                </Button>
              ) : undefined
            }
          />
          <p data-copy="content" className="wrap-any text-xs">{d.occurrences[0].message}</p>
          {showStack && d.occurrences[0].stack && (
            <pre data-copy="content" className="mt-2 overflow-x-auto rounded-box bg-subtle p-2 text-2xs">{d.occurrences[0].stack}</pre>
          )}
        </Card>
      )}

      {d.notes.length > 0 && (
        <DataView
          className="mt-3"
          caption="Notes"
          rows={d.notes}
          rowKey={(n) => n.error_group_note_id}
          bare
          columns={[
            { key: "who", label: "Who", render: (n) => n.author_name ?? "System" },
            { key: "what", label: "Note", render: (n) => <span data-copy="content">{n.body}</span> },
            { key: "when", label: "When", render: (n) => formatDateTime(n.created_at) },
          ]}
        />
      )}

      {canEdit && (
        <Field label="Note" optional className="mt-3">
          <TextAreaField value={note} onChange={setNote} placeholder="What you found" />
        </Field>
      )}

      <FormFooter>
        {canEdit && d.status !== "ignored" && <Button onClick={() => set("ignored")}>Ignore Fault</Button>}
        {canEdit && d.status !== "handling" && <Button onClick={() => set("handling")}>Take It On</Button>}
        {canEdit && d.status !== "fixed" && (
          <Button variant="primary" onClick={() => set("fixed")}>
            Mark Fixed
          </Button>
        )}
        <Button onClick={close}>Close</Button>
      </FormFooter>
    </>
  );
}
