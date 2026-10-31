/** My Workspace · Today (docs/guides/workspace.md §10.1): the reader's day on one screen. */
import type { Task } from "@mycity/contract/contract.gen.ts";
import { useApi } from "@/api/hooks";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { useScreenAction } from "@/shell/screen-action";
import { Avatar, Button, Card, CardHeader, EmptyValue, ErrorState, formatDate, formatDateTime, formatTime, Grid, LoadingRows, PageHeader, Pill, Timeline, useIsPhone, useModal } from "@mycity/ui";
import { CardPills, useLiveTasks, useSetsForOthers } from "./shared";
import { happened, useTaskPanel } from "./TaskPanel";
import { TaskForm } from "./TaskForms";
import { MyWeekCard, TeamWeekCard } from "./Week";

/** A task on Today: its title, its pills and who set it. */
function TaskCard({ t, onClick }: { t: Task; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mb-2 block w-full rounded-box border border-border bg-card p-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-2">
      <b className="mb-1.5 block text-xs leading-snug font-semibold" data-copy="content">{t.title}</b>
      <span className="flex flex-wrap items-center gap-1.5">
        <CardPills t={t} />
        {t.set_by && <Avatar name={t.set_by.display_name} size={21} />}
      </span>
    </button>
  );
}

/** A diary line's answer, as the reader's own: their events are confirmed. */
const answer = (r: string | null) => (r === "declined" ? { tone: "neutral" as const, text: "Declined" } : r === "pending" ? { tone: "neutral" as const, text: "Tentative" } : { tone: "info" as const, text: "Confirmed" });

export function Today() {
  const { data, error, reload } = useApi("GET /api/v1/workspace/today");
  const clock = useApi("GET /api/v1/attendance/me/today");
  const others = useSetsForOthers();
  const phone = useIsPhone();
  const panel = useTaskPanel();
  const modal = useModal();
  const add = () => modal.open({ title: "New Task", body: (close) => <TaskForm close={close} /> });
  useScreenAction({ label: "New Task", onSelect: add });
  useLiveTasks();
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <LoadingRows count={8} />;
  const meetings = data.diary.data.filter((d) => d.item_kind === "event").length;
  // The clock-in time once its read answers; nothing while it loads or when it cannot be read.
  const clockedIn = clock.data ? (clock.data.clock_in_at ? formatTime(clock.data.clock_in_at) : "Not Yet") : <EmptyValue />;
  const yourDay = (
    <Card>
      <CardHeader title="Your Day" right={data.overdue ? <Pill tone="err">{`${data.overdue} overdue`}</Pill> : undefined} />
      {data.my_day.data.map((t) => <TaskCard key={t.task_id} t={t} onClick={() => panel.open(t.task_id, t.title)} />)}
      {!data.my_day.data.length && <p className="text-2xs text-subtle-foreground">Nothing due today.</p>}
    </Card>
  );
  const fromManager = (
    <Card>
      <CardHeader title="From Your Manager" />
      {data.set_by_manager.data.map((t) => <TaskCard key={t.task_id} t={t} onClick={() => panel.open(t.task_id, t.title)} />)}
      {!data.set_by_manager.data.length && <p className="text-2xs text-subtle-foreground">Nothing set for you.</p>}
      <Button className="mt-1 w-full" icon="plus" onClick={add}>Add Task</Button>
    </Card>
  );
  const diary = (
    <Card>
      <CardHeader title="Diary" />
      {data.diary.data.map((d) => {
        const a = answer(d.my_response);
        return (
          <div key={d.item_kind + d.item_id} className="flex items-start gap-2.5 border-b border-border py-2 last:border-b-0">
            <b className="w-11.5 flex-none text-xs font-bold">{d.all_day ? "All Day" : formatTime(d.starts_at)}</b>
            <span className="min-w-0 flex-1"><div className="text-xs font-semibold" data-copy="content">{d.title}</div>{d.location && <div className="text-2xs text-subtle-foreground">{d.location}</div>}</span>
            {d.item_kind === "event" && <Pill tone={a.tone}>{a.text}</Pill>}
            {d.item_kind === "task" && <Pill tone="warn">Deadline</Pill>}
          </div>
        );
      })}
      {!data.diary.data.length && <p className="text-2xs text-subtle-foreground">Nothing in the diary.</p>}
    </Card>
  );
  const recent = (
    <Card>
      <CardHeader title="Recent Activity" />
      <Timeline
        items={data.since.data.map((a) => ({
          title: `${a.actor?.display_name ?? "MyCity"} ${happened(a)}`,
          when: formatDateTime(a.created_at),
          text: a.task_title,
        }))}
      />
      {!data.since.data.length && <p className="text-2xs text-subtle-foreground">Nothing new.</p>}
    </Card>
  );
  return (
    <>
      <PageHeader title="Today" sub={formatDate(data.date)} />
      <KpiTiles
        mobileCols={2}
        items={[
          { key: "due", label: "Due Today", value: String(data.due_today), tone: data.due_today ? "warn" : undefined },
          { key: "over", label: "Overdue", value: String(data.overdue), tone: data.overdue ? "err" : undefined },
          { key: "meet", label: "Meetings", value: String(meetings) },
          { key: "clock", label: "Clocked In", value: clockedIn, tone: clock.data?.clock_in_at ? "ok" : undefined },
        ]}
      />
      {phone ? (
        /* A phone (§10.2): Your Day, then My Week as one card, then the rest below. */
        <Grid cols={1}>
          {yourDay}
          <MyWeekCard />
          {fromManager}
          {diary}
          {recent}
          {others && <TeamWeekCard />}
        </Grid>
      ) : (
        <>
          <Grid cols={2}>
            {yourDay}
            {fromManager}
          </Grid>
          <Grid cols={2}>
            {diary}
            {recent}
          </Grid>
          {others ? (
            <Grid cols={2}>
              <MyWeekCard />
              <TeamWeekCard />
            </Grid>
          ) : (
            <MyWeekCard />
          )}
        </>
      )}
      {panel.panel}
    </>
  );
}
