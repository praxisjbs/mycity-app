import { useState } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import "@/api/types/performance";
import type { Goal, GoalLevel, KpiAssignment, ReviewRow, Target } from "@/api/types/performance";
import type { PersonRef } from "@/api/types/common";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { AreaChart } from "@/components/ui/charts";
import { Mini, Quote, Who } from "@/components/ui/data";
import { DateField } from "@/components/ui/DateField";
import { Field, FormRow, Input, Select, useForm } from "@/components/ui/form";
import { Icon } from "@/components/ui/Icon";
import { Card, CardHeader, Grid, PageHead } from "@/components/ui/layout";
import { useModal } from "@/components/ui/Modal";
import { PersonPicker } from "@/components/ui/PersonPicker";
import { FilterSelect, LoadingRows, Table, Toolbar } from "@/components/ui/Table";
import { toast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime, formatMonth } from "@/lib/format";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { BarsCard, ChainCard, ExportButton, KvCard, ModalFoot, PagedTable, StatusPill, TrailCard, useDepartmentOptions } from "@/features/shared/sections";
import type { ModuleScreenProps } from "@/shell/screens";

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
      <PageHead
        title="Goals"
        sub="Organisational and annual · set by the CEO and management"
        actions={
          <>
            <ExportButton source="performance.goals" />
            <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Goal", body: (close) => <GoalForm close={close} /> })}>New Goal</Button>
          </>
        }
      />
      {s.data && <ChainCard title="How Goals Cascade" steps={s.data.cascade} note="CEO sets organisational. Management sets annual and monthly. Unit heads set departmental. Department managers set individual KPIs. Line managers set the week." />}
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
        {s.data ? <BarsCard title="Progress Against Each Organisational Goal" rows={s.data.progress} /> : <Card><LoadingRows /></Card>}
        <KvCard
          title="Why the Cascade Matters"
          items={[
            ["The problem", "A weekly task that nobody can trace to a company goal"],
            ["The rule", "Every level names the one above it. Nothing is orphaned"],
            ["What staff see", "Their own KPI, and the whole chain above it"],
            ["What binds", "Nothing until the CEO approves. Then it dispatches"],
            ["Who sets the week", "The line manager. The employee can still add their own"],
          ]}
        />
      </Grid>
    </>
  );
}

function GoalForm({ close }: { close: () => void }) {
  const { me } = useAuth();
  const ceo = !!me?.is_ceo;
  const parents = usePaged("GET /api/v1/performance/goals", { filters: { level: "organisational" } });
  const f = useForm({ level: ceo ? "organisational" : "annual", title: "", theme: "", measure: "", baseline: "", rolls_up_to: "" }, {
    title: (v) => (v.trim().length < 4 ? "Say what the goal is" : null),
    rolls_up_to: (v, all) => (all.level === "annual" && !v ? "An annual goal names the goal above it" : null),
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
        <Select options={ceo ? [["organisational", "Organisational"], ["annual", "Annual"]] : [["annual", "Annual"]]} {...f.field("level")} />
      </Field>
      <Field label="Goal" {...f.field("title")}><Input {...f.field("title")} placeholder="e.g. Operate in 12 Nigerian cities" /></Field>
      {f.values.level === "organisational" ? (
        <>
          <Field label="Strategic Theme"><Input {...f.field("theme")} placeholder="Growth, Revenue, People" /></Field>
          <FormRow>
            <Field label="Success Measure"><Input {...f.field("measure")} placeholder="Cities live" /></Field>
            <Field label="Baseline"><Input {...f.field("baseline")} placeholder="8" /></Field>
          </FormRow>
        </>
      ) : (
        <Field label="Rolls Up To" {...f.field("rolls_up_to")}>
          <Select placeholder="Pick the organisational goal" options={parents.rows.map((g) => [g.goal_id, `${g.code} · ${g.title}`])} {...f.field("rolls_up_to")} />
        </Field>
      )}
      <p className="text-[11.5px] text-subtle-foreground">Saved as a draft. Nothing binds until the CEO approves.</p>
      <ModalFoot>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={save.pending} onClick={submit}>Add Goal</Button>
      </ModalFoot>
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
      <PageHead
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
        empty={{ title: "No targets for this month", text: "Department managers set them, then the CEO approves." }}
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
                <Button size="sm" variant="primary" disabled={approve.pending} onClick={async () => { await approve.run({ params: { id: t.target_id }, body: {} }); invalidate("/api/v1/performance/targets"); toast(`${t.department} target approved and dispatched`); }}>Approve</Button>
              ),
          },
        ]}
      />
      {s.data && (
        <Grid cols={2} className="mt-3">
          <BarsCard title={`${formatMonth(shiftMonth(s.data.month, -1)).split(" ")[0]}, How They Landed`} rows={s.data.last_month} note="A target that lands under 50% raises a query on the owner. That rule is currently a draft." />
          <TrailCard title={`${formatMonth(s.data.month).split(" ")[0]} Approval Trail`} items={s.data.trail.map((x) => ({ ...x, when: formatDateTime(x.when) }))} />
        </Grid>
      )}
    </>
  );
}

function TargetForm({ close, month }: { close: () => void; month: string }) {
  const depts = useDepartmentOptions("Pick the department");
  const goals = usePaged("GET /api/v1/performance/goals", { filters: { level: "annual" } });
  const f = useForm({ department: "", title: "", measure: "", rolls_up_to: "" }, {
    department: (v) => (!v ? "Pick the department" : null),
    title: (v) => (v.trim().length < 4 ? "Say what the target is" : null),
    measure: (v) => (!v.trim() ? "How is it measured" : null),
    rolls_up_to: (v) => (!v ? "Every target names the goal above it" : null),
  });
  const save = useMutation("POST /api/v1/performance/targets");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: { month, ...f.values } });
      invalidate("/api/v1/performance/targets");
      close();
      toast("Target submitted. It goes to the CEO for approval");
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <p className="mb-3 text-[12.5px] text-muted-foreground">For {formatMonth(month)}. It binds once the CEO approves.</p>
      <Field label="Department" {...f.field("department")}><Select options={depts.slice(1)} placeholder="Pick the department" {...f.field("department")} /></Field>
      <Field label="Target" {...f.field("title")}><Input {...f.field("title")} placeholder="e.g. 8 new prospects, 3 proposals sent" /></Field>
      <FormRow>
        <Field label="Measure" {...f.field("measure")}><Input {...f.field("measure")} placeholder="Count, days, date" /></Field>
        <Field label="Rolls Up To" {...f.field("rolls_up_to")}><Select placeholder="Pick the annual goal" options={goals.rows.map((g) => [g.goal_id, g.title])} {...f.field("rolls_up_to")} /></Field>
      </FormRow>
      <ModalFoot>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={save.pending} onClick={submit}>Submit for Approval</Button>
      </ModalFoot>
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
  const total = s.data?.sources.reduce((a, x) => a + x.count, 0) ?? 0;
  return (
    <>
      <PageHead title="KPIs" sub="Individual monthly KPIs · set by department managers" actions={<Button variant="primary" icon="plus" onClick={() => assign()}>Assign KPIs</Button>} />
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
          title={`How ${total} KPIs Are Measured`}
          rows={s.data?.sources ?? []}
          rowKey={(r) => r.label}
          loading={s.loading}
          columns={[{ key: "l", label: "Where Progress Comes From", render: (r) => r.label }, { key: "c", label: "Counts", align: "n", render: (r) => r.count }]}
        />
      </Grid>
      <p className="mt-3 text-[11.5px] text-subtle-foreground">Weights per employee total 100%. Progress counts automatically from tasks linked to the KPI. Pick a row to see that person's weights.</p>
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
          <span className="w-[150px] flex-none"><Mini pct={Math.min(100, r.weight_pct * 2.5)} label={`${r.weight_pct}%`} /></span>
        </div>
      ))}
      <div className="mt-1 flex gap-2.5 border-t-2 border-border pt-[9px]">
        <b className="flex-1 text-[12.5px]">Total</b>
        <b className={cn("text-[12.5px]", ok ? "text-success" : "text-destructive")}>{k.data?.total_pct ?? 0}%</b>
      </div>
      <p className="mt-[11px] text-[11.5px] text-subtle-foreground">The form will not save at 95% or 105%. It is a constraint, not a warning.</p>
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
        <Field label="KPIs and Weights" state={tried && total !== 100 ? "bad" : undefined} message={tried && total !== 100 ? `Weights total ${total}%. They must total 100%` : undefined}>
          <div className="flex flex-col gap-1.5">
            {items.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input value={r.title} onChange={(v) => set(i, "title", v)} placeholder={`KPI ${i + 1}`} aria-label={`KPI ${i + 1}`} />
                <span className="relative w-[84px] flex-none">
                  <Input value={r.weight} onChange={(v) => set(i, "weight", v)} inputMode="numeric" aria-label={`Weight of KPI ${i + 1}`} className="pr-7 text-right" />
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
      <ModalFoot>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={save.pending || total !== 100} onClick={submit}>Save KPIs</Button>
      </ModalFoot>
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
      <PageHead
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
          <p className="mb-2.5 text-[11.5px] text-subtle-foreground">Speak instead of typing. The assistant tidies the wording against your goals. It does not change what you said.</p>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-muted p-3">
            <Button variant="primary" className="size-10 justify-center rounded-full p-0" aria-label="Record an answer" onClick={() => toast("Dictation opens inside the review form when the cycle starts")}><Icon name="spark" /></Button>
            <span className="text-[11.5px] text-subtle-foreground">Tap to record your answer to “What went well this quarter?”</span>
          </div>
          <Quote className="mt-3">“We closed the Providus sponsorship and got the Lagos venues confirmed, but I was slow on the Eko follow-up.”</Quote>
          <p className="mt-[9px] text-[11.5px] text-subtle-foreground">Transcribed, then tidied. The original recording and the raw transcript are both kept.</p>
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
const FormOutlineCard = () => <KvCard title="What the Form Asks" items={OUTLINE} />;
const FormOutline = () => <KvCard title="Quarterly Review" items={OUTLINE} />;

function CycleForm({ close }: { close: () => void }) {
  const f = useForm({ name: "", opens_on: "" }, { name: (v) => (!v.trim() ? "Name the cycle, e.g. Q1 2027" : null), opens_on: (v) => (!v ? "Pick the day it opens" : null) });
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
      <FormRow>
        <Field label="Cycle" {...f.field("name")}><Input {...f.field("name")} placeholder="Q1 2027" /></Field>
        <Field label="Opens On" {...f.field("opens_on")}><DateField {...f.field("opens_on")} /></Field>
      </FormRow>
      <p className="text-[11.5px] text-subtle-foreground">Staff are told when it opens. Self ratings come first; managers see the form only after.</p>
      <ModalFoot>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={save.pending} onClick={submit}>Open Cycle</Button>
      </ModalFoot>
    </>
  );
}

/* ───────────── Analytics ───────────── */

function Analytics() {
  const a = useApi("GET /api/v1/performance/analytics");
  if (!a.data) return (<><PageHead title="Analytics" sub="Performance across the organisation" /><Card><LoadingRows count={6} /></Card></>);
  const d = a.data;
  return (
    <>
      <PageHead title="Analytics" sub="Performance across the organisation" />
      <KpiTiles items={[{ label: "Goals On Track", value: d.goals_on_track, tone: "ok" }, { label: "Reviews Completed", value: d.reviews_completed }, { label: "Avg Self Rating", value: d.average_self }, { label: "Avg Manager Rating", value: d.average_manager }]} />
      <Grid cols={2}>
        <AreaChart title="Goal Completion by Month" values={d.completion.values} labels={d.completion.labels} />
        <BarsCard title="By Department" rows={d.by_department} />
      </Grid>
      <Grid cols={2}>
        <Table
          title="Self Rating Against Manager Rating"
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
        <KvCard
          title="What the Gap Means"
          items={[
            ["A small gap", "Expected. People rate themselves a little higher"],
            ["A wide gap", "The KPI was not clear, or the conversation did not happen"],
            ["A negative gap", "Rare, and worth a conversation either way"],
            ["The widest gap", "Read it with the department's targets: the two usually move together"],
            ["Not a score", "This is a prompt for a conversation, not a ranking"],
          ]}
        />
      </Grid>
    </>
  );
}
