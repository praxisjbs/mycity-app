import type { HomeActivityItem, HomeChart, HomeDayStrip, HomeDonut, HomeGoal, HomePipeline, HomeUpcomingLeave, HomeWeekDay } from "@mycity/contract/contract.gen.ts";
import { usePaged } from "@/api/hooks";
import { hours } from "@/features/attendance/labels";
import { dayCount, statusPill } from "@/features/people/Leave";
import { useScreenState } from "@/lib/plan";
import { hrefFor, useRouter } from "@/lib/router";
import { AreaChart, Bars, Button, Card, CardHeader, DataView, DonutChart, EmptyState, EmptyValue, formatCount, formatDate, formatMoneyShort, formatTime, formatWhen, monthName, Pill, StatStrip, Timeline } from "@mycity/ui";
import { activityLine, ROSTER_STATUS } from "./labels";

/**
 * The Overview's sections beside its cards (docs/guides/home.md §10.1). The server sends
 * figures and the screen words them: every title, caption and line below is written here,
 * where the screen gates read it. A section the server sends as null is never drawn
 * (§11); one it sends empty shows its empty state.
 */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The day of the week of an ISO date ("2026-10-19" is Monday). */
export const weekdayOf = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()] ?? "";

/** A working day's hours, "09:00 to 17:00", or null on a day with none. */
const hoursOf = (from: string | null, to: string | null) => (from && to ? `${from} to ${to}` : null);

/** Staff: their day, first on a phone. Worksite and Hours Today are left off a phone (§10.2). */
export function DayStrip({ day }: { day: HomeDayStrip }) {
  const status = day.status ? ROSTER_STATUS[day.status] : null;
  return (
    <StatStrip
      label="Your Day"
      className="mb-3"
      items={[
        { label: "Shift Today", value: hoursOf(day.starts_at, day.ends_at) ?? "Day Off" },
        { label: "Clock-In", value: day.clock_in_at ? formatTime(day.clock_in_at) : <EmptyValue /> },
        { label: "Worksite", value: day.worksite ?? (day.status === "remote" ? "Remote" : <EmptyValue />), desktop: true },
        { label: "Status", value: status ? status.text : <EmptyValue />, tone: status?.tone },
        { label: "Hours Today", value: day.clock_out_at ? hours(day.worked_minutes) : <EmptyValue />, desktop: true },
      ]}
    />
  );
}

/** The role's main chart: Operations' attendance, the CEO's goals or Partnerships' signed value. */
export function MainChart({ chart }: { chart: HomeChart }) {
  switch (chart.kind) {
    case "attendance_days":
      return (
        <AreaChart
          title="Attendance, 14 Working Days"
          labels={chart.days.map((d) => formatDate(d.date).slice(0, 5))}
          values={chart.days.map((d) => d.present)}
          format={(v) => `${formatCount(v)} in`}
          caption="Dips are Saturdays, a half day"
        />
      );
    case "goals":
      return <GoalBars title="Organisational Goals" goals={chart.goals} />;
    case "signed_value":
      return (
        <AreaChart
          title="Monthly Signed Value"
          labels={chart.months.map((m) => monthName(Number(m.month.slice(5, 7)) - 1).slice(0, 3))}
          // Drawn to scale only: the amounts are read out and shown as Naira, never summed here.
          values={chart.months.map((m) => Number(m.amount))}
          format={(v) => formatMoneyShort(String(v))}
        />
      );
  }
}

/** The donut beside the main chart: Operations' On Time, the CEO's Org KPI. */
export function SideDonut({ donut }: { donut: HomeDonut }) {
  if (donut.kind === "on_time") {
    const days = donut.on_time + donut.late + donut.absent;
    if (days === 0)
      return (
        <Card>
          <CardHeader title="On Time" />
          <EmptyState bare title="Nothing Yet This Month" />
        </Card>
      );
    const percent = Math.round((donut.on_time / days) * 100);
    return (
      <DonutChart
        title="On Time"
        percent={percent}
        middle={`${percent}%`}
        under="on time"
        lines={[`${formatCount(donut.on_time)} on time`, `${formatCount(donut.late)} late`, `${formatCount(donut.absent)} absent this month`]}
      />
    );
  }
  const score = (percent: number | null) => (percent === null ? <EmptyValue /> : `${percent}%`);
  if (donut.percent !== null)
    return (
      <DonutChart
        title="Org KPI"
        percent={donut.percent}
        middle={`${donut.percent}%`}
        under="overall"
        lines={donut.departments.map((d) => (
          <span key={d.department_id}>
            {d.department} {score(d.percent)}
          </span>
        ))}
      />
    );
  // No score yet (Performance measures it from M2): each department, with no figure in place of a guess.
  return (
    <Card>
      <CardHeader title="Org KPI" />
      {donut.departments.length ? (
        <Bars rows={donut.departments.map((d) => ({ label: d.department, percent: d.percent ?? 0, value: score(d.percent) }))} />
      ) : (
        <EmptyState bare title="No Departments Yet" />
      )}
    </Card>
  );
}

/** Goals and how far along each is; no figure until Performance measures it. */
export function GoalBars({ title, goals }: { title: string; goals: Array<Pick<HomeGoal, "title" | "progress">> }) {
  return (
    <Card>
      <CardHeader title={title} />
      {goals.length ? (
        <Bars rows={goals.map((g) => ({ label: g.title, percent: g.progress ?? 0, value: g.progress === null ? <EmptyValue /> : `${g.progress}%` }))} />
      ) : (
        <EmptyState bare title="No Goals This Quarter" />
      )}
    </Card>
  );
}

/** Open opportunities by stage; the partners gone quiet, on desktop. */
export function Pipeline({ pipeline }: { pipeline: HomePipeline }) {
  const most = Math.max(1, ...pipeline.stages.map((s) => s.open));
  return (
    <Card>
      <CardHeader title="Partnership Pipeline" />
      {pipeline.stages.length ? (
        <Bars
          rows={pipeline.stages.map((s) => ({ label: s.label, percent: Math.round((s.open / most) * 100), value: formatCount(s.open) }))}
          note={pipeline.quiet_30d > 0 ? `${formatCount(pipeline.quiet_30d)} with no contact in 30 days` : undefined}
        />
      ) : (
        <EmptyState bare title="No Open Opportunities" />
      )}
    </Card>
  );
}

/**
 * Need You, on every Overview: the requests waiting on the reader (GET /workflow/mine, its
 * own paged list) and, for someone who clears alerts, how many are open for them.
 */
export function NeedYou({ alertsToClear }: { alertsToClear: number | null }) {
  const { navigate } = useRouter();
  const list = usePaged("GET /api/v1/workflow/mine");
  const alertsOpen = useScreenState("home", "alerts").open;
  const alerts = alertsOpen ? (alertsToClear ?? 0) : 0;
  return (
    <DataView
      title="Need You"
      list={list}
      rowKey={(r) => r.workflow_instance_id}
      noun="request"
      onRowClick={(r) => {
        if (r.link) navigate(r.link);
      }}
      actions={
        alerts > 0 ? (
          <Button size="sm" onClick={() => navigate(hrefFor("home", "alerts"))}>
            {`Clear ${formatCount(alerts)} ${alerts === 1 ? "Alert" : "Alerts"}`}
          </Button>
        ) : undefined
      }
      empty={{ title: alerts > 0 ? "No Requests Waiting" : "Nothing Needs You" }}
      columns={[
        { key: "from", label: "From", render: (r) => r.subject_name ?? r.opened_by_name ?? <EmptyValue /> },
        { key: "request", label: "Request", render: (r) => r.definition_name },
        { key: "stage", label: "Stage", render: (r) => <Pill tone={r.overdue ? "err" : "info"}>{r.overdue ? `${r.stage_name}, Overdue` : r.stage_name}</Pill> },
        { key: "since", label: "Waiting Since", render: (r) => formatWhen(r.stage_entered_at) },
      ]}
    />
  );
}

/** What happened across the organisation today, as the reader may see it, newest first. */
export function ActivityToday({ items }: { items: HomeActivityItem[] }) {
  const lines = items.flatMap((e) => {
    const title = activityLine(e);
    return title ? [{ title, when: formatTime(e.occurred_at) }] : [];
  });
  return (
    <Card>
      <CardHeader title="Activity Today" />
      {lines.length ? <Timeline label="Activity Today" items={lines} /> : <EmptyState bare title="Nothing Yet Today" />}
    </Card>
  );
}

/** This week's working days: hours, a public holiday, the reader's leave and what is due. */
export function YourWeek({ week }: { week: HomeWeekDay[] }) {
  return (
    <Card>
      <CardHeader title="Your Week" />
      {week.length ? (
        <ul data-copy="content" className="m-0 list-none p-0">
          {week.map((d) => (
            <li key={d.date} className="flex items-start gap-2.5 border-b border-border py-2 last:border-b-0">
              <b className="w-20 flex-none text-xs text-subtle-foreground">
                {weekdayOf(d.date).slice(0, 3)} {formatDate(d.date).slice(0, 5)}
              </b>
              <span className="min-w-0 flex-1 text-xs">
                <span className="block">{d.holiday ?? hoursOf(d.starts_at, d.ends_at)}</span>
                {d.items.map((item, i) => (
                  <span key={`${item.kind}:${i}`} className="block text-muted-foreground">
                    {item.at ? `${formatTime(item.at)} ` : ""}
                    {item.title}
                  </span>
                ))}
              </span>
              {d.holiday ? <Pill tone="info">Holiday</Pill> : d.on_leave ? <Pill tone="info">On Leave</Pill> : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState bare title="No Working Days" />
      )}
    </Card>
  );
}

/**
 * Staff: their leave still ahead, soonest first, and what is left of their year (the figure My
 * Leave shows). The list is the first 25; View All opens My Leave, its paged home, once that
 * screen is open in this build.
 */
export function UpcomingLeave({ leave }: { leave: HomeUpcomingLeave }) {
  const { navigate } = useRouter();
  const myLeave = useScreenState("ess", "my-leave").open;
  return (
    <Card>
      <CardHeader
        title="Upcoming Leave"
        actions={
          myLeave ? (
            <Button size="sm" variant="ghost" iconRight="right" onClick={() => navigate(hrefFor("ess", "my-leave"))}>
              View All
            </Button>
          ) : undefined
        }
      />
      {leave.balance && (
        <p data-copy="content" className="mb-2 flex items-center gap-2 text-sm">
          <span className="flex-1">{dayCount(leave.balance.remaining)} left this year</span>
          <Pill>{leave.balance.name}</Pill>
        </p>
      )}
      {leave.requests.length > 0 ? (
        <ul data-copy="content" className="m-0 list-none p-0">
          {leave.requests.map((r) => (
            <li key={r.leave_request_id} className="flex items-center gap-2.5 border-t border-border py-2 text-xs">
              <b className="flex-none">
                {formatDate(r.starts_on)} to {formatDate(r.ends_on)}
              </b>
              <span className="min-w-0 flex-1">
                {r.leave_type_name}, {dayCount(r.days)}
              </span>
              {statusPill(r)}
            </li>
          ))}
        </ul>
      ) : (
        !leave.balance && <EmptyState bare title="No Leave Ahead" />
      )}
    </Card>
  );
}
