import { useState } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import "@/api/types/performance";
import type { Goal, GoalLevel, KpiAssignment, ReviewRow, Target } from "@/api/types/performance";
import type { PersonRef } from "@/api/types/common";
import { useAuth } from "@/auth/AuthProvider";
import { AreaChart } from "@/components/ui/charts";
import { LoadingRows, Table, Toolbar } from "@/components/ui/Table";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { BarsCard, ChainCard, ExportButton, KvCard, PagedTable, TrailCard, useDepartmentOptions } from "@/features/shared/sections";
import type { ModuleScreenProps } from "@/shell/screens";
import { PersonPicker } from "@/components/form";
import { Button, Meter, Quote, Who, Icon, Card, CardHeader, Grid, PageHeader, useModal, toast, cn, formatDate, formatDateTime, formatMonth, StatusPill, DateField, Field, FilterSelect, FormFooter, SelectField, TextField, useContractForm } from "@mycity/ui";

export default function Performance({ tab }: ModuleScreenProps) {
  if (tab === "targets") return <Targets />;
  if (tab === "kpis") return <Kpis />;
  if (tab === "reviews") return <Reviews />;
  if (tab === "analytics") return <Analytics />;
  return <Goals />;
}

const person = (p: PersonRef) => <Who name={p.display_name} sub={p.department ?? undefined} />;

/* ───────────── Goals ───────────── */

function Goals() {
  const modal = useModal();
  const s = useApi("GET /api/v1/performance/goals/summary");
  const org = usePaged("GET /api/v1/performance/goals", { filters: { level: "organisational" } });
  const annual = usePaged("GET /api/v1/performance/goals", { filters: { level: "annual" } });
  return (
    <>
      <PageHeader
        title="Goals"
        sub="Organisational and annual, set by management"
        actions={
          <>
            <ExportButton source="performance.goals" />
            <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Goal", body: (close) => <GoalForm close={close} /> })}>New Goal</Button>
          </>
        }
      />
      <PagedTable<Goal>
        title="Organisational Goals 2026"
        list={org}
        rowKey={(g) => g.goal_id}
        noun="goal"
        wide
        columns={[
          { key: "code", label: "Goal ID", render: (g) => <span className="font-semibold">{g.code}</span> },
          { key: "theme", label: "Strategic Theme", render: (g) => g.theme },
          { key: "goal", label: "Goal", render: (g) => g.title },
          { key: "measure", label: "Success Measure", render: (g) => g.measure, desktop: true },
          { key: "base", label: "Baseline", render: (g) => g.baseline, desktop: true },
          { key: "owner", label: "Owner", render: (g) => g.owner },
          { key: "status", label: "Status", render: (g) => <StatusPill s={g.status} /> },
        ]}
      />
      <div className="mt-3">
        <PagedTable<Goal>
          title="Annual Goals"
          list={annual}
          rowKey={(g) => g.goal_id}
          noun="goal"
          columns={[
            { key: "goal", label: "Annual Goal", render: (g) => g.title },
            { key: "up", label: "Rolls Up To", render: (g) => g.rolls_up_to },
            { key: "owner", label: "Owner", render: (g) => g.owner, desktop: true },
            { key: "q4", label: "Q4 Cascade", render: (g) => g.cascade_note, desktop: true },
            { key: "status", label: "Status", render: (g) => <StatusPill s={g.status} /> },
          ]}
        />
      </div>
      <Grid cols={2} className="mt-3">
        {s.data ? <BarsCard title="Goal Progress" rows={s.data.progress} /> : <Card><LoadingRows /></Card>}
      </Grid>
    </>
  );
}

function GoalForm({ close }: { close: () => void }) {
  const { me } = useAuth();
  const ceo = !!me?.is_ceo;
  const parents = usePaged("GET /api/v1/performance/goals", { filters: { level: "organisational" } });
  const f = useContractForm({ level: ceo ? "organisational" : "annual", title: "", theme: "", measure: "", baseline: "", rolls_up_to: "" }, {
    title: (v) => (v.trim().length < 4 ? "Name the goal" : null),
    rolls_up_to: (v, all) => (all.level === "annual" && !v ? "Pick the parent goal" : null),
  });
  const save = useMutation("POST /api/v1/performance/goals");
  const submit = async () => {
    if (!f.check()) return;
    const v = f.values;
    try {
      const g = await save.run({ body: { level: v.level as GoalLevel, title: v.title.trim(), ...(v.theme && { theme: v.theme }), ...(v.measure && { measure: v.measure }), ...(v.baseline && { baseline: v.baseline }), ...(v.level === "annual" && { rolls_up_to: v.rolls_up_to }) } });
      invalidate("/api/v1/performance/goals");
      close();
      toast(g.code ? `${g.code} added as a draft` : "Annual goal added as a draft");
    } catch (e) {
      f.setServerErrors(save.fields);
      if (e instanceof ApiError && e.status === 403) toast(e.message);
    }
  };
  return (
    <>
      <Field label="Level">
        <SelectField options={ceo ? [["organisational", "Organisational"], ["annual", "Annual"]] : [["annual", "Annual"]]} {...f.field("level")} />
      </Field>
      <Field label="Goal" {...f.field("title")}><TextField {...f.field("title")} placeholder="Operate in 12 cities" /></Field>
      {f.values.level === "organisational" ? (
        <>
          <Field label="Strategic Theme"><TextField {...f.field("theme")} placeholder="Growth, Revenue, People" /></Field>
          <Field label="Success Measure"><TextField {...f.field("measure")} placeholder="Cities live" /></Field>
          <Field label="Baseline"><TextField {...f.field("baseline")} placeholder="8" /></Field>
        </>
      ) : (
        <Field label="Rolls Up To" {...f.field("rolls_up_to")}>
          <SelectField placeholder="Organisational goal" options={parents.rows.map((g) => [g.goal_id, `${g.code} · ${g.title}`])} {...f.field("rolls_up_to")} />
        </Field>
      )}
      <p className="text-[11.5px] text-subtle-foreground">Saved as a draft. Nothing binds until the CEO approves.</p>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Add Goal</Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Targets ───────────── */

const shiftMonth = (m: string, d: number) => {
  const [y, mm] = m.split("-").map(Number);
  const x = new Date(Date.UTC(y, mm - 1 + d, 1));
  return x.toISOString().slice(0, 7);
};

function Targets() {
  const modal = useModal();
  const [month, setMonth] = useState<string | null>(null);
  const s = useApi("GET /api/v1/performance/targets/summary", { query: month ? { month } : {} });
  const m = month ?? s.data?.month ?? "";
  const list = usePaged("GET /api/v1/performance/targets", { filters: m ? { month: m } : {}, enabled: !!m });
  const approve = useMutation("POST /api/v1/performance/targets/:id/approve");
  const current = s.data?.month;
  return (
    <>
      <PageHeader
        title="Targets"
        sub={`Monthly and departmental · ${formatMonth(m)}`}
        actions={
          <>
            <Button icon="left" onClick={() => setMonth(shiftMonth(m, -1))} disabled={!m}>Previous Month</Button>
            {month && month !== current && <Button onClick={() => setMonth(null)}>This Month</Button>}
            <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "Set Targets", body: (close) => <TargetForm close={close} month={m} /> })}>Set Targets</Button>
          </>
        }
      />
      {s.data && (
        <>
          <KpiTiles items={[{ label: "Departments", value: String(s.data.departments) }, { label: "Approved", value: String(s.data.approved), tone: "ok" }, { label: "Awaiting CEO", value: String(s.data.awaiting), tone: s.data.awaiting ? "warn" : "ok" }, { label: "Binding From", value: "On approval" }]} />
          <ChainCard steps={s.data.chain} note="Nothing becomes binding until the CEO approves. Only then does it dispatch to staff." />
        </>
      )}
      <PagedTable<Target>
        title={`Departmental Targets, ${formatMonth(m).split(" ")[0]}`}
        list={list}
        rowKey={(t) => t.target_id}
        noun="target"
        wide
        empty={{ title: "No Targets Yet", text: "Department managers set them, then the CEO approves." }}
        columns={[
          { key: "dept", label: "Department", render: (t) => <span className="font-semibold">{t.department}</span> },
          { key: "target", label: "Target", render: (t) => t.title },
          { key: "up", label: "Rolls Up To", render: (t) => t.rolls_up_to, desktop: true },
          { key: "by", label: "Set By", render: (t) => t.set_by.display_name, desktop: true },
          { key: "measure", label: "Measure", render: (t) => t.measure, desktop: true },
          { key: "status", label: "Status", render: (t) => <StatusPill s={t.status} /> },
          {
            key: "act", label: "", render: (t) =>
              t.can_approve && (
                <Button size="sm" variant="primary" busy={approve.pending} onClick={async () => { await approve.run({ params: { id: t.target_id }, body: {} }); invalidate("/api/v1/performance/targets"); toast(`${t.department} target approved and dispatched`); }}>Approve</Button>
              ),
          },
        ]}
      />
      {s.data && (
        <Grid cols={2} className="mt-3">
          <BarsCard title={`${formatMonth(shiftMonth(s.data.month, -1)).split(" ")[0]} Results`} rows={s.data.last_month} />
          <TrailCard title={`${formatMonth(s.data.month).split(" ")[0]} Approval Trail`} items={s.data.trail.map((x) => ({ ...x, when: formatDateTime(x.when) }))} />
        </Grid>
      )}
    </>
  );
}

function TargetForm({ close, month }: { close: () => void; month: string }) {
  const depts = useDepartmentOptions("Pick the department");
  const goals = usePaged("GET /api/v1/performance/goals", { filters: { level: "annual" } });
  const f = useContractForm({ department: "", title: "", measure: "", rolls_up_to: "" }, {
    department: (v) => (!v ? "Pick the department" : null),
    title: (v) => (v.trim().length < 4 ? "Name the target" : null),
    measure: (v) => (!v.trim() ? "How is it measured" : null),
    rolls_up_to: (v) => (!v ? "Pick the parent goal" : null),
  });
  const save = useMutation("POST /api/v1/performance/targets");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: { month, ...f.values } });
      invalidate("/api/v1/performance/targets");
      close();
      toast("Target sent to the CEO for approval");
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <p className="mb-3 text-[12.5px] text-muted-foreground">For {formatMonth(month)}. It binds once the CEO approves.</p>
      <Field label="Department" {...f.field("department")}><SelectField options={depts.slice(1)} placeholder="Pick the department" {...f.field("department")} /></Field>
      <Field label="Target" {...f.field("title")}><TextField {...f.field("title")} placeholder="8 new prospects" /></Field>
      <Field label="Measure" {...f.field("measure")}><TextField {...f.field("measure")} placeholder="Count, days, date" /></Field>
      <Field label="Rolls Up To" {...f.field("rolls_up_to")}><SelectField placeholder="Annual goal" options={goals.rows.map((g) => [g.goal_id, g.title])} {...f.field("rolls_up_to")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Submit for Approval</Button>
      </FormFooter>
    </>
  );
}

/* ───────────── KPIs ───────────── */

function Kpis() {
  const modal = useModal();
  const [dept, setDept] = useState("");
  const depts = useDepartmentOptions();
  const s = useApi("GET /api/v1/performance/kpis/summary");
  const list = usePaged("GET /api/v1/performance/kpis", { filters: dept ? { department: dept } : {} });
  const [who, setWho] = useState<PersonRef | null>(null);
  const shown = who ?? list.rows.find((r) => r.employee.display_name.startsWith("Chidera"))?.employee ?? list.rows[0]?.employee ?? null;
  const assign = (p?: PersonRef) => modal.open({ title: "Assign KPIs", body: (close) => <AssignKpis close={close} initial={p} /> });
  return (
    <>
      <PageHeader title="KPIs" sub="Individual monthly KPIs · set by department managers" actions={<Button variant="primary" icon="plus" onClick={() => assign()}>Assign KPIs</Button>} />
      {s.data && <KpiTiles items={[{ label: "Staff With KPIs", value: `${s.data.with_kpis} / ${s.data.staff}` }, { label: "Weights", value: s.data.weights_valid ? "100%" : "Check", tone: s.data.weights_valid ? "ok" : "err" }, { label: "On Track", value: String(s.data.on_track), tone: "ok" }, { label: "Behind or At Risk", value: String(s.data.behind), tone: "warn" }]} />}
      <Toolbar>
        <FilterSelect label="Department" value={dept} onChange={setDept} options={depts} />
      </Toolbar>
      <PagedTable<KpiAssignment>
        title="This Month"
        list={list}
        search="Search people or KPIs"
        rowKey={(k) => k.kpi_id}
        noun="KPI"
        onRowClick={(k) => setWho(k.employee)}
        columns={[
          { key: "emp", label: "Employee", render: (k) => person(k.employee) },
          { key: "kpi", label: "KPI", render: (k) => k.title },
          { key: "w", label: "Weight", align: "n", render: (k) => `${k.weight_pct}%` },
          { key: "p", label: "Progress", align: "n", render: (k) => k.progress, desktop: true },
          { key: "by", label: "Set By", render: (k) => k.set_by.display_name, desktop: true },
          { key: "s", label: "Status", render: (k) => <StatusPill s={k.status} /> },
        ]}
      />
      <Grid cols={2} className="mt-3">
        {shown ? <WeightsCard p={shown} onEdit={() => assign(shown)} /> : <Card><LoadingRows /></Card>}
        <Table
          title="KPI Sources"
          rows={s.data?.sources ?? []}
          rowKey={(r) => r.label}
          loading={s.loading}
          columns={[{ key: "l", label: "Where Progress Comes From", render: (r) => r.label }, { key: "c", label: "Counts", align: "n", render: (r) => r.count }]}
        />
      </Grid>
    </>
  );
}

function WeightsCard({ p, onEdit }: { p: PersonRef; onEdit: () => void }) {
  const k = useApi("GET /api/v1/performance/kpis/employees/:id", { params: { id: p.employee_id } });
  const ok = k.data?.total_pct === 100;
  return (
    <Card>
      <CardHeader title="Weights Must Total 100%" right={k.data && <StatusPill s={ok ? { tone: "ok", text: "All valid" } : { tone: "err", text: `${k.data.total_pct}%` }} />} />
      <p className="mb-[11px] text-[11.5px] text-subtle-foreground">{p.display_name}, {k.data ? `${k.data.items.length} KPI${k.data.items.length === 1 ? "" : "s"} this month` : "loading"}.</p>
      {k.data?.items.map((r) => (
        <div key={r.kpi_id} className="flex items-center gap-2.5 py-[7px]">
          <span className="flex-1 text-[12.5px]">{r.title}</span>
          <span className="w-[150px] flex-none"><Meter pct={Math.min(100, r.weight_pct * 2.5)} label={`${r.weight_pct}%`} /></span>
        </div>
      ))}
      <div className="mt-1 flex gap-2.5 border-t-2 border-border pt-[9px]">
        <b className="flex-1 text-[12.5px]">Total</b>
        <b className={cn("text-[12.5px]", ok ? "text-success" : "text-destructive")}>{k.data?.total_pct ?? 0}%</b>
      </div>
      <Button size="sm" className="mt-2" onClick={onEdit}>Edit Weights</Button>
    </Card>
  );
}

function AssignKpis({ close, initial }: { close: () => void; initial?: PersonRef }) {
  const [who, setWho] = useState<PersonRef[]>(initial ? [initial] : []);
  const existing = useApi("GET /api/v1/performance/kpis/employees/:id", { params: { id: who[0]?.employee_id ?? "" }, enabled: !!who[0] });
  const [rows, setRows] = useState<Array<{ title: string; weight: string }> | null>(null);
  const items = rows ?? (existing.data?.items.map((i) => ({ title: i.title, weight: String(i.weight_pct) })) ?? [{ title: "", weight: "" }]);
  const total = items.reduce((s, r) => s + (Number(r.weight) || 0), 0);
  const [tried, setTried] = useState(false);
  const save = useMutation("POST /api/v1/performance/kpis/assign");
  const set = (i: number, k: "title" | "weight", v: string) => setRows(items.map((r, j) => (j === i ? { ...r, [k]: k === "weight" ? v.replace(/[^\d]/g, "").slice(0, 3) : v } : r)));
  const submit = async () => {
    setTried(true);
    if (!who.length || total !== 100 || items.some((r) => !r.title.trim())) return;
    try {
      await save.run({ body: { employee_id: who[0].employee_id, month: new Date().toISOString().slice(0, 7), items: items.map((r) => ({ title: r.title.trim(), weight_pct: Number(r.weight) })) } });
      invalidate("/api/v1/performance/kpis");
      close();
      toast(`KPIs saved for ${who[0].display_name}`);
    } catch (e) {
      toast(e instanceof ApiError ? (e.fields?.items?.[0] ?? e.message) : "Could not save");
    }
  };
  return (
    <>
      <Field label="Employee" state={tried && !who.length ? "bad" : undefined} message={tried && !who.length ? "Pick the employee" : undefined}>
        <PersonPicker value={who} onChange={(v) => (setWho(v), setRows(null))} />
      </Field>
      {who.length > 0 && (
        <Field label="KPIs and Weights" state={tried && total !== 100 ? "bad" : undefined} message={tried && total !== 100 ? "Must total 100%" : undefined}>
          <div className="flex flex-col gap-1.5">
            {items.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <TextField value={r.title} onChange={(v) => set(i, "title", v)} placeholder={`KPI ${i + 1}`} aria-label={`KPI ${i + 1}`} />
                <span className="relative w-[84px] flex-none">
                  <TextField value={r.weight} onChange={(v) => set(i, "weight", v)} inputMode="numeric" aria-label={`Weight of KPI ${i + 1}`} className="pr-7 text-right" />
                  <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[12px] text-subtle-foreground">%</span>
                </span>
                <button type="button" aria-label={`Remove KPI ${i + 1}`} className="flex size-8 flex-none items-center justify-center rounded-full text-subtle-foreground hover:bg-muted" onClick={() => setRows(items.filter((_, j) => j !== i))}><Icon name="x" /></button>
              </div>
            ))}
            <div className="flex items-center justify-between pt-1">
              <Button size="sm" icon="plus" onClick={() => setRows([...items, { title: "", weight: "" }])}>Add KPI</Button>
              <b className={cn("text-[12.5px]", total === 100 ? "text-success" : "text-destructive")}>Total {total}%</b>
            </div>
          </div>
        </Field>
      )}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Save KPIs</Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Reviews ───────────── */

function Reviews() {
  const modal = useModal();
  const s = useApi("GET /api/v1/performance/reviews/summary");
  const list = usePaged("GET /api/v1/performance/reviews");
  return (
    <>
      <PageHeader
        title="Reviews"
        sub={s.data ? `${s.data.cycle} cycle opens ${formatDate(s.data.opens_on)}` : " "}
        actions={
          <>
            <Button icon="doc" onClick={() => modal.open({ title: "Review Form", body: <FormOutline /> })}>Review Form</Button>
            <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "Open Cycle", body: (close) => <CycleForm close={close} /> })}>Open Cycle</Button>
          </>
        }
      />
      {s.data && (
        <>
          <KpiTiles items={[{ label: "Cycle", value: s.data.cycle }, { label: "Opens", value: formatDate(s.data.opens_on) }, { label: "Last Cycle", value: s.data.last_cycle }, { label: "Average Rating", value: s.data.average_rating }]} />
          <ChainCard steps={s.data.chain} note="The manager cannot see the form until the employee has submitted their own rating." />
        </>
      )}
      <PagedTable<ReviewRow>
        title="Review History"
        list={list}
        search="Search people"
        rowKey={(r) => r.review_id}
        noun="review"
        columns={[
          { key: "emp", label: "Employee", render: (r) => person(r.employee) },
          { key: "c", label: "Cycle", render: (r) => r.cycle },
          { key: "self", label: "Self Rating", align: "n", render: (r) => r.self_rating ?? "Not yet" },
          { key: "mgr", label: "Manager", align: "n", render: (r) => r.manager_rating ?? "Not yet" },
          { key: "sec", label: "Second Level", render: (r) => r.second_level ?? "Not yet", desktop: true },
          { key: "s", label: "Status", render: (r) => <StatusPill s={r.status} /> },
        ]}
      />
      <Grid cols={2} className="mt-3">
        <Card>
          <CardHeader title="Dictate Your Answer" right={<StatusPill s={{ tone: "info", text: "AI assisted" }} />} />
          <div className="flex items-center gap-3 rounded-xl border border-border bg-muted p-3">
            <Button variant="primary" className="size-10 max-md:size-11 justify-center rounded-full p-0" aria-label="Record an answer" onClick={() => toast("Dictation opens when the review cycle starts")}><Icon name="spark" /></Button>
            <span className="text-[11.5px] text-subtle-foreground">Tap to record your answer to “What went well this quarter?”</span>
          </div>
          <Quote className="mt-3">“We closed the Providus sponsorship and got the Lagos venues confirmed, but I was slow on the Eko follow-up.”</Quote>
        </Card>
        <FormOutlineCard />
      </Grid>
    </>
  );
}

const OUTLINE: Array<[string, string]> = [
  ["Section 1", "Rate each of your KPIs, with a comment"],
  ["Section 2", "What went well this quarter"],
  ["Section 3", "What did not, and why"],
  ["Section 4", "What support you need"],
  ["Section 5", "Your rating out of 5"],
  ["Manager sees", "All of it, only after you submit"],
  ["Second level", "The manager’s own line manager approves"],
];
const FormOutlineCard = () => <KvCard title="Review Form" items={OUTLINE} />;
const FormOutline = () => <KvCard title="Quarterly Review" items={OUTLINE} />;

function CycleForm({ close }: { close: () => void }) {
  const f = useContractForm({ name: "", opens_on: "" }, { name: (v) => (!v.trim() ? "Name the cycle" : null), opens_on: (v) => (!v ? "Pick the opening day" : null) });
  const save = useMutation("POST /api/v1/performance/reviews/cycles");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: { name: f.values.name.trim(), opens_on: f.values.opens_on } });
      invalidate("/api/v1/performance/reviews");
      close();
      toast(`${f.values.name} opens ${formatDate(f.values.opens_on)}`);
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Field label="Cycle" {...f.field("name")}><TextField {...f.field("name")} placeholder="Q1 2027" /></Field>
      <Field label="Opens On" {...f.field("opens_on")}><DateField {...f.field("opens_on")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Open Cycle</Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Analytics ───────────── */

function Analytics() {
  const a = useApi("GET /api/v1/performance/analytics");
  if (!a.data) return (<><PageHeader title="Analytics" sub="Performance across the organisation" /><Card><LoadingRows count={6} /></Card></>);
  const d = a.data;
  return (
    <>
      <PageHeader title="Analytics" sub="Performance across the organisation" />
      <KpiTiles items={[{ label: "Goals On Track", value: d.goals_on_track, tone: "ok" }, { label: "Reviews Completed", value: d.reviews_completed }, { label: "Avg Self Rating", value: d.average_self }, { label: "Avg Manager Rating", value: d.average_manager }]} />
      <Grid cols={2}>
        <AreaChart title="Goal Completion by Month" values={d.completion.values} labels={d.completion.labels} />
        <BarsCard title="By Department" rows={d.by_department} />
      </Grid>
      <Grid cols={2}>
        <Table
          title="Self vs Manager Rating"
          right={<span className="text-[11.5px] text-subtle-foreground">{d.gap_cycle}</span>}
          rows={d.gap}
          rowKey={(r) => r.department}
          columns={[
            { key: "d", label: "Department", render: (r) => r.department },
            { key: "s", label: "Self", align: "n", render: (r) => r.self },
            { key: "m", label: "Manager", align: "n", render: (r) => r.manager },
            { key: "g", label: "Gap", align: "n", render: (r) => <span className={cn(Number(r.gap) <= -0.4 && "font-semibold text-warning")}>{r.gap.replace("-", "−")}</span> },
          ]}
        />
      </Grid>
    </>
  );
}
