import { useEffect, useState } from "react";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import type { Task, TaskStatus } from "@/api/types/workspace";
import "@/api/types/workspace";
import { useMe } from "@/auth/AuthProvider";
import { Board } from "@/components/ui/Board";
import { MonthCalendar } from "@/components/ui/Calendar";
import { AreaChart } from "@/components/ui/charts";
import { Bars, Timeline } from "@/components/ui/data";
import { LoadingRows, Table, Toolbar } from "@/components/ui/Table";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { useSearchParams } from "@/lib/router";
import type { ModuleScreenProps } from "@/shell/screens";
import { PersonPicker } from "@/components/form";
import { Button, Avatar, KeyValue, Meter, Pill, Card, CardHeader, Grid, PageHeader, useModal, ErrorState, toast, formatDate, monthName, todayIso, DateField, Field, FormFooter, rules, SearchInput, SegmentedControl, SelectField, TextAreaField, TextField, useContractForm } from "@mycity/ui";

export default function Workspace({ tab }: ModuleScreenProps) {
  const [params, setParams] = useSearchParams();
  const modal = useModal();
  /* Deep link from Home's New button or the assistant: /workspace?tab=tasks&new=1&title=… */
  useEffect(() => {
    if (params.get("new") !== "1") return;
    const title = params.get("title") ?? "";
    setParams({ new: null, title: null }, { replace: true });
    modal.open({ title: "New Task", body: (close) => <TaskForm close={close} title={title} /> });
  }, [params, setParams, modal]);
  if (tab === "tasks") return <Tasks />;
  if (tab === "calendar") return <CalendarTab />;
  if (tab === "analytics") return <Analytics />;
  return <Today />;
}

function TaskCard({ t, onClick }: { t: Task; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mb-2 block w-full rounded-box border border-border bg-card p-2.5 text-left transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-2">
      <b className="mb-[7px] block text-[12.5px] leading-[1.35] font-semibold">{t.title}</b>
      <span className="flex flex-wrap items-center gap-1.5">
        <Pill tone={t.due_pill.tone}>{t.due_pill.text}</Pill>
        <Avatar name={(t.set_by ?? t.owner).display_name} size={21} />
      </span>
    </button>
  );
}

function useTaskDetail() {
  const modal = useModal();
  return (t: Task) => modal.open({ title: t.title, body: (close) => <TaskDetail t={t} close={close} /> });
}

const NEXT: Record<TaskStatus, TaskStatus | null> = { todo: "in_progress", in_progress: "in_review", in_review: "done", done: null };
const LABEL: Record<TaskStatus, string> = { todo: "To do", in_progress: "In progress", in_review: "In review", done: "Done" };

function TaskDetail({ t, close }: { t: Task; close: () => void }) {
  const patch = useMutation("PATCH /api/v1/tasks/:id");
  const move = async (status: TaskStatus) => {
    await patch.run({ params: { id: t.task_id }, body: { status } });
    invalidate("/api/v1/tasks", "/api/v1/workspace");
    close();
    toast(`Moved to ${LABEL[status]}`);
  };
  return (
    <>
      <KeyValue items={[["Number", t.number], ["Owner", t.owner.display_name], ["Set by", t.set_by?.display_name ?? "Themselves"], ["Due", t.due ? formatDate(t.due) : "No date"], ["Priority", t.priority[0].toUpperCase() + t.priority.slice(1)], ["Status", LABEL[t.status]], ...(t.linked ? ([["Linked to", t.linked.label]] as Array<[string, string]>) : [])]} />
      {t.description && <p className="mt-3 text-[12.5px] text-muted-foreground">{t.description}</p>}
      <FormFooter>
        <Button onClick={close}>Close</Button>
        {NEXT[t.status] && <Button variant="primary" iconRight="right" busy={patch.pending} onClick={() => move(NEXT[t.status]!)}>Move to {LABEL[NEXT[t.status]!]}</Button>}
      </FormFooter>
    </>
  );
}

function Today() {
  const { data, error, reload } = useApi("GET /api/v1/workspace/today");
  const openTask = useTaskDetail();
  const modal = useModal();
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <LoadingRows count={8} />;
  const over = data.my_day.filter((t) => t.due_pill.tone === "err").length;
  return (
    <>
      <PageHeader title="Today" sub={new Date(data.date).toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" }).replace(",", ",")} />
      <KpiTiles items={data.kpis} mobileCols={2} />
      <Grid cols={2}>
        <Card>
          <CardHeader title="Your Day" right={over ? <Pill tone="err">{`${over} overdue`}</Pill> : undefined} />
          {data.my_day.map((t) => <TaskCard key={t.task_id} t={t} onClick={() => openTask(t)} />)}
          {!data.my_day.length && <p className="text-[11.5px] text-subtle-foreground">Nothing due today.</p>}
        </Card>
        <Card>
          <CardHeader title="Set by Your Manager" />
          {data.set_by_manager.map((t) => <TaskCard key={t.task_id} t={t} onClick={() => openTask(t)} />)}
          <Button className="mt-1 w-full" icon="plus" onClick={() => modal.open({ title: "New Task", body: (close) => <TaskForm close={close} /> })}>Add Task</Button>
        </Card>
      </Grid>
      <Grid cols={2}>
        <Card>
          <CardHeader title="Diary" right={<span className="text-[11.5px] text-subtle-foreground">Africa/Lagos</span>} />
          {data.diary.map((d) => (
            <div key={d.time + d.title} className="flex items-start gap-[11px] border-b border-border py-[9px] last:border-b-0">
              <b className="w-[46px] flex-none text-[12.5px] font-bold">{d.time}</b>
              <span className="min-w-0 flex-1"><div className="text-[12.5px] font-semibold">{d.title}</div><div className="text-[11.5px] text-subtle-foreground">{d.sub}</div></span>
              <Pill tone={d.confirmed ? "info" : "neutral"}>{d.confirmed ? "Confirmed" : "Tentative"}</Pill>
            </div>
          ))}
        </Card>
        <Card>
          <CardHeader title="Since You Were Away" />
          <Timeline items={data.activity} />
        </Card>
      </Grid>
    </>
  );
}

const COLS: Array<[TaskStatus, string, string]> = [["todo", "To do", "var(--subtle-foreground)"], ["in_progress", "In progress", "var(--chart-2)"], ["in_review", "In review", "var(--chart-3)"], ["done", "Done", "var(--chart-1)"]];

function Tasks() {
  const me = useMe();
  const modal = useModal();
  const [scope, setScope] = useState<"mine" | "team">("mine");
  const [q, setQ] = useState("");
  const summary = useApi("GET /api/v1/tasks/summary", { query: { scope } });
  const cols = [
    { list: usePagedColumn("todo", scope, q) },
    { list: usePagedColumn("in_progress", scope, q) },
    { list: usePagedColumn("in_review", scope, q) },
    { list: usePagedColumn("done", scope, q) },
  ];
  const openTask = useTaskDetail();
  return (
    <>
      <PageHeader
        title="Tasks"
        sub="Click a card to move it along"
        actions={
          <>
            {me.manages_people && <SegmentedControl value={scope} onChange={setScope} options={[["mine", "Mine"], ["team", "My Team"]]} />}
            <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Task", body: (close) => <TaskForm close={close} /> })}>New Task</Button>
          </>
        }
      />
      {summary.data && <KpiTiles items={summary.data.kpis} mobileCols={2} />}
      <Toolbar><SearchInput value={q} onChange={setQ} placeholder="Search tasks" className="w-full md:w-[260px]" /></Toolbar>
      <Board
        columns={COLS.map(([status, label, color], i) => ({
          key: status,
          label,
          color,
          count: cols[i].list.page?.total,
          cards: cols[i].list.rows.map((t) => ({ key: t.task_id, title: t.title, meta: <Pill tone={t.due_pill.tone}>{t.due_pill.text}</Pill>, owner: t.owner.display_name, onClick: () => openTask(t) })),
        }))}
      />
    </>
  );
}

/** One kanban column: its own server page, so a column of 200 never loads 200. */
function usePagedColumn(status: TaskStatus, scope: "mine" | "team", q: string) {
  const list = usePaged("GET /api/v1/tasks", { filters: { status, scope } });
  const { setQ } = list;
  useEffect(() => setQ(q), [q, setQ]);
  return list;
}

export function TaskForm({ close, title = "" }: { close: () => void; title?: string }) {
  const me = useMe();
  const [owner, setOwner] = useState<PersonRef[]>([]);
  const f = useContractForm({ title, due: "", priority: "normal", description: "" }, { title: rules.min(3, "Name the task") });
  const save = useMutation("POST /api/v1/tasks");
  const submit = async () => {
    if (!f.check()) return;
    try {
      const t = await save.run({ body: { title: f.values.title, priority: f.values.priority as Task["priority"], ...(f.values.due && { due: f.values.due }), ...(f.values.description && { description: f.values.description }), ...(owner[0] && { owner_id: owner[0].employee_id }) } });
      invalidate("/api/v1/tasks", "/api/v1/workspace");
      close();
      toast(`${t.number} created${owner[0] ? ` for ${owner[0].display_name}` : ""}`);
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Field label="Task" {...f.field("title")}><TextField {...f.field("title")} placeholder="What needs doing" /></Field>
      <Field label="Due"><DateField {...f.field("due")} min={todayIso()} /></Field>
      <Field label="Priority"><SelectField options={[["urgent", "Urgent"], ["high", "High"], ["normal", "Normal"], ["low", "Low"]]} {...f.field("priority")} /></Field>
      {me.manages_people && (
        <Field label="Assign To" info="Leave empty to keep it yourself. You can set tasks for the people who report to you.">
          <PersonPicker value={owner} onChange={setOwner} placeholder="Search your team" />
        </Field>
      )}
      <Field label="Notes"><TextAreaField {...f.field("description")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Create Task</Button>
      </FormFooter>
    </>
  );
}

function CalendarTab() {
  const now = todayIso();
  const [ym, setYm] = useState<[number, number]>([Number(now.slice(0, 4)), Number(now.slice(5, 7)) - 1]);
  const month = `${ym[0]}-${String(ym[1] + 1).padStart(2, "0")}`;
  const list = usePaged("GET /api/v1/calendar", { filters: { month } });
  const modal = useModal();
  const step = (n: number) => setYm(([y, m]) => (m + n < 0 ? [y - 1, 11] : m + n > 11 ? [y + 1, 0] : [y, m + n]));
  const upcoming = list.rows.filter((e) => e.date >= now);
  return (
    <>
      <PageHeader
        title="Calendar"
        sub={`${monthName(ym[1])} ${ym[0]}`}
        actions={
          <>
            <Button onClick={() => step(-1)} aria-label="Previous month" icon="left" />
            <Button onClick={() => setYm([Number(now.slice(0, 4)), Number(now.slice(5, 7)) - 1])}>Today</Button>
            <Button onClick={() => step(1)} aria-label="Next month" icon="right" />
            <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Event", body: (close) => <EventForm close={close} /> })}>New Event</Button>
          </>
        }
      />
      <Grid cols="1.4/1">
        <MonthCalendar year={ym[0]} month={ym[1]} events={list.rows.map((e) => ({ date: e.date, label: e.title, highlight: e.highlight }))} />
        <Card>
          <CardHeader title="Coming Up" />
          {upcoming.map((e) => (
            <div key={e.event_id} className="flex items-center gap-2.5 border-b border-border py-[7px] last:border-b-0">
              <b className="w-[52px] flex-none text-[11.5px] text-subtle-foreground">{new Date(e.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })}</b>
              <span className="min-w-0 flex-1 text-[12.5px]">{e.title}</span>
              <span className="flex-none text-[11.5px] text-subtle-foreground">{e.kind}</span>
            </div>
          ))}
          {!upcoming.length && <p className="text-[11.5px] text-subtle-foreground">Nothing else this month.</p>}
          <p className="mt-[11px] text-[11.5px] text-subtle-foreground">Leave, interviews, payday and campaign dates all land here.</p>
        </Card>
      </Grid>
    </>
  );
}

function EventForm({ close }: { close: () => void }) {
  const f = useContractForm({ title: "", date: "", time: "", kind: "Meeting" }, { title: rules.required("Name the event"), date: rules.required("Pick a date") });
  const save = useMutation("POST /api/v1/calendar");
  return (
    <>
      <Field label="Event" {...f.field("title")}><TextField {...f.field("title")} /></Field>
      <Field label="Date" {...f.field("date")}><DateField {...f.field("date")} /></Field>
      <Field label="Time"><TextField {...f.field("time")} placeholder="10:00" /></Field>
      <Field label="Kind"><SelectField options={[["Meeting", "Meeting"], ["Deadline", "Deadline"], ["Campaign", "Campaign"], ["Event", "Event"]]} {...f.field("kind")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={async () => { if (!f.check()) return; await save.run({ body: f.values }); invalidate("/api/v1/calendar"); close(); toast("Added to the calendar"); }}>Add Event</Button>
      </FormFooter>
    </>
  );
}

function Analytics() {
  const { data, error, reload } = useApi("GET /api/v1/workspace/analytics");
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <LoadingRows count={8} />;
  return (
    <>
      <PageHeader title="Analytics" sub="Your team, last 30 days" />
      <KpiTiles items={data.kpis} mobileCols={2} />
      <Grid cols={2}>
        <AreaChart title="Tasks Completed per Week" values={data.completed_per_week} />
        <Card><CardHeader title="Workload by Person" /><Bars rows={data.workload} /></Card>
      </Grid>
      <Grid cols={2}>
        <Card><CardHeader title="Tasks by Priority" /><Bars rows={data.priority.map((p) => ({ ...p, color: p.emphasis === "warn" ? "var(--chart-4)" : undefined }))} /></Card>
        <Table
          title="Overdue Reasons"
          rows={data.late_reasons}
          rowKey={(r) => r.reason}
          columns={[
            { key: "r", label: "Reason", render: (r) => r.reason },
            { key: "c", label: "Count", align: "n", render: (r) => r.count },
            { key: "s", label: "Share", render: (r) => <Meter pct={r.pct} label={`${r.pct}%`} /> },
          ]}
        />
      </Grid>
    </>
  );
}
