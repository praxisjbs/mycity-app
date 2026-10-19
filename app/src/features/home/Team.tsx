import { useState } from "react";
import type { HomeRosterStatus, HomeTeamAttendanceRow, HomeTeamQuery, HomeTeamRow, HomeTeamSummary } from "@mycity/contract/contract.gen.ts";
import { usePhotos } from "@/api/download";
import { useApi, usePaged } from "@/api/hooks";
import type { Me } from "@/api/types/identity";
import { useAuth, useMe } from "@/auth/AuthProvider";
import { useScreenState } from "@/lib/plan";
import { hrefFor, useRouter } from "@/lib/router";
import { Button, Chips, DataView, ErrorState, FilterSelect, formatCount, formatTime, KeyValue, LoadingRows, ModalFooter, PageHeader, Pill, Toolbar, useIsPhone, useModal, Who, type DataViewColumn } from "@mycity/ui";
import { reachable } from "./access";
import { CardRow } from "./cards";
import { useKpiDetail } from "./KpiDetail";
import { ROSTER_STATUS } from "./labels";

/**
 * Home · Team (#86, docs/guides/home.md §10): today's roster for the people in the reader's
 * `home` scope (everyone; the reader and everyone below them on the reporting line; or the
 * reader alone), its four cards, and each person's month so far. Every figure is the shared attendance roster's,
 * read by the server (GET /home/team/summary, /home/team, /home/team/attendance); the screen
 * words it and recomputes nothing. The Team tab needs `home.team`; ./index.tsx shows the lock
 * to anyone without it.
 *
 * The two shells (§10.2): on desktop the scope line, a Department filter (for a reader who may
 * read the departments, through People's grant) and the roster as a table; on a phone the cards two to a row, then the roster as person cards (name and
 * department, the status pill, Clock-In and KPI), with Department and Open Tasks left off.
 * A card opens its records (./KpiDetail) and a person opens as a sheet, a bottom sheet on a
 * phone.
 */

/** Whose roster this is, for the line under the title (desktop only). */
const SCOPE: Record<HomeTeamSummary["scope"], string> = {
  all: "The Whole Organisation",
  team: "Your Team",
  own: "Just You",
};

/** The chip for the flag beside a status: a clock-in and no clock-out on the person's last working day. */
const NO_CLOCK_OUT = "no_clock_out_yesterday";

/**
 * The roster's chips: everyone, one status, or the flag. Absent has none: the day-close
 * closes only days before today, so nobody is absent on today's roster (§6 Team).
 */
export type RosterChip = "everyone" | Exclude<HomeRosterStatus, "absent"> | typeof NO_CLOCK_OUT;

const CHIP_STATUSES = ["on_site", "remote", "late", "not_in", "on_leave"] as const;
const CHIPS: Array<[RosterChip, string]> = [
  ["everyone", "Everyone"],
  ...CHIP_STATUSES.map((s): [RosterChip, string] => [s, ROSTER_STATUS[s].text]),
  [NO_CLOCK_OUT, "No Clock-Out Yesterday"],
];

type RosterFilters = Pick<HomeTeamQuery, "department_id" | "status" | "no_clock_out_yesterday">;

/** The roster's filters as the API takes them (HomeTeamQuery): a chip, and a department or none. */
export function rosterFilters(chip: RosterChip, departmentId: string): RosterFilters {
  const department = departmentId ? { department_id: departmentId } : {};
  if (chip === NO_CLOCK_OUT) return { ...department, no_clock_out_yesterday: "true" };
  if (chip === "everyone") return department;
  return { ...department, status: chip };
}

/** A way out of a person's sheet to People's own screens. */
export interface PersonLink {
  key: "profile" | "attendance";
  label: string;
  href: string;
}

/**
 * Where a person on the roster opens: their profile and People · Attendance, each offered
 * only when the reader may open that screen (their `people` grant, as the navigation decides
 * it) and it is open in this build (F14). A line manager without People's Employees tab gets
 * View Attendance alone; someone without the `people` grant gets the sheet and no way out.
 *
 * @param opens  whether a People tab opens in this build (lib/plan.ts)
 */
export function personLinks(me: Me, employeeId: string, opens: (tab: string) => boolean): PersonLink[] {
  const links: Array<PersonLink & { tab: string }> = [
    { key: "attendance", label: "View Attendance", tab: "attendance", href: hrefFor("people", "attendance") },
    { key: "profile", label: "Open Profile", tab: "employees", href: hrefFor("people", "employees", { id: employeeId }) },
  ];
  return links.filter((l) => reachable(me, "people", l.tab) && opens(l.tab)).map(({ key, label, href }) => ({ key, label, href }));
}

/** A status pill for today, and the flag beside it. A day that is not worked, with nothing recorded, has no status. */
function Today({ row }: { row: HomeTeamRow }) {
  const status = row.status ? ROSTER_STATUS[row.status] : { tone: "neutral" as const, text: "Day Off" };
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Pill tone={status.tone}>{status.text}</Pill>
      {row.no_clock_out_yesterday && <Pill tone="warn">No Clock-Out Yesterday</Pill>}
    </span>
  );
}

/** A KPI score, null until Performance measures it (M2). */
const kpiOf = (percent: number | null) => (percent === null ? null : `${formatCount(percent)}%`);
const timeOf = (at: string | null) => (at ? formatTime(at) : null);
const countOf = (n: number | null) => (n === null ? null : formatCount(n));

/** Department options from the organisation's own list, for a reader who may read it (People's grant). */
function useDepartments(enabled: boolean): Array<[string, string]> {
  const read = useApi("GET /api/v1/departments", { query: { active: "true" }, enabled });
  return [["", "All Departments"], ...(read.data?.data ?? []).map((d): [string, string] => [d.department_id, d.name])];
}

export function Team() {
  const me = useMe();
  const { can } = useAuth();
  const phone = useIsPhone();
  const modal = useModal();
  const openRecords = useKpiDetail();
  const summary = useApi("GET /api/v1/home/team/summary");

  const [chip, setChip] = useState<RosterChip>("everyone");
  /* The Department filter is desktop's (§10.2): on a phone it is not drawn, so it does not apply. */
  const departmentFilter = can("people") && !phone;
  const departments = useDepartments(departmentFilter);
  const [picked, setPicked] = useState("");
  const department = departmentFilter ? picked : "";

  const roster = usePaged("GET /api/v1/home/team", { filters: rosterFilters(chip, department) });
  const month = usePaged("GET /api/v1/home/team/attendance", { filters: department ? { department_id: department } : {} });
  const photo = usePhotos([...roster.rows, ...month.rows].map((r) => r.employee.photo_url));

  const opens: Record<string, boolean> = { attendance: useScreenState("people", "attendance").open, employees: useScreenState("people", "employees").open };
  const openPerson = (row: HomeTeamRow) => {
    const links = personLinks(me, row.employee.employee_id, (tab) => opens[tab] === true);
    modal.open({ title: row.employee.display_name, body: (close) => <PersonSheet row={row} links={links} close={close} /> });
  };

  const filtered = chip !== "everyone" || department !== "" || roster.q !== "";
  const rosterColumns: DataViewColumn<HomeTeamRow>[] = [
    // A phone card has no Department column, so the department goes under the name there.
    { key: "display_name", label: "Employee", sortable: true, render: (r) => <Who name={r.employee.display_name} sub={(phone ? r.employee.department : r.employee.job_title) ?? undefined} src={photo(r.employee.photo_url)} /> },
    { key: "department", label: "Department", sortable: true, desktop: true, render: (r) => r.employee.department },
    { key: "status", label: "Status", render: (r) => <Today row={r} /> },
    { key: "clock_in_at", label: "Clock-In", sortable: true, render: (r) => timeOf(r.clock_in_at) },
    { key: "kpi", label: "KPI", align: "n", render: (r) => kpiOf(r.kpi_percent) },
    { key: "open_tasks", label: "Open Tasks", align: "n", desktop: true, render: (r) => countOf(r.open_tasks) },
  ];

  return (
    <>
      <PageHeader title="Team" subtitle={summary.data ? SCOPE[summary.data.scope] : undefined} />
      {summary.error ? (
        <ErrorState error={summary.error} onRetry={summary.reload} />
      ) : summary.data ? (
        summary.data.cards.length > 0 && <CardRow cards={summary.data.cards} onOpen={(card) => openRecords(card.key, card.title)} />
      ) : (
        <LoadingRows count={2} />
      )}
      {departmentFilter && (
        <Toolbar label="Team Filters">
          <FilterSelect label="Department" value={picked} onChange={setPicked} options={departments} />
        </Toolbar>
      )}
      <Chips label="Status" value={chip} onChange={setChip} options={CHIPS} />
      <DataView
        title="Team Roster"
        list={roster}
        search="Search People"
        rowKey={(r) => r.employee.employee_id}
        onRowClick={openPerson}
        noun="person"
        nounPlural="people"
        empty={filtered ? { icon: "srch", title: "Nobody Matches", text: "Try another status, department or search." } : { title: "Nobody on the Roster" }}
        columns={rosterColumns}
      />
      <DataView
        className="mt-3"
        title="Attendance This Month"
        list={month}
        rowKey={(r) => r.employee.employee_id}
        noun="person"
        nounPlural="people"
        empty={department ? { icon: "srch", title: "Nobody Matches", text: "Try another department." } : { title: "Nobody This Month" }}
        columns={monthColumns(photo)}
      />
    </>
  );
}

/** Each person's working days this month so far, by how each went; on a phone, On Leave is left off. */
const monthColumns = (photo: (url: string | null) => string | null): DataViewColumn<HomeTeamAttendanceRow>[] => [
  { key: "display_name", label: "Employee", sortable: true, render: (r) => <Who name={r.employee.display_name} sub={r.employee.department ?? undefined} src={photo(r.employee.photo_url)} /> },
  // Out of the days they were expected in; someone on leave all month has none to count.
  { key: "on_time", label: "On Time", align: "n", sortable: true, render: (r) => (r.expected > 0 ? `${formatCount(r.on_time)} of ${formatCount(r.expected)}` : null) },
  { key: "late", label: "Late", align: "n", render: (r) => formatCount(r.late) },
  { key: "absent", label: "Absent", align: "n", render: (r) => formatCount(r.absent) },
  { key: "on_leave", label: "On Leave", align: "n", desktop: true, render: (r) => formatCount(r.on_leave) },
];

/** A person on the roster, opened: their day, with the way to People's screens the reader may open. */
function PersonSheet({ row, links, close }: { row: HomeTeamRow; links: PersonLink[]; close: () => void }) {
  const { navigate } = useRouter();
  return (
    <>
      <KeyValue
        items={[
          ["Job Title", row.employee.job_title],
          ["Department", row.employee.department],
          ["Today", <Today row={row} />],
          ["Clock-In", timeOf(row.clock_in_at)],
          ["Clock-Out", timeOf(row.clock_out_at)],
          ["Worksite", row.worksite],
          ["KPI", kpiOf(row.kpi_percent)],
          ["Open Tasks", countOf(row.open_tasks)],
        ]}
      />
      {links.length > 0 && (
        <ModalFooter>
          {links.map((l) => (
            <Button
              key={l.key}
              onClick={() => {
                close();
                navigate(l.href);
              }}
            >
              {l.label}
            </Button>
          ))}
        </ModalFooter>
      )}
    </>
  );
}
