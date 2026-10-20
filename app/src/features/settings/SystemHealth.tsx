import { useEffect, useState } from "react";
import type { FaultDetail, FaultRow, HealthCheck } from "@mycity/contract/contract.gen.ts";
import { api } from "@/api/client";
import { saveExport } from "@/api/exports";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { useSearchParams } from "@/lib/router";
import { KpiTiles } from "@/features/shared/KpiTiles";
import {
  Bars,
  Button,
  Card,
  CardHeader,
  DataView,
  Details,
  DesktopOnly,
  ErrorState,
  Field,
  FilterSelect,
  formatDateTime,
  FormFooter,
  HelpTerm,
  KeyValue,
  LoadingRows,
  PageHeader,
  PhoneOnly,
  Pill,
  SearchInput,
  TextAreaField,
  Tick,
  toast,
  Toolbar,
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

const CAME_BACK = "A fault somebody marked fixed that has happened again.";
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
  const status = useApi("GET /api/v1/system-health/status");
  const s = status.data;

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
        actions={s ? <Pill tone={s.state === "ready" ? "ok" : s.state === "degraded" ? "warn" : "err"}>{s.state === "ready" ? "All Up" : s.state === "degraded" ? "Degraded" : "Unavailable"}</Pill> : undefined}
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
      <Checks checks={s?.checks} loading={status.loading} />
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
function Checks({ checks, loading }: { checks?: HealthCheck[]; loading: boolean }) {
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
                <div className="text-xs text-muted-foreground">{c.detail}</div>
                {c.look_at && <Details title="Where to Look">{c.look_at}</Details>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ───────────── Faults ───────────── */

function Faults({ canEdit, canExport }: { canEdit: boolean; canExport: boolean }) {
  const modal = useModal();
  // A fault linked by id (a System Health notice, shared/route-map.js) opens its sheet.
  const [params, setParams] = useSearchParams();
  const linked = params.get("id");
  useEffect(() => {
    if (!linked) return;
    let gone = false;
    api
      .call("GET /api/v1/system-health/faults/:id", { params: { id: linked } })
      .then((f) => {
        if (!gone)
          modal.open({
            title: f.title,
            wide: true,
            body: (close) => <Fault id={f.error_group_id} canEdit={canEdit} close={close} />,
            onClose: () => setParams({ id: null }, { replace: true }),
          });
      })
      .catch(() => toast("That fault is no longer kept"));
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per linked fault
  }, [linked]);
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
