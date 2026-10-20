import { useMemo, useState, type ReactNode } from "react";
import system_health from "@mycity/contract/schemas/system_health.js";
import type {
  BackgroundWork,
  DatabaseSummary,
  JobRun,
  PerformanceCapacity,
  PerformancePoint,
  PerformanceSeries,
  PerformanceTargets,
  PerformanceTargetsUpdate,
  ProcessList,
  QueryStat,
  RouteStat,
  TableStat,
} from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { useApi, useMutation, usePaged } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import {
  Banner,
  Button,
  Card,
  CardHeader,
  DataView,
  DesktopOnly,
  EmptyState,
  EmptyValue,
  ErrorState,
  Field,
  formatBytes,
  formatCount,
  formatDate,
  formatDateTime,
  formatTime,
  Grid,
  HelpTerm,
  KeyValue,
  KpiCard,
  LoadingRows,
  NumberField,
  PageHeader,
  PhoneOnly,
  Pill,
  SegmentedControl,
  StackBar,
  StatStrip,
  toast,
  TrendChart,
  useContractForm,
  useModal,
  Wizard,
  type StackBarPart,
} from "@mycity/ui";

/**
 * Settings · Performance (docs/guides/system-health.md §6, §10): availability, response
 * time and failed requests against the targets Edit Targets holds; the whole server's
 * processor, memory and disk in real units, split by what uses them; trends over the
 * window; then Slowest Routes, Database, Background Work and Processes.
 *
 * Only the Implementation Team and the System Administrator hold `system_health`.
 */

type Range = PerformanceSeries["range"];
type Tone = "ok" | "warn" | "err" | "neutral";
type Section = "routes" | "database" | "background" | "processes";

const WINDOWS: ReadonlyArray<readonly [Range, string]> = [
  ["hour", "Hour"],
  ["day", "Day"],
  ["week", "Week"],
  ["month", "Month"],
];

const TARGET_TONE: Record<PerformanceSeries["availability"]["state"], Tone | undefined> = {
  met: "ok",
  missed: "err",
  none: undefined,
};

const LEVEL: Record<NonNullable<PerformanceCapacity["cpu"]["state"]>, { tone: Tone; text: string }> = {
  up: { tone: "ok", text: "Normal" },
  degraded: { tone: "warn", text: "High" },
  down: { tone: "err", text: "Critical" },
};

/** What each part of the processor, memory and disk is called, and the series it is drawn in. */
const PART: Record<string, { label: string; series: StackBarPart["series"] }> = {
  production: { label: "Production", series: 1 },
  staging: { label: "Staging", series: 2 },
  database: { label: "Database", series: 3 },
  redis: { label: "Redis", series: 4 },
  scanner: { label: "Upload Scanner", series: 5 },
  other: { label: "Other", series: 6 },
  production_database: { label: "Production Database", series: 3 },
  production_files: { label: "Production Files", series: 1 },
  backups: { label: "Backups", series: 4 },
  logs: { label: "Logs", series: 5 },
  system: { label: "System", series: 6 },
};

const JOB_STATE: Record<JobRun["state"], { tone: Tone; text: string }> = {
  on_time: { tone: "ok", text: "On Time" },
  failing: { tone: "err", text: "Failing" },
  late: { tone: "err", text: "Late" },
  waiting: { tone: "neutral", text: "Waiting" },
};

const HELP = {
  availability: "The share of minutes in the window in which the app answered. Minutes nobody recorded are not counted either way.",
  p95: "The p95: 95 of every 100 requests were answered within this time. Mean is the plain average.",
  failed: "Requests that failed on our side, with an error of 500 or more. A mistake in the request itself does not count.",
  steal: "Time the hosting provider gave this machine's processors to other machines. Ours to raise with the provider, not to fix.",
  iowait: "Time the processor sat waiting for the disk. High means the disk, not the processor, is what is slow.",
  cache: "Memory the server lends to the disk cache and takes back the moment a service needs it. Not a problem.",
  reserved: "Space the operating system keeps back for itself, so the server can still run when the disk is full.",
  full: "When the disk will be full if it keeps growing as it has over the last 7 days.",
};

/** MB as a person reads it: "18.0 GB", "512.0 MB". */
const size = (mb: number | null | undefined) => (mb === null || mb === undefined ? null : formatBytes(mb * 1024 * 1024));
/** A share: "23%", "99.95%". */
const pctOf = (v: string | null | undefined) => (v === null || v === undefined ? null : `${v}%`);
/** A rate in KB a second: "120 KB/s", "1.4 MB/s". */
const rate = (kbs: number | null | undefined) =>
  kbs === null || kbs === undefined ? null : kbs < 1000 ? `${kbs} KB/s` : `${(kbs / 1024).toFixed(1)} MB/s`;
const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const share = (part: number | null, whole: number | null) => (part === null || whole === null || whole <= 0 ? null : Math.round((part * 100) / whole));

/** The window's buckets as the server bins them (Lagos boundaries), so a bucket with nothing in it is a gap. */
const ORIGIN = Date.UTC(1999, 11, 31, 23, 0, 0);
function timeline(s: PerformanceSeries): Array<PerformancePoint | null> {
  const step = s.bucket_minutes * 60_000;
  const byAt = new Map(s.points.map((p) => [new Date(p.at).getTime(), p]));
  const from = new Date(s.from).getTime();
  const start = ORIGIN + Math.floor((from - ORIGIN) / step) * step + step;
  const out: Array<PerformancePoint | null> = [];
  for (let t = start; t <= new Date(s.to).getTime(); t += step) out.push(byAt.get(t) ?? null);
  return out.length ? out : s.points;
}

export function PerformanceTab() {
  const { can } = useAuth();
  const modal = useModal();
  const [range, setRange] = useState<Range>("day");
  const series = useApi("GET /api/v1/system-health/performance", { query: { range } });
  const capacity = useApi("GET /api/v1/system-health/capacity");
  const canEdit = can("system_health", "edit");

  const editTargets = async () => {
    try {
      const current = await api.call("GET /api/v1/system-health/targets");
      modal.open({
        title: "Edit Targets",
        body: (close) => (
          <TargetsForm
            current={current}
            close={close}
            onSaved={() => {
              series.reload();
              capacity.reload();
            }}
          />
        ),
      });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Targets not loaded");
    }
  };

  const windowSwitch = <SegmentedControl label="Window" value={range} onChange={(v) => setRange(v as Range)} options={WINDOWS} small />;

  return (
    <>
      <PageHeader
        title="Performance"
        sub="The app and the server, against target"
        actions={
          <DesktopOnly>
            <div className="flex items-center gap-2">
              {windowSwitch}
              {canEdit && (
                <Button icon="target" onClick={editTargets}>
                  Edit Targets
                </Button>
              )}
            </div>
          </DesktopOnly>
        }
      />
      <PhoneOnly>
        <div className="mb-3 flex flex-col gap-2">
          {windowSwitch}
          {canEdit && <Button onClick={editTargets}>Edit Targets</Button>}
        </div>
      </PhoneOnly>

      {series.error ? (
        <Card>
          <ErrorState error={series.error} onRetry={series.reload} />
        </Card>
      ) : !series.data ? (
        <Card>
          <LoadingRows count={3} />
        </Card>
      ) : (
        <Headline s={series.data} />
      )}

      <Capacity c={capacity.data} error={capacity.error} reload={capacity.reload} />

      {series.data && (
        <DesktopOnly unmount>
          <Trends s={series.data} />
        </DesktopOnly>
      )}

      <Sections range={range} />
    </>
  );
}

/* ───────────── The four figures against their targets ───────────── */

function Headline({ s }: { s: PerformanceSeries }) {
  return (
    <>
      {!s.recording && (
        <Banner tone="warn" className="mb-3">
          {s.last_sample_at
            ? `Nothing recorded since ${formatDateTime(s.last_sample_at)}. See Status, Background Jobs.`
            : "Nothing has been recorded yet. See Status, Background Jobs."}
        </Banner>
      )}
      <Grid cols="4m2">
        <KpiCard
          title="Availability"
          help={HELP.availability}
          value={s.availability.value === null ? <EmptyValue label="Not recorded" /> : `${s.availability.value}%`}
          tone={TARGET_TONE[s.availability.state]}
          caption={s.down_minutes ? `Target ${s.availability.target}%, ${s.down_minutes} min down` : `Target ${s.availability.target}%`}
        />
        <KpiCard
          title="Response Time"
          help={HELP.p95}
          value={s.response_p95.value === null ? <EmptyValue label="No traffic" /> : ms(Number(s.response_p95.value))}
          tone={TARGET_TONE[s.response_p95.state]}
          caption={`Target ${ms(Number(s.response_p95.target))}`}
        />
        <KpiCard
          title="Failed Requests"
          help={HELP.failed}
          value={s.failed.value === null ? <EmptyValue label="No traffic" /> : `${s.failed.value}%`}
          tone={TARGET_TONE[s.failed.state]}
          caption={`Target ${Number(s.failed.target)}%`}
        />
        <KpiCard
          title="Requests"
          value={s.per_minute === null ? <EmptyValue label="No traffic" /> : `${s.per_minute} / min`}
          caption={s.peak_per_minute === null ? `${formatCount(s.requests)} in all` : `Peak ${formatCount(s.peak_per_minute)} / min`}
        />
      </Grid>
    </>
  );
}

/* ───────────── The server now ───────────── */

function LevelPill({ state }: { state: PerformanceCapacity["cpu"]["state"] }) {
  return state ? <Pill tone={LEVEL[state].tone}>{LEVEL[state].text}</Pill> : null;
}

/** The big figure and what it is out of. */
function Figure({ value, unit, sub }: { value: ReactNode; unit: string; sub?: ReactNode }) {
  return (
    <div className="mb-3">
      <div className="text-2xl font-semibold tabular-nums">
        {value} <span className="text-sm font-normal text-muted-foreground">{unit}</span>
      </div>
      {sub && <div className="text-xs text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  );
}

const partsOf = (parts: Array<{ key: string; mb?: number; pct?: string }>, figure: (p: { mb?: number; pct?: string }) => string): StackBarPart[] =>
  parts.map((p) => ({
    key: p.key,
    label: PART[p.key]?.label ?? p.key,
    value: p.mb ?? Number(p.pct ?? 0),
    figure: figure(p),
    series: PART[p.key]?.series,
  }));

function Capacity({ c, error, reload }: { c?: PerformanceCapacity; error: ApiError | null; reload: () => void }) {
  if (error)
    return (
      <Card className="mt-3">
        <ErrorState error={error} onRetry={reload} />
      </Card>
    );
  if (!c)
    return (
      <Card className="mt-3">
        <LoadingRows count={4} />
      </Card>
    );
  if (!c.supported)
    return (
      <Card className="mt-3">
        <EmptyState icon="chart" title="Not Available Here" text="Linux servers report these figures." />
      </Card>
    );

  const { cpu, memory, disk, network, server } = c;
  const memLeft = memory.total_mb !== null && memory.in_use_mb !== null ? memory.total_mb - memory.in_use_mb : null;
  const busy = cpu.busy_pct === null ? null : Number(cpu.busy_pct);

  return (
    <>
      <Grid cols={3} className="mt-3">
        <Card as="section">
          <CardHeader title="Processor" actions={<LevelPill state={cpu.state} />} />
          <Figure value={pctOf(cpu.busy_pct) ?? <EmptyValue />} unit="busy" sub={cpu.cores ? `${cpu.cores} cores${cpu.model ? `, ${cpu.model}` : ""}` : undefined} />
          {busy !== null && cpu.parts.length > 0 ? (
            <StackBar label="Processor by service" total={100} parts={partsOf(cpu.parts, (p) => `${p.pct}%`)} rest={{ label: "Idle", figure: `${Math.max(0, Math.round(100 - busy))}%` }} />
          ) : (
            busy !== null && <StackBar label="Processor" total={100} parts={[{ key: "busy", label: "Busy", value: busy, figure: `${cpu.busy_pct}%` }]} />
          )}
          <KeyValue
            className="mt-3"
            items={[
              [<HelpTerm key="s" help={HELP.steal}>Steal</HelpTerm>, pctOf(cpu.steal_pct)],
              [<HelpTerm key="w" help={HELP.iowait}>I/O Wait</HelpTerm>, pctOf(cpu.iowait_pct)],
              ["Peak, 24 Hours", cpu.peak_pct === null ? null : `${cpu.peak_pct}% at ${formatTime(cpu.peak_at)}`],
              ["Load, 1 Minute", cpu.load_1m],
            ]}
          />
        </Card>

        <Card as="section">
          <CardHeader title="Memory" actions={<LevelPill state={memory.state} />} />
          <Figure
            value={size(memory.in_use_mb) ?? <EmptyValue />}
            unit="in use"
            sub={memory.total_mb !== null ? `of ${size(memory.total_mb)}, ${size(memLeft)} left (${share(memLeft, memory.total_mb)}%)` : undefined}
          />
          {memory.total_mb !== null && (
            <StackBar
              label="Memory by service"
              total={memory.total_mb}
              parts={[
                ...(memory.parts.length
                  ? partsOf(memory.parts, (p) => size(p.mb ?? 0) ?? "")
                  : [{ key: "in_use", label: "In Use", value: memory.in_use_mb ?? 0, figure: size(memory.in_use_mb) ?? "", series: 1 as const }]),
                { key: "cache", label: "Cache", value: memory.cache_mb ?? 0, figure: size(memory.cache_mb) ?? "", series: "muted" as const },
              ]}
              rest={{ label: "Free", figure: size(memory.free_mb) ?? "" }}
            />
          )}
          <KeyValue
            className="mt-3"
            items={[
              [<HelpTerm key="c" help={HELP.cache}>Cache</HelpTerm>, size(memory.cache_mb)],
              ...(memory.swap_total_mb ? ([["Swap Used", `${size(memory.swap_used_mb)} of ${size(memory.swap_total_mb)}`]] as const) : []),
            ]}
          />
        </Card>

        <Card as="section">
          <CardHeader title="Disk" actions={<LevelPill state={disk.state} />} />
          <Figure
            value={size(disk.used_mb) ?? <EmptyValue />}
            unit="used"
            sub={disk.total_mb !== null ? `of ${size(disk.total_mb)}, ${size(disk.free_mb)} left (${share(disk.free_mb, disk.total_mb)}%)` : undefined}
          />
          {disk.total_mb !== null && (
            <StackBar
              label="Disk by use"
              total={disk.total_mb}
              parts={[
                ...(disk.parts.length
                  ? partsOf(disk.parts, (p) => size(p.mb ?? 0) ?? "")
                  : [{ key: "used", label: "Used", value: disk.used_mb ?? 0, figure: size(disk.used_mb) ?? "", series: 1 as const }]),
                ...(disk.reserved_mb ? [{ key: "reserved", label: "Reserved", value: disk.reserved_mb, figure: size(disk.reserved_mb) ?? "", series: "muted" as const }] : []),
              ]}
              rest={{ label: "Left", figure: size(disk.free_mb) ?? "" }}
            />
          )}
          {disk.parts.length === 0 && (
            <Pill tone="neutral" className="mt-2">
              Parts Not Measured
            </Pill>
          )}
          <KeyValue
            className="mt-3"
            items={[
              [<HelpTerm key="f" help={HELP.full}>Full In</HelpTerm>, disk.days_to_full === null ? "Not filling" : `About ${formatCount(disk.days_to_full)} days`],
              ["Growth", disk.growth_mb_per_day === null ? null : `${size(Math.abs(disk.growth_mb_per_day))} a day`],
              ["Read, Write", disk.read_kbs === null ? null : `${rate(disk.read_kbs)}, ${rate(disk.write_kbs)}`],
              ...(disk.reserved_mb ? ([[<HelpTerm key="r" help={HELP.reserved}>Reserved</HelpTerm>, size(disk.reserved_mb)]] as const) : []),
              ...(disk.parts_at ? ([["Measured", formatDateTime(disk.parts_at)]] as const) : []),
            ]}
          />
        </Card>
      </Grid>

      <Grid cols={2} className="mt-3">
        <Card as="section">
          <CardHeader title="Network" />
          <KeyValue
            items={[
              ["In, Out Now", network.in_kbs === null ? null : `${rate(network.in_kbs)}, ${rate(network.out_kbs)}`],
              ["This Month", network.month_in_mb === null ? null : `${size(network.month_in_mb)} in, ${size(network.month_out_mb)} out`],
              ["Connections", network.connections === null ? null : formatCount(network.connections)],
            ]}
          />
        </Card>
        <DesktopOnly>
          <Card as="section">
            <CardHeader title="Server" actions={server.restart_needed ? <Pill tone="warn">Restart Needed</Pill> : undefined} />
            <KeyValue
              items={[
                ["System", server.os && server.kernel ? `${server.os}, kernel ${server.kernel}` : server.os],
                ["Versions", [`Node ${server.node}`, server.postgres && `PostgreSQL ${server.postgres}`, server.redis && `Redis ${server.redis}`].filter(Boolean).join(", ")],
                ["Up Since", server.up_since ? formatDateTime(server.up_since) : null],
                ["Release", server.deployed_at ? `${server.release.slice(0, 12)}, ${formatDateTime(server.deployed_at)}` : server.release.slice(0, 12)],
                [
                  "Updates Waiting",
                  server.updates_waiting === null ? null : server.security_updates ? `${server.updates_waiting}, ${server.security_updates} security` : String(server.updates_waiting),
                ],
              ]}
            />
          </Card>
        </DesktopOnly>
      </Grid>
    </>
  );
}

/* ───────────── Trends (desktop only, §10.2) ───────────── */

function Trends({ s }: { s: PerformanceSeries }) {
  const points = useMemo(() => timeline(s), [s]);
  const at = (i: number) => new Date(new Date(s.from).getTime() + (i + 1) * s.bucket_minutes * 60_000).toISOString();
  const readout = points.map((p, i) => formatDateTime(p ? p.at : at(i)));
  const ticks = points.map((p, i) => {
    const iso = p ? p.at : at(i);
    return s.range === "hour" || s.range === "day" ? formatTime(iso) : s.range === "week" ? `${formatDate(iso).slice(0, 5)} ${formatTime(iso)}` : formatDate(iso).slice(0, 5);
  });
  const pick = (f: (p: PerformancePoint) => number | string | null) =>
    points.map((p) => {
      const v = p ? f(p) : null;
      return v === null || v === undefined ? null : Number(v);
    });
  const common = { labels: readout, ticks };

  return (
    <>
      <TrendChart
        className="mt-3"
        title="Response Time"
        {...common}
        lines={[
          { name: "p95", values: pick((p) => p.p95_ms) },
          { name: "Mean", values: pick((p) => p.mean_ms), series: 3 },
        ]}
        target={{ value: Number(s.response_p95.target), label: `Target ${ms(Number(s.response_p95.target))}` }}
        format={ms}
      />
      <Grid cols={2} className="mt-3">
        <TrendChart title="Requests" {...common} lines={[{ name: "Per Minute", values: pick((p) => p.per_minute) }]} format={(v) => `${Math.round(v * 10) / 10}`} />
        <TrendChart
          title="Failed Requests"
          {...common}
          lines={[{ name: "Failed", values: pick((p) => p.error_pct), series: 4 }]}
          target={{ value: Number(s.failed.target), label: `Target ${Number(s.failed.target)}%` }}
          format={(v) => `${Math.round(v * 100) / 100}%`}
        />
        <TrendChart
          title="Processor"
          {...common}
          max={100}
          lines={[
            { name: "Busy", values: pick((p) => p.cpu_busy_pct) },
            { name: "Steal", values: pick((p) => p.cpu_steal_pct), series: 4 },
            { name: "I/O Wait", values: pick((p) => p.cpu_iowait_pct), series: 5 },
          ]}
          format={(v) => `${Math.round(v)}%`}
        />
        <TrendChart
          title="Memory and Disk"
          {...common}
          max={100}
          lines={[
            { name: "Memory", values: pick((p) => p.memory_in_use_pct), series: 2 },
            { name: "Disk", values: pick((p) => p.disk_used_pct), series: 3 },
          ]}
          format={(v) => `${Math.round(v)}%`}
        />
        <TrendChart
          title="Disk Activity"
          {...common}
          lines={[
            { name: "Read", values: pick((p) => p.disk_read_kbs) },
            { name: "Write", values: pick((p) => p.disk_write_kbs), series: 4 },
          ]}
          format={(v) => rate(Math.round(v)) ?? ""}
        />
        <TrendChart
          title="Network"
          {...common}
          lines={[
            { name: "In", values: pick((p) => p.network_in_kbs), series: 2 },
            { name: "Out", values: pick((p) => p.network_out_kbs), series: 5 },
          ]}
          format={(v) => rate(Math.round(v)) ?? ""}
        />
        <TrendChart
          title="Availability"
          {...common}
          max={100}
          lines={[{ name: "Up", values: pick((p) => p.up_pct), series: 2 }]}
          target={{ value: Number(s.availability.target), label: `Target ${s.availability.target}%` }}
          format={(v) => `${Math.round(v * 10) / 10}%`}
        />
        <TrendChart title="People Online" {...common} lines={[{ name: "Online", values: pick((p) => p.users_online), series: 3 }]} format={(v) => `${Math.round(v)}`} />
      </Grid>
    </>
  );
}

/* ───────────── Sections ───────────── */

function Sections({ range }: { range: Range }) {
  const [section, setSection] = useState<Section>("routes");
  return (
    <section className="mt-3">
      <SegmentedControl
        label="Section"
        value={section}
        onChange={(v) => setSection(v as Section)}
        options={[
          ["routes", "Slowest Routes"],
          ["database", "Database"],
          ["background", "Background Work"],
          ["processes", "Processes"],
        ]}
      />
      <div className="mt-3">
        {section === "routes" && <Routes range={range} />}
        {section === "database" && <Database />}
        {section === "background" && <Background />}
        {section === "processes" && <Processes />}
      </div>
    </section>
  );
}

function Routes({ range }: { range: Range }) {
  const list = usePaged("GET /api/v1/system-health/routes", { filters: { range }, sort: "-p95_ms" });
  return (
    <DataView<RouteStat>
      title="Slowest Routes"
      list={list}
      rowKey={(r) => `${r.method} ${r.route}`}
      noun="route"
      empty={{ title: "No Traffic Yet", text: "Routes show here once people use the app.", icon: "chart" }}
      columns={[
        {
          key: "route",
          label: "Route",
          render: (r) => (
            <span data-copy="content" className="wrap-any">
              <b>{r.method}</b> {r.route}
            </span>
          ),
        },
        { key: "p95_ms", label: <HelpTerm help={HELP.p95}>p95</HelpTerm>, align: "n", sortable: true, render: (r) => ms(r.p95_ms) },
        { key: "mean_ms", label: "Mean", align: "n", sortable: true, render: (r) => ms(r.mean_ms) },
        { key: "requests", label: "Calls", align: "n", sortable: true, render: (r) => formatCount(r.requests) },
        { key: "errors", label: "Failed", align: "n", sortable: true, render: (r) => (r.errors ? <span className="text-destructive">{formatCount(r.errors)}</span> : "0") },
        { key: "slow", label: "Over 1 s", align: "n", desktop: true, render: (r) => formatCount(r.slow) },
        { key: "max_ms", label: "Longest", align: "n", desktop: true, render: (r) => ms(r.max_ms) },
      ]}
    />
  );
}

function Database() {
  const d = useApi("GET /api/v1/system-health/database");
  const tables = usePaged("GET /api/v1/system-health/database/tables", { sort: "-total_bytes" });
  const statements = usePaged("GET /api/v1/system-health/database/queries", { sort: "-total_ms" });
  const s: DatabaseSummary | undefined = d.data;
  if (d.error)
    return (
      <Card>
        <ErrorState error={d.error} onRetry={d.reload} />
      </Card>
    );
  if (!s)
    return (
      <Card>
        <LoadingRows count={4} />
      </Card>
    );
  const busyPct = share(s.connections_used, s.connections_max);
  return (
    <>
      <StatStrip
        label="Database"
        items={[
          { label: "Size", value: size(s.size_mb) ?? "" },
          { label: "Growth a Day", value: s.growth_mb_per_day === null ? <EmptyValue label="Not enough history" /> : size(Math.abs(s.growth_mb_per_day)) },
          { label: "Connections", value: `${s.connections_used} of ${s.connections_max}`, tone: busyPct !== null && busyPct >= 80 ? "warn" : undefined },
          { label: "Cache Hit", value: pctOf(s.cache_hit_pct) ?? <EmptyValue />, tone: s.cache_hit_pct !== null && Number(s.cache_hit_pct) < 95 ? "warn" : undefined },
          { label: "Waiting on Locks", value: String(s.waiting), tone: s.waiting ? "warn" : undefined, desktop: true },
          { label: "Deadlocks", value: formatCount(s.deadlocks), desktop: true },
        ]}
      />
      <Card className="mt-3" as="section">
        <CardHeader title="Connections" level={3} />
        <KeyValue
          items={[
            ["Active", String(s.active)],
            ["Idle", String(s.idle)],
            ["Idle in a Transaction", String(s.idle_in_transaction)],
            ["Oldest Transaction", s.oldest_transaction_s === null ? null : s.oldest_transaction_s < 60 ? `${s.oldest_transaction_s} s` : `${Math.round(s.oldest_transaction_s / 60)} min`],
            ["Temporary Files", size(s.temp_mb)],
            ["Version", `PostgreSQL ${s.version}`],
          ]}
        />
      </Card>
      <DataView<TableStat>
        className="mt-3"
        title="Largest Tables"
        list={tables}
        rowKey={(t) => t.name}
        noun="table"
        columns={[
          { key: "name", label: "Table", render: (t) => <span data-copy="content">{t.name}</span> },
          { key: "total_bytes", label: "Size", align: "n", sortable: true, render: (t) => formatBytes(t.total_bytes) },
          { key: "rows", label: "Rows", align: "n", sortable: true, render: (t) => formatCount(t.rows) },
          { key: "index", label: "Indexes", align: "n", desktop: true, render: (t) => formatBytes(t.index_bytes) },
          { key: "dead_pct", label: "Dead Rows", align: "n", sortable: true, desktop: true, render: (t) => pctOf(t.dead_pct) },
          { key: "vacuum", label: "Last Vacuum", desktop: true, render: (t) => (t.last_vacuum_at ? formatDateTime(t.last_vacuum_at) : null) },
        ]}
      />
      {s.statements ? (
        <DataView<QueryStat>
          className="mt-3"
          title="Slowest Queries"
          list={statements}
          rowKey={(q) => q.query_id}
          noun="query"
          nounPlural="queries"
          wide
          columns={[
            { key: "query", label: "Query", render: (q) => <code data-copy="content" className="wrap-any text-2xs">{q.query}</code> },
            { key: "total_ms", label: "Total Time", align: "n", sortable: true, render: (q) => `${ms(q.total_ms)}, ${q.share_pct}%` },
            { key: "mean_ms", label: "Mean", align: "n", sortable: true, render: (q) => ms(Number(q.mean_ms)) },
            { key: "calls", label: "Calls", align: "n", sortable: true, render: (q) => formatCount(q.calls) },
            { key: "max_ms", label: "Longest", align: "n", desktop: true, render: (q) => ms(q.max_ms) },
          ]}
        />
      ) : (
        <Card className="mt-3">
          <EmptyState icon="chart" title="Slow SQL Off" text="Run provision.sh again on the server." />
        </Card>
      )}
    </>
  );
}

function Background() {
  const b = useApi("GET /api/v1/system-health/background");
  const jobs = usePaged("GET /api/v1/system-health/background/jobs");
  const w: BackgroundWork | undefined = b.data;
  return (
    <>
      {b.error && (
        <Card>
          <ErrorState error={b.error} onRetry={b.reload} />
        </Card>
      )}
      {!w && !b.error && (
        <Card>
          <LoadingRows count={3} />
        </Card>
      )}
      {w && (
        <>
          <StatStrip
            label="Events"
            items={[
              { label: "Events Waiting", value: formatCount(w.outbox_waiting), tone: w.outbox_waiting > 100 ? "warn" : undefined },
              {
                label: "Oldest Waiting",
                value: w.outbox_oldest_s === null ? "None" : w.outbox_oldest_s < 60 ? `${w.outbox_oldest_s} s` : `${Math.round(w.outbox_oldest_s / 60)} min`,
                tone: w.outbox_oldest_s !== null && w.outbox_oldest_s > 300 ? "warn" : undefined,
              },
              { label: "Failed for Good", value: formatCount(w.outbox_failed), tone: w.outbox_failed ? "err" : undefined },
              { label: "Done, Last Hour", value: formatCount(w.outbox_done_hour), desktop: true },
              { label: "Workers", value: w.workers === null ? <EmptyValue /> : String(w.workers), tone: w.workers === 0 ? "err" : undefined },
            ]}
          />
          <DataView
            className="mt-3"
            title="Queues"
            rows={w.queues ?? []}
            rowKey={(q) => q.name}
            noun="queue"
            empty={{ title: "Queues Not Answering", text: "Redis did not answer. See Status.", icon: "alert" }}
            columns={[
              { key: "name", label: "Queue", render: (q) => <span data-copy="content">{q.name}</span> },
              { key: "waiting", label: "Waiting", align: "n", render: (q) => formatCount(q.waiting) },
              { key: "active", label: "Running", align: "n", render: (q) => formatCount(q.active) },
              { key: "delayed", label: "Delayed", align: "n", desktop: true, render: (q) => formatCount(q.delayed) },
              { key: "failed", label: "Failed", align: "n", render: (q) => (q.failed ? <span className="text-destructive">{formatCount(q.failed)}</span> : "0") },
            ]}
          />
        </>
      )}
      <DataView<JobRun>
        className="mt-3"
        title="Scheduled Jobs"
        list={jobs}
        rowKey={(j) => j.name}
        noun="job"
        columns={[
          {
            key: "name",
            label: "Job",
            sortable: true,
            render: (j) => (
              <div className="min-w-0">
                <b data-copy="content" className="block">{j.name}</b>
                <span className="text-xs text-subtle-foreground">{j.every}</span>
              </div>
            ),
          },
          { key: "state", label: "State", render: (j) => <Pill tone={JOB_STATE[j.state].tone}>{JOB_STATE[j.state].text}</Pill> },
          { key: "last", label: "Last Run", desktop: true, render: (j) => (j.last_run_at ? formatDateTime(j.last_run_at) : null) },
          { key: "last_ms", label: "Took", align: "n", sortable: true, render: (j) => (j.last_ms === null ? null : ms(j.last_ms)) },
          { key: "mean", label: "Mean", align: "n", desktop: true, render: (j) => (j.mean_ms === null ? null : ms(j.mean_ms)) },
          { key: "max", label: "Longest", align: "n", desktop: true, render: (j) => (j.max_ms === null ? null : ms(j.max_ms)) },
          { key: "failures", label: "Failures", align: "n", sortable: true, render: (j) => `${formatCount(j.failures)} of ${formatCount(j.runs)}` },
        ]}
      />
    </>
  );
}

function Processes() {
  const p = useApi("GET /api/v1/system-health/processes");
  const d: ProcessList | undefined = p.data;
  if (p.error)
    return (
      <Card>
        <ErrorState error={p.error} onRetry={p.reload} />
      </Card>
    );
  if (!d)
    return (
      <Card>
        <LoadingRows count={3} />
      </Card>
    );
  return (
    <>
      <StatStrip
        label="Processes"
        items={[
          { label: "People Online", value: formatCount(d.people_online) },
          { label: "Open Sockets", value: formatCount(d.sockets) },
          { label: "API Starts, 7 Days", value: formatCount(d.api_starts_7d), tone: d.api_starts_7d > 10 ? "warn" : undefined },
          { label: "Worker Starts, 7 Days", value: formatCount(d.worker_starts_7d), tone: d.worker_starts_7d > 10 ? "warn" : undefined },
        ]}
      />
      <DataView
        className="mt-3"
        title="Running Now"
        rows={d.processes}
        rowKey={(r) => r.instance}
        noun="process"
        nounPlural="processes"
        empty={{ title: "No Process Reporting", text: "Each process reports once a minute.", icon: "alert" }}
        columns={[
          { key: "role", label: "Process", render: (r) => <b>{r.role === "api" ? "API" : "Worker"}</b> },
          { key: "started", label: "Started", render: (r) => formatDateTime(r.started_at) },
          { key: "memory", label: "Memory", align: "n", render: (r) => size(r.memory_mb) },
          { key: "heap", label: "Heap", align: "n", desktop: true, render: (r) => size(r.heap_mb) },
          { key: "loop", label: "Event Loop", align: "n", render: (r) => (r.loop_delay_ms === null ? null : ms(r.loop_delay_ms)) },
          { key: "cpu", label: "CPU", align: "n", desktop: true, render: (r) => pctOf(r.cpu_pct) },
          { key: "pid", label: "PID", align: "n", desktop: true, render: (r) => String(r.pid) },
        ]}
      />
    </>
  );
}

/* ───────────── Edit Targets ───────────── */

type TargetValues = Record<
  | "availability_pct"
  | "response_p95_ms"
  | "error_pct"
  | "disk_warn_free_pct"
  | "disk_down_free_pct"
  | "memory_warn_pct"
  | "memory_down_pct"
  | "cpu_warn_pct"
  | "cpu_down_pct"
  | "connections_warn_pct"
  | "connections_down_pct",
  string
>;

const INT_KEYS = [
  "response_p95_ms",
  "disk_warn_free_pct",
  "disk_down_free_pct",
  "memory_warn_pct",
  "memory_down_pct",
  "cpu_warn_pct",
  "cpu_down_pct",
  "connections_warn_pct",
  "connections_down_pct",
] as const;

const bodyOf = (v: TargetValues) => ({
  availability_pct: v.availability_pct,
  error_pct: v.error_pct,
  ...Object.fromEntries(INT_KEYS.map((k) => [k, v[k] === "" ? NaN : Number(v[k])])),
});

function TargetsForm({ current, close, onSaved }: { current: PerformanceTargets; close: () => void; onSaved: () => void }) {
  const f = useContractForm<TargetValues>(
    {
      availability_pct: String(Number(current.availability_pct)),
      error_pct: String(Number(current.error_pct)),
      ...(Object.fromEntries(INT_KEYS.map((k) => [k, String(current[k])])) as Omit<TargetValues, "availability_pct" | "error_pct">),
    },
    { safeParse: (v: unknown) => system_health.PerformanceTargetsUpdate.safeParse(bodyOf(v as TargetValues)) },
  );
  const save = useMutation("PUT /api/v1/system-health/targets");
  const num = (key: keyof TargetValues, label: string, decimal = false) => (
    <Field label={label} {...f.status(key)}>
      <NumberField decimal={decimal} {...f.field(key)} />
    </Field>
  );
  const finish = async () => {
    try {
      await save.run({ body: bodyOf(f.values) as PerformanceTargetsUpdate });
      onSaved();
      close();
      toast("Targets saved");
    } catch (e) {
      if (e instanceof ApiError && e.fields) f.setServerErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Targets not saved");
    }
  };
  return (
    <Wizard
      finish="Save Targets"
      busy={save.pending}
      onFinish={finish}
      onCancel={close}
      steps={[
        {
          title: "Targets",
          check: () => f.check(["availability_pct", "response_p95_ms", "error_pct"]),
          body: (
            <>
              {num("availability_pct", "Availability %", true)}
              {num("response_p95_ms", "Response Time ms")}
              {num("error_pct", "Failed Requests %", true)}
            </>
          ),
        },
        {
          title: "Disk and Memory",
          check: () => f.check(["disk_warn_free_pct", "disk_down_free_pct", "memory_warn_pct", "memory_down_pct"]),
          body: (
            <>
              {num("disk_warn_free_pct", "Disk Free, Amber %")}
              {num("disk_down_free_pct", "Disk Free, Red %")}
              {num("memory_warn_pct", "Memory, Amber %")}
              {num("memory_down_pct", "Memory, Red %")}
            </>
          ),
        },
        {
          title: "Processor and Connections",
          check: () => f.check(["cpu_warn_pct", "cpu_down_pct", "connections_warn_pct", "connections_down_pct"]),
          body: (
            <>
              {num("cpu_warn_pct", "Processor, Amber %")}
              {num("cpu_down_pct", "Processor, Red %")}
              {num("connections_warn_pct", "Connections, Amber %")}
              {num("connections_down_pct", "Connections, Red %")}
            </>
          ),
        },
      ]}
    />
  );
}
