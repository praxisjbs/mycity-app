/**
 * Performance · Analytics (docs/guides/performance.md §2, §6.21, §10): a quarter's figures, the
 * company's and each function's or one function's. The company score, commitments, check-ins and
 * reviews on time; scores by month; key results by status; the rating spread at the latest closed
 * round; commitments on time by function; self against final; and the people, sorted by score, with
 * Export. Every figure is the server's (GET /performance/analytics); the screen only words it.
 */
import { useState } from "react";
import type { AnalyticsPerson, Endpoints, PerformanceAnalytics } from "@mycity/contract/contract.gen.ts";
import { api } from "@/api/client";
import { saveExport } from "@/api/exports";
import { useApi, usePaged } from "@/api/hooks";
import { useMe } from "@/auth/AuthProvider";
import { hasCapability } from "@/shell/access";
import { KpiTiles } from "@/features/shared/KpiTiles";
import {
  BarChart,
  Bars,
  Button,
  Card,
  CardHeader,
  DataView,
  DesktopOnly,
  EmptyState,
  EmptyValue,
  FilterSelect,
  formatDate,
  formatMonth,
  Grid,
  LoadingRows,
  PageHeader,
  StatusPill,
  Toolbar,
  useIsPhone,
  useModal,
} from "@mycity/ui";
import { monthShort, person, rating, score, useDepartmentFilter, useQuarter } from "./shared";

type Filters = { period_id?: string; department_id?: string };
type ExportBody = Endpoints["POST /api/v1/performance/analytics/people/export"]["body"];
type OnTime = { due: number; on_time: number };

/** How many people a phone lists before View All. */
const PHONE_PEOPLE = 5;
const selfHelp = "The employee's score minus the final score, on average. Above zero means people rate themselves higher.";

/** A share on time as a tile shows it: the percentage, and what it is out of beneath. */
const share = ({ due, on_time }: OnTime) => ({ value: due > 0 ? `${Math.round((on_time / due) * 100)}%` : <EmptyValue />, sub: due > 0 ? `${on_time} of ${due}` : undefined });

/** A month's on time in a cell: "7 of 9", or nothing when none was due. */
const ofDue = (m: OnTime) => (m.due > 0 ? `${m.on_time} of ${m.due}` : <EmptyValue />);

/** A score in a cell, two places; the marker when nothing is scored. */
const scoreCell = (s: string | null) => (s === null ? <EmptyValue /> : score(s));

/** A difference of scores with its sign: +0.08, −0.10. */
const gap = (g: string | null) => (g === null ? <EmptyValue /> : `${Number(g) > 0 ? "+" : Number(g) < 0 ? "−" : ""}${Math.abs(Number(g)).toFixed(2)}`);

const STATUS_ROWS: Array<[keyof PerformanceAnalytics["key_results"], string]> = [
  ["on_track", "On Track"],
  ["done", "Done"],
  ["at_risk", "At Risk"],
  ["off_track", "Off Track"],
  ["missed", "Missed"],
  ["not_started", "Not Started"],
  ["awaiting_report", "Awaiting Report"],
  ["recovery", "In Recovery"],
];

const RATING_LABELS: Record<string, string> = { exceeds: "Exceeds", meets: "Meets", partly_meets: "Partly Meets", below: "Below" };

export function Analytics() {
  const me = useMe();
  const modal = useModal();
  const phone = useIsPhone();
  const quarter = useQuarter();
  const period = quarter.period;
  const [pickedDept, setDept] = useState("");
  const departments = useDepartmentFilter("All Functions", pickedDept);
  const dept = departments.value;
  const filters: Filters = { ...(quarter.periodId ? { period_id: quarter.periodId } : {}), ...(dept ? { department_id: dept } : {}) };
  // Wait for the quarter, so the current one is read once by its id rather than twice.
  const read = useApi("GET /api/v1/performance/analytics", { query: filters, enabled: !quarter.loading });
  const people = usePaged("GET /api/v1/performance/analytics/people", { filters, sort: "-score_to_date", enabled: !quarter.loading });
  const mayExport = me.grants.performance?.includes("export") ?? false;
  const exportPeople = () => saveExport(api.call("POST /api/v1/performance/analytics/people/export", { body: { ...filters, ...(people.q ? { q: people.q } : {}) } as ExportBody }));

  const header = (
    <>
      <PageHeader title="Analytics" sub={period ? `${period.name} · ${formatDate(period.starts_on)} to ${formatDate(period.ends_on)}` : undefined} />
      <Toolbar>
        <FilterSelect label="Quarter" value={quarter.periodId} onChange={quarter.setPeriodId} options={quarter.options} {...quarter.paging} />
        {departments.pick && <FilterSelect label="Function" value={dept} onChange={setDept} options={departments.options} {...departments.paging} />}
      </Toolbar>
    </>
  );
  if (!read.data)
    return (
      <>
        {header}
        <Card>
          <LoadingRows count={6} />
        </Card>
      </>
    );
  const a = read.data;
  if (!a.period)
    return (
      <>
        {header}
        <EmptyState className="mt-3" title="No Quarter Yet" />
      </>
    );

  const commitments = share(a.commitments);
  const checkIns = share(a.check_ins);
  const reviews = share(a.reviews_closed);
  // The company's score is the whole plan's alone (§6.23): everyone else is shown the three measures of their people.
  const readsCompany = hasCapability(me, "goals.view_all") || hasCapability(me, "goals.company") || hasCapability(me, "goals.organisation");
  const tiles = [
    ...(readsCompany ? [{ label: "Company Score", value: a.company_score === null ? <EmptyValue /> : score(a.company_score) }] : []),
    { label: "Commitments On Time", ...commitments },
    { label: "Check-Ins On Time", ...checkIns },
    { label: "Reviews Closed On Time", ...reviews },
  ];
  const months = a.months;
  const krTotal = a.key_results.key_results;

  const peopleColumns = [
    { key: "employee", label: "Employee", sortable: true, render: (p: AnalyticsPerson) => person(p.employee) },
    { key: "department", label: "Department", desktop: true, render: (p: AnalyticsPerson) => p.department ?? <EmptyValue /> },
    { key: "reviewer", label: "Reviewer", desktop: true, render: (p: AnalyticsPerson) => (p.reviewer ? p.reviewer.display_name : <EmptyValue />) },
    { key: "score_to_date", label: "Score to Date", align: "n" as const, sortable: true, render: (p: AnalyticsPerson) => scoreCell(p.score_to_date) },
    { key: "rating", label: "Rating", render: (p: AnalyticsPerson) => <StatusPill s={rating(p.rating)} /> },
  ];
  const allPeople = () =>
    modal.open({
      title: "People",
      wide: true,
      body: () => (
        <DataView
          bare
          list={people}
          columns={peopleColumns}
          rowKey={(p) => p.scorecard_id}
          caption="People"
          search="Search People"
          noun="person"
          nounPlural="people"
          onExport={mayExport ? exportPeople : undefined}
          empty={{ title: "No Scorecards Yet" }}
        />
      ),
    });

  return (
    <>
      {header}
      <KpiTiles items={tiles} mobileCols={2} />
      <Grid cols={2}>
        <DataView
          title="Scores by Month"
          rows={a.scores}
          rowKey={(s) => s.department_id ?? "company"}
          empty={{ title: "Nothing Scored Yet" }}
          columns={[
            { key: "function", label: "Function", render: (s) => s.department ?? "Company" },
            ...months.map((m, i) => ({ key: m, label: monthShort(m), align: "n" as const, render: (s: PerformanceAnalytics["scores"][number]) => scoreCell(s.months[i]?.score ?? null) })),
          ]}
        />
        <Card>
          <CardHeader title="Key Results by Status" />
          {krTotal === 0 ? (
            <EmptyState title="No Key Results Yet" />
          ) : (
            <Bars rows={STATUS_ROWS.map(([key, label]) => ({ label, percent: Math.round((a.key_results[key] / krTotal) * 100), value: String(a.key_results[key]) }))} />
          )}
        </Card>
      </Grid>
      <Grid cols={2}>
        {a.ratings.month ? (
          <BarChart
            title="Rating Spread"
            caption={formatMonth(a.ratings.month)}
            colourPerBar
            bars={a.ratings.counts.map((r) => ({ label: RATING_LABELS[r.rating], value: r.count }))}
          />
        ) : (
          <Card>
            <CardHeader title="Rating Spread" />
            <EmptyState title="No Closed Round" />
          </Card>
        )}
        <DataView
          title="Commitments On Time"
          rows={a.commitments_by_function}
          rowKey={(f) => f.department_id ?? "none"}
          empty={{ title: "No Commitments Yet" }}
          columns={[
            { key: "function", label: "Function", render: (f) => f.department ?? <EmptyValue /> },
            ...months.map((m, i) => ({ key: m, label: monthShort(m), align: "n" as const, render: (f: PerformanceAnalytics["commitments_by_function"][number]) => (f.months[i] ? ofDue(f.months[i]) : <EmptyValue />) })),
          ]}
        />
      </Grid>
      <DesktopOnly unmount>
        <DataView
          title="Self Against Final"
          help={selfHelp}
          rows={a.self_against_final}
          rowKey={(g) => g.department_id ?? "none"}
          empty={{ title: "No Closed Reviews" }}
          columns={[
            { key: "function", label: "Function", render: (g) => g.department ?? <EmptyValue /> },
            { key: "gap", label: "Self Against Final", align: "n", render: (g) => gap(g.gap) },
            { key: "lines", label: "Lines Scored", align: "n", render: (g) => String(g.lines) },
          ]}
        />
      </DesktopOnly>
      {phone ? (
        <DataView
          title="People"
          rows={people.rows.slice(0, PHONE_PEOPLE)}
          loading={people.loading}
          error={people.error}
          columns={peopleColumns}
          rowKey={(p) => p.scorecard_id}
          empty={{ title: "No Scorecards Yet" }}
          footer={(people.page?.total ?? 0) > PHONE_PEOPLE ? <Button onClick={allPeople}>View All</Button> : undefined}
        />
      ) : (
        <DataView
          title="People"
          list={people}
          columns={peopleColumns}
          rowKey={(p) => p.scorecard_id}
          search="Search People"
          noun="person"
          nounPlural="people"
          onExport={mayExport ? exportPeople : undefined}
          empty={{ title: "No Scorecards Yet" }}
        />
      )}
    </>
  );
}
