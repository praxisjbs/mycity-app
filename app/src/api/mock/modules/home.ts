import alertsContract from "@mycity/contract/schemas/alerts.js";
import reportsContract from "@mycity/contract/schemas/reports.js";
import type {
  HomeActivityItem,
  HomeAlert,
  HomeAlertRule,
  HomeAlertSummary,
  HomeChart,
  HomeDayStrip,
  HomeDonut,
  HomeGoal,
  HomeKpiCard,
  HomeKpiCell,
  HomeKpiDetailMeta,
  HomeKpiDetailRow,
  HomeKpiDomain,
  HomeKpiPicker,
  HomeKpiSource,
  HomeKpiUnit,
  HomeOverview,
  HomePipeline,
  HomeReport,
  HomeReportFilters,
  HomeReportRecipient,
  HomeReportRecurrence,
  HomeReportRun,
  HomeReportScheduleSave,
  HomeReportSummary,
  HomeRoleKpis,
  HomeRosterStatus,
  HomeTeamAttendanceRow,
  HomeTeamRow,
  HomeTeamSummary,
  HomeUpcomingLeave,
  HomeWeekDay,
  Me,
} from "@mycity/contract/contract.gen.ts";
import { MODULES } from "@/shell/catalogue";
import { formatDate, formatTime, todayIso } from "@mycity/ui";
import { at, created, fail, invalid, isoDaysAgo, isoDaysAhead, noContent, notFound, ok, paged, route, sid, type Req } from "../core";
import { byId, byKey, DEPARTMENTS, PEOPLE, SIGN_INS, teamOf, type MockPerson } from "../data/people";
import { HISTORY, TODAY, type TodayStatus } from "../data/attendance";
import { PARTNERS, STAGES } from "../data/partners";
import { REQUESTS } from "../data/expenses";
import { shiftOf, todayOf } from "./attendance";
import { me } from "./identity";
import { leaveRequests, leaveYear, waitingOn } from "./organisation";

/**
 * Home on the in-browser mock (laptops and CI only, F12 to F14). The real API is built for the
 * Overview, the records behind a card and the card picker (src/modules/dashboard): this mock
 * answers those in the contract's shapes (packages/contract/schemas/dashboard.js), so the screen
 * gates and a laptop without a server see a full Overview for each Home view. It follows the
 * server's rules where they decide what is shown: which cards a person may see (their /me
 * grants and capabilities), which cards show (their pick, else their roles', else their Home
 * view's), which sections each view draws, and that the server sends figures and the screen the
 * words. Team is on the contract too, over the same roster as the Clocked In Today card, in the
 * reader's `home` scope (everyone for Operations and the CEO, else the reader and everyone below
 * them). Alerts and their rules are on the contract (packages/contract/schemas/alerts.js): who
 * sees an alert, who may clear it, the counts, and a rule switched off dismissing its open
 * alerts follow home.md §6 Alerts, and a body the contract refuses is answered 422 as the API
 * answers it. Reports are on the contract too (packages/contract/schemas/reports.js): who sees
 * a report and who may change it, who may receive one, schedules kept running or paused, files
 * that are Pending for a few seconds before they are there, and Run Now and the Overview Export
 * answered 202 with their numbered run, the same run again while its file waits.
 *
 * Demonstration data only (A5): production starts empty.
 */

type Tone = "ok" | "warn" | "err" | "info" | "neutral";

/** Everyone for Operations and the CEO; else the reader and everyone below them. */
const full = (user: string) => ["operations", "ceo"].includes(SIGN_INS[user]?.view ?? "");
const peopleOf = (user: string): MockPerson[] => (full(user) ? PEOPLE : [byKey(user)!, ...teamOf(user)]);
const keysOf = (user: string) => new Set(peopleOf(user).map((p) => p.user_key));
/** A department's id, as the organisation mock gives it (GET /departments). */
const departmentId = (name: string) => sid(`dept:${name}`);
/** A person as lists carry them (the contract's PersonRef). */
const refOf = (p: MockPerson): HomeTeamRow["employee"] => ({ employee_id: p.employee_id, display_name: p.display_name, job_title: p.job_title, department: p.department });
const grants = (m: Me, module: string) => (m.grants as Record<string, string[] | undefined>)[module] ?? [];
const mayView = (m: Me, module: string) => m.is_ceo || grants(m, module).includes("view");
const holds = (m: Me, code: string) => m.is_ceo || m.capabilities.includes(code);

/** Sums wire amounts as whole kobo, never through a float. */
function sumMoney(amounts: string[]): string {
  const kobo = amounts.reduce((sum, a) => sum + BigInt(a.replace(".", "")), 0n);
  const digits = kobo.toString().padStart(3, "0");
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

const thisYear = () => todayIso().slice(0, 4);

/* ------------------------------------------------------------------ *
 * The shared attendance roster, as Home reads it today
 * ------------------------------------------------------------------ */
interface RosterRow {
  person: MockPerson;
  status: HomeRosterStatus;
  clock_in_at: string | null;
  clock_out_at: string | null;
  worksite: string | null;
  no_clock_out_yesterday: boolean;
}

/** The register's status for each of the demonstration day's states; a suspended person is not on the roster. */
const ROSTER: Record<TodayStatus, HomeRosterStatus | null> = {
  on_time: "on_site",
  remote: "on_site",
  late: "late",
  leave: "on_leave",
  no_clockout: "on_site",
  new_device: "on_site",
  absent: "not_in",
  not_yet: "not_in",
  suspended: null,
};
const TODAY_BY_KEY = new Map(TODAY.map((t) => [t.person.user_key, t]));

/**
 * Today's register in the reader's scope: everyone active and started, as the server's roster
 * reads it. Someone in on time is remote when their work pattern is remote and on site
 * otherwise; the worksite is their clock-in's, unless they work remotely. Nobody has clocked
 * out yet, and someone added today has not clocked in.
 */
function rosterOf(user: string): RosterRow[] {
  const keys = keysOf(user);
  const today = todayIso();
  return PEOPLE.flatMap((p): RosterRow[] => {
    if (!keys.has(p.user_key) || p.start_date > today) return [];
    const t = TODAY_BY_KEY.get(p.user_key);
    const day = t ? ROSTER[t.status] : "not_in";
    if (!day) return [];
    const remote = p.work_pattern === "remote";
    const clockIn = t?.clock_in ? at(0, t.clock_in) : null;
    return [
      {
        person: p,
        status: day === "on_site" && remote ? "remote" : day,
        clock_in_at: clockIn,
        clock_out_at: null,
        worksite: clockIn && !remote ? p.worksite : null,
        no_clock_out_yesterday: t?.status === "no_clockout",
      },
    ];
  });
}

const present = (r: RosterRow) => r.status === "on_site" || r.status === "remote" || r.status === "field" || r.status === "late";

/* ------------------------------------------------------------------ *
 * The KPI catalogue's live cards
 * ------------------------------------------------------------------ */
const text = (t: string): HomeKpiCell => ({ kind: "text", text: t });
const person = (p: MockPerson | undefined): HomeKpiCell | null => (p ? { kind: "person", person: refOf(p) } : null);
const pill = (tone: Tone, t: string): HomeKpiCell => ({ kind: "pill", tone, text: t });
const money = (amount: string): HomeKpiCell => ({ kind: "money", amount });
const date = (d: string): HomeKpiCell => ({ kind: "date", date: d });
const time = (iso: string | null): HomeKpiCell | null => (iso ? { kind: "time", at: iso } : null);
const number = (value: number): HomeKpiCell => ({ kind: "number", value });

/** A record behind a card, and the chips it falls under. */
type Rec = HomeKpiDetailRow & { groups?: string[] };
const rec = (id: string, cells: Record<string, HomeKpiCell | null>, link: string | null, groups?: string[]): Rec => ({ id, cells, link, groups });

/** What a card counts: its figure, and how many of its records fall under each chip. */
interface Figure {
  value: number | null;
  amount: string | null;
  denominator: number | null;
  groups: Record<string, number>;
  /** Anything a caption or summary line reads besides the figure. */
  extra: Record<string, number | string>;
}
const counted = (value: number, more: Partial<Figure> = {}): Figure => ({ value, amount: null, denominator: null, groups: {}, extra: {}, ...more });

interface MockCard {
  key: string;
  title: string;
  domain: HomeKpiDomain;
  unit: HomeKpiUnit;
  module: string;
  capability?: string;
  /** False for a tab's own card, never offered in the picker (Team's). */
  pickable?: boolean;
  tone?: Tone;
  records: {
    title: string;
    columns: Array<[key: string, label: string, opts?: { phone?: boolean; numeric?: boolean }]>;
    groups?: Array<[value: string, label: string]>;
    rows: (user: string) => Rec[];
  };
  /** The figure from its records; their count unless set. */
  figure?: (rows: Rec[], user: string) => Figure;
  caption?: (f: Figure) => string | null;
  summary?: (f: Figure) => string;
}

const tally = (rows: Rec[]) => {
  const out: Record<string, number> = {};
  for (const r of rows) for (const g of r.groups ?? []) out[g] = (out[g] ?? 0) + 1;
  return out;
};

const ROSTER_GROUPS: Array<[string, string]> = [
  ["on_site", "On Site"],
  ["remote", "Remote"],
  ["field", "Field"],
  ["late", "Late"],
  ["not_in", "Not In"],
  ["on_leave", "On Leave"],
  ["no_clock_out_yesterday", "No Clock-Out Yesterday"],
];
const ROSTER_PILL: Record<HomeRosterStatus, [Tone, string]> = {
  on_site: ["ok", "On Site"],
  remote: ["ok", "Remote"],
  field: ["ok", "Field"],
  late: ["warn", "Late"],
  not_in: ["neutral", "Not In"],
  on_leave: ["info", "On Leave"],
  absent: ["err", "Absent"],
};
const ROSTER_COLUMNS: MockCard["records"]["columns"] = [
  ["employee", "Employee"],
  ["status", "Status", { phone: true }],
  ["clock_in", "Clock-In", { phone: true }],
  ["clock_out", "Clock-Out"],
  ["worksite", "Worksite"],
];
const rosterRecords = (rows: RosterRow[]): Rec[] =>
  rows.map((r) =>
    rec(
      r.person.employee_id,
      { employee: person(r.person), status: pill(...ROSTER_PILL[r.status]), clock_in: time(r.clock_in_at), clock_out: null, worksite: r.worksite ? text(r.worksite) : null },
      `/people?tab=attendance&id=${r.person.employee_id}`,
      [r.status, ...(r.no_clock_out_yesterday ? ["no_clock_out_yesterday"] : [])],
    ),
  );
/** Present out of expected, as the register counts them: nobody on leave is expected. */
const rosterFigure = (rows: Rec[]): Figure => {
  const g = tally(rows);
  const presentCount = (g.on_site ?? 0) + (g.remote ?? 0) + (g.field ?? 0) + (g.late ?? 0);
  return counted(presentCount, { denominator: rows.length - (g.on_leave ?? 0), groups: g, extra: { late: g.late ?? 0, on_leave: g.on_leave ?? 0 } });
};

/* Records of the modules Home reads ahead of them being built, as their staging rows will be. */
const TASKS: Array<[string, string, number, "high" | "medium" | "low"]> = [
  ["Confirm Ember to Remember venue list", "tolu", 2, "high"],
  ["Eko Hotels re-engagement decision", "bashir", 22, "high"],
  ["NDPA certificate upload", "bashir", 12, "medium"],
  ["October budget variance note", "amara", 7, "medium"],
  ["Panel feedback, Adaeze Nnamdi", "ngozi", 5, "high"],
  ["Studio utilisation report", "emeka", 4, "low"],
  ["Knowledge article backlog", "hauwa", 7, "low"],
  ["Enugu shoot shot list", "chidera", 1, "medium"],
];
const PRIORITY: Record<string, [Tone, string]> = { high: ["err", "High"], medium: ["warn", "Medium"], low: ["neutral", "Low"] };
const REVIEWS: Array<[string, string, string]> = [
  ["chidera", "cynthia", "Probation"],
  ["samuel", "hauwa", "Probation"],
  ["precious", "tolu", "Quarterly"],
  ["grace", "bashir", "Quarterly"],
  ["adedotun", "chidera", "Peer"],
];
const VACANCIES: Array<[string, string, string, number, number]> = [
  ["Video Editor", "Studio", "emeka", 2, 21],
  ["Partnerships Associate", "Marketing & Sales", "ngozi", 1, 14],
  ["Support Lead", "Support", "hauwa", 1, 30],
];
const DOCUMENTS: Array<[string, string, number]> = [
  ["seyi", "NDPA Certificate", 3],
  ["precious", "Guarantor Form", 5],
  ["samuel", "Medical Report", 9],
];
const BUDGETS: Array<[string, string, string, string, string]> = [
  ["Marketing, Q4", "Marketing & Sales", "ngozi", "4000000.00", "3680000.00"],
  ["Studio Equipment", "Studio", "emeka", "2500000.00", "1210000.00"],
  ["Enugu Launch", "Operations & People", "cynthia", "6000000.00", "2950000.00"],
];
/** Whole percent of money spent, from the kobo digits. */
const usedPercent = (spent: string, of: string) => Number((BigInt(spent.replace(".", "")) * 100n) / BigInt(of.replace(".", "")));
const IN_APPROVAL = ["line_manager", "operations", "requisition", "ceo"];
const leaveCovers = (key: string, day: string) => leaveRequests().some((l) => l.key === key && l.status === "approved" && l.starts_on <= day && l.ends_on >= day);
const own = (user: string) => (key: string) => key === user;
const expenseScope = (user: string) => (full(user) ? () => true : own(user));
/** Partners still being worked towards a signature, in the tracker's stage order. */
const OPEN_STAGES = STAGES.filter((s) => s !== "Partnership signed" && s !== "Active partnership" && s !== "On hold");
const QUIET_DAYS = 30;

const CARDS: MockCard[] = [
  /* People */
  {
    key: "headcount",
    title: "Headcount",
    domain: "people",
    unit: "count",
    module: "people",
    records: {
      title: "Headcount",
      columns: [["employee", "Employee"], ["department", "Department", { phone: true }], ["start_date", "Start Date"]],
      rows: (u) => peopleOf(u).filter((p) => p.status !== "suspended").map((p) => rec(p.employee_id, { employee: person(p), department: text(p.department), start_date: date(p.start_date) }, `/people?tab=employees&id=${p.employee_id}`)),
    },
  },
  {
    key: "attendance_today",
    title: "Clocked In Today",
    domain: "people",
    unit: "pair",
    module: "people",
    records: { title: "Clocked In Today", columns: ROSTER_COLUMNS, groups: ROSTER_GROUPS, rows: (u) => rosterRecords(rosterOf(u)) },
    figure: rosterFigure,
    caption: (f) => (Number(f.extra.late) > 0 ? `${f.extra.late} late` : null),
    summary: (f) => `${f.value} of ${f.denominator} clocked in`,
  },
  {
    key: "leave_pending",
    title: "Leave Awaiting Approval",
    domain: "people",
    unit: "count",
    module: "people",
    records: {
      title: "Leave Awaiting Approval",
      columns: [["employee", "Employee"], ["leave_type", "Leave Type", { phone: true }], ["starts_on", "From", { phone: true }], ["ends_on", "To"], ["days", "Days", { numeric: true }]],
      rows: (u) => {
        const keys = keysOf(u);
        return leaveRequests()
          .filter((l) => l.status === "submitted" && keys.has(l.key))
          .map((l) => rec(l.leave_request_id, { employee: person(byKey(l.key)), leave_type: text(l.leave_type_name), starts_on: date(l.starts_on), ends_on: date(l.ends_on), days: number(l.days) }, `/people?tab=leave&id=${l.leave_request_id}`));
      },
    },
  },
  {
    key: "vacancies_open",
    title: "Open Vacancies",
    domain: "people",
    unit: "count",
    module: "recruitment",
    records: {
      title: "Open Vacancies",
      columns: [["vacancy", "Vacancy"], ["department", "Department", { phone: true }], ["hiring_manager", "Hiring Manager"], ["positions", "Positions", { numeric: true }], ["closes", "Closes", { phone: true }]],
      rows: () => VACANCIES.map(([title, dept, manager, positions, closes]) => rec(sid(`vacancy:${title}`), { vacancy: text(title), department: text(dept), hiring_manager: person(byKey(manager)), positions: number(positions), closes: date(isoDaysAhead(closes)) }, "/recruitment?tab=vacancies")),
    },
  },
  {
    key: "attrition_90d",
    title: "Attrition, 90 Days",
    domain: "people",
    unit: "count",
    module: "people",
    records: { title: "Left in 90 Days", columns: [["employee", "Employee"], ["department", "Department", { phone: true }], ["left_on", "Left On", { phone: true }]], rows: () => [] },
  },
  {
    key: "confirmations_due",
    title: "Confirmations Due",
    domain: "people",
    unit: "count",
    module: "people",
    records: {
      title: "Confirmations Due",
      columns: [["employee", "Employee"], ["department", "Department", { phone: true }], ["confirmation_due_on", "Due On", { phone: true }]],
      rows: (u) =>
        peopleOf(u)
          .filter((p) => p.status === "probation")
          .map((p) => {
            const due = new Date(`${p.start_date}T12:00:00Z`);
            due.setUTCMonth(due.getUTCMonth() + 6);
            return rec(p.employee_id, { employee: person(p), department: text(p.department), confirmation_due_on: date(due.toISOString().slice(0, 10)) }, `/people?tab=employees&id=${p.employee_id}`);
          }),
    },
  },
  {
    key: "documentation_pending",
    title: "Documents Requested",
    domain: "people",
    unit: "count",
    module: "people",
    records: {
      title: "Documents Requested",
      columns: [["employee", "Employee"], ["document", "Document", { phone: true }], ["requested", "Requested", { phone: true }]],
      rows: (u) => {
        const keys = keysOf(u);
        return DOCUMENTS.filter(([key]) => keys.has(key)).map(([key, doc, ago]) => rec(sid(`document-request:${key}:${doc}`), { employee: person(byKey(key)), document: text(doc), requested: time(at(ago, "10:00")) }, `/people?tab=employees&id=${byKey(key)!.employee_id}`));
      },
    },
  },
  {
    key: "reviews_due",
    title: "Reviews Due",
    domain: "people",
    unit: "count",
    module: "performance",
    records: {
      title: "Reviews Due",
      columns: [["employee", "Employee"], ["reviewer", "Reviewer", { phone: true }], ["type", "Type"], ["cycle", "Cycle"], ["closes", "Closes", { phone: true }]],
      rows: () => REVIEWS.map(([key, reviewer, type], i) => rec(sid(`review:${key}`), { employee: person(byKey(key)), reviewer: person(byKey(reviewer)), type: text(type), cycle: text("Q4"), closes: date(isoDaysAhead(3 + i * 2)) }, "/performance?tab=reviews")),
    },
  },
  {
    key: "my_attendance_30d",
    title: "My Attendance",
    domain: "people",
    unit: "pair",
    module: "ess",
    records: {
      title: "My Attendance",
      columns: [["date", "Date"], ["status", "Status", { phone: true }], ["clock_in", "Clock-In", { phone: true }], ["clock_out", "Clock-Out"]],
      groups: [["on_time", "On Time"], ["late", "Late"], ["absent", "Absent"], ["on_leave", "On Leave"]],
      rows: (u) =>
        HISTORY.filter((h) => h.person.user_key === u && h.date >= isoDaysAgo(30)).map((h) => {
          const g = h.status === "leave" ? "on_leave" : h.status === "absent" ? "absent" : h.status === "late" ? "late" : "on_time";
          const shown: Record<string, [Tone, string]> = { on_time: ["ok", "On Time"], late: ["warn", "Late"], absent: ["err", "Absent"], on_leave: ["info", "On Leave"] };
          return rec(h.event_id, { date: date(h.date), status: pill(...shown[g]), clock_in: time(h.clock_in_at), clock_out: time(h.clock_out_at) }, `/ess?tab=my-attendance`, [g]);
        }),
    },
    figure: (rows) => {
      const g = tally(rows);
      return counted(g.on_time ?? 0, { denominator: (g.on_time ?? 0) + (g.late ?? 0) + (g.absent ?? 0), groups: g, extra: { late: g.late ?? 0 } });
    },
    caption: (f) => (Number(f.extra.late) > 0 ? `${f.extra.late} late` : null),
    summary: (f) => `${f.value} of ${f.denominator} days on time`,
  },
  {
    key: "my_reviews_due",
    title: "My Reviews Due",
    domain: "people",
    unit: "count",
    module: "ess",
    records: {
      title: "My Reviews Due",
      columns: [["employee", "Review Of"], ["type", "Type", { phone: true }], ["cycle", "Cycle"], ["closes", "Closes", { phone: true }]],
      rows: (u) => REVIEWS.filter(([, reviewer]) => reviewer === u).map(([key, , type], i) => rec(sid(`review:${key}`), { employee: person(byKey(key)), type: text(type), cycle: text("Q4"), closes: date(isoDaysAhead(3 + i * 2)) }, "/ess?tab=my-performance")),
    },
  },
  {
    key: "my_leave_left",
    title: "My Leave Left",
    domain: "people",
    unit: "days",
    module: "ess",
    records: {
      title: "My Leave Left",
      columns: [["leave_type", "Leave Type"], ["allowance", "Allowance", { numeric: true }], ["taken", "Taken", { numeric: true }], ["booked", "Booked", { numeric: true }], ["waiting", "Waiting", { numeric: true }], ["left", "Left", { numeric: true, phone: true }]],
      rows: (u) =>
        leaveYear(u, Number(thisYear()))
          .balances.filter((b) => b.entitled !== null)
          .map((b) => rec(b.leave_type_id, { leave_type: text(b.name), allowance: number(b.entitled!), taken: number(b.taken), booked: number(b.booked), waiting: number(b.pending), left: number(b.remaining!) }, "/ess?tab=my-leave")),
    },
    figure: (_rows, u) => {
      const lead = leadBalance(u);
      return counted(lead ? lead.remaining : 0, { extra: { leave_type: lead ? lead.name : "Annual" } });
    },
    caption: (f) => `${f.extra.leave_type}, this year`,
    summary: (f) => `${f.value} days of ${f.extra.leave_type} left this year`,
  },
  ...(["team_present", "team_on_site", "team_remote", "team_flags"] as const).map(
    (key): MockCard => ({
      key,
      title: { team_present: "Present Today", team_on_site: "On Site", team_remote: "Remote", team_flags: "Flags" }[key],
      domain: "people",
      unit: key === "team_present" ? "pair" : "count",
      module: "home",
      capability: "home.team",
      pickable: false,
      tone: key === "team_flags" ? "warn" : undefined,
      records: {
        title: { team_present: "Present Today", team_on_site: "On Site Today", team_remote: "Remote Today", team_flags: "Flags Today" }[key],
        columns: ROSTER_COLUMNS,
        groups: key === "team_present" ? ROSTER_GROUPS : key === "team_flags" ? [["late", "Late"], ["no_clock_out_yesterday", "No Clock-Out Yesterday"]] : undefined,
        rows: (u) => {
          const all = rosterRecords(rosterOf(u));
          if (key === "team_on_site") return all.filter((r) => r.groups?.includes("on_site"));
          if (key === "team_remote") return all.filter((r) => r.groups?.includes("remote"));
          if (key === "team_flags") return all.filter((r) => r.groups?.includes("late") || r.groups?.includes("no_clock_out_yesterday"));
          return all;
        },
      },
      figure:
        key === "team_present"
          ? rosterFigure
          : (rows) => {
              const g = tally(rows);
              return counted(rows.length, { groups: g, extra: { late: g.late ?? 0, no_clock_out_yesterday: g.no_clock_out_yesterday ?? 0 } });
            },
      caption:
        key === "team_present"
          ? (f) => (Number(f.extra.on_leave) > 0 ? `${f.extra.on_leave} on leave` : null)
          : key === "team_flags"
            ? (f) => (Number(f.value) > 0 ? `${f.extra.late} late, ${f.extra.no_clock_out_yesterday} no clock-out` : null)
            : undefined,
      summary: key === "team_present" ? (f) => `${f.value} of ${f.denominator} in today` : undefined,
    }),
  ),
  /* Work */
  {
    key: "tasks_overdue",
    title: "Overdue Tasks",
    domain: "work",
    unit: "count",
    module: "workspace",
    tone: "warn",
    records: {
      title: "Overdue Tasks",
      columns: [["task", "Task"], ["assignee", "Assignee", { phone: true }], ["due", "Due", { phone: true }], ["priority", "Priority"]],
      rows: (u) => {
        const keys = keysOf(u);
        return TASKS.filter(([, who]) => keys.has(who)).map(([title, who, days, p]) => rec(sid(`task:${title}`), { task: text(title), assignee: person(byKey(who)), due: time(at(days, "17:00")), priority: pill(...PRIORITY[p]) }, "/workspace?tab=tasks"));
      },
    },
  },
  {
    key: "my_tasks_overdue",
    title: "My Overdue Tasks",
    domain: "work",
    unit: "count",
    module: "ess",
    tone: "warn",
    records: {
      title: "My Overdue Tasks",
      columns: [["task", "Task"], ["due", "Due", { phone: true }], ["priority", "Priority", { phone: true }]],
      rows: (u) => TASKS.filter(([, who]) => who === u).map(([title, , days, p]) => rec(sid(`task:${title}`), { task: text(title), due: time(at(days, "17:00")), priority: pill(...PRIORITY[p]) }, "/workspace?tab=tasks")),
    },
  },
  {
    key: "approvals_awaiting_you",
    title: "Awaiting Your Approval",
    domain: "work",
    unit: "count",
    module: "home",
    records: {
      title: "Awaiting Your Approval",
      columns: [["request", "Request"], ["person", "Person", { phone: true }], ["stage", "Stage"], ["waiting_since", "Waiting Since", { phone: true }], ["due", "Due"]],
      rows: (u) =>
        waitingOn(u).map((w) =>
          rec(w.workflow_instance_id, { request: text(w.definition_name), person: w.subject_name ? text(w.subject_name) : null, stage: pill(w.overdue ? "err" : "info", w.stage_name), waiting_since: time(w.stage_entered_at), due: time(w.stage_due_at) }, w.link, w.overdue ? ["overdue"] : []),
        ),
    },
    figure: (rows) => counted(rows.length, { extra: { overdue: tally(rows).overdue ?? 0 } }),
    caption: (f) => (Number(f.extra.overdue) > 0 ? `${f.extra.overdue} overdue` : null),
  },
  {
    key: "alerts_high_open",
    title: "Open High Alerts",
    domain: "work",
    unit: "count",
    module: "home",
    capability: "alerts.clear",
    tone: "err",
    records: {
      title: "Open High Alerts",
      columns: [["alert", "Alert"], ["raised", "Raised", { phone: true }], ["over_by", "Over By", { phone: true }]],
      rows: (u) =>
        visibleAlerts(u)
          .filter((a) => a.cleared_at === null && a.severity === "high")
          .map((a) => {
            const overBy = overByWords(a.over_by, overByKindOf(ruleOf(a).metric));
            return rec(a.home_alert_id, { alert: text(a.title), raised: time(a.raised_at), over_by: overBy === null ? null : text(overBy) }, `/home?tab=alerts&id=${a.home_alert_id}`, openDays(a) >= AGED_DAYS ? ["aged"] : []);
          }),
    },
    figure: (rows) => counted(rows.length, { extra: { aged: tally(rows).aged ?? 0 } }),
    caption: (f) => (Number(f.extra.aged) > 0 ? `${f.extra.aged} over ${AGED_DAYS} days` : null),
  },
  /* Business */
  {
    key: "partnership_pipeline",
    title: "Open Opportunities",
    domain: "business",
    unit: "count",
    module: "partnerships",
    records: {
      title: "Open Opportunities",
      columns: [["opportunity", "Opportunity"], ["partner", "Partner", { phone: true }], ["stage", "Stage", { phone: true }], ["owner", "Owner"], ["value", "Value", { numeric: true }], ["expected_close", "Expected Close"]],
      rows: () =>
        PARTNERS.filter((p) => (OPEN_STAGES as readonly string[]).includes(p.stage)).map((p, i) =>
          rec(sid(`opportunity:${p.name}`), { opportunity: text(`${p.name}, ${p.type}`), partner: text(p.name), stage: text(p.stage), owner: person(byKey(p.owner)), value: money(p.value), expected_close: date(isoDaysAhead(20 + i * 5)) }, `/partnerships?tab=partners&id=${p.partner_id}`),
        ),
    },
  },
  {
    key: "partnerships_active",
    title: "Active Partnerships",
    domain: "business",
    unit: "count",
    module: "partnerships",
    records: {
      title: "Active Partnerships",
      columns: [["partner", "Partner"], ["type", "Type"], ["owner", "Owner", { phone: true }], ["last_contact", "Last Contact", { phone: true }]],
      rows: () => PARTNERS.filter((p) => p.stage === "Active partnership").map((p) => rec(p.partner_id, { partner: text(p.name), type: text(p.type), owner: person(byKey(p.owner)), last_contact: time(at(p.quiet_days, "11:00")) }, `/partnerships?tab=partners&id=${p.partner_id}`)),
    },
  },
  {
    key: "partnerships_signed_value",
    title: "Signed Value",
    domain: "business",
    unit: "money",
    module: "partnerships",
    records: {
      title: "Signed This Year",
      columns: [["agreement", "Agreement"], ["partner", "Partner", { phone: true }], ["starts_on", "Starts"], ["value", "Value", { numeric: true, phone: true }], ["owner", "Owner"]],
      rows: () => signedThisYear().map((p) => rec(sid(`agreement:${p.name}`), { agreement: text(`${p.name} Agreement`), partner: text(p.name), starts_on: date(p.since!), value: money(p.value), owner: person(byKey(p.owner)) }, `/partnerships?tab=partners&id=${p.partner_id}`)),
    },
    figure: (rows) => ({ value: null, amount: sumMoney(signedThisYear().map((p) => p.value)), denominator: null, groups: {}, extra: { agreements: rows.length } }),
    caption: (f) => `${f.extra.agreements} ${f.extra.agreements === 1 ? "agreement" : "agreements"}`,
  },
  {
    key: "partnerships_quiet_30d",
    title: "No Contact 30 Days",
    domain: "business",
    unit: "count",
    module: "partnerships",
    tone: "warn",
    records: {
      title: "No Contact 30 Days",
      columns: [["partner", "Partner"], ["owner", "Owner", { phone: true }], ["last_contact", "Last Contact", { phone: true }]],
      rows: () => quietPartners().map((p) => rec(p.partner_id, { partner: text(p.name), owner: person(byKey(p.owner)), last_contact: time(at(p.quiet_days, "11:00")) }, `/partnerships?tab=partners&id=${p.partner_id}`)),
    },
  },
  {
    key: "proposals_out",
    title: "Proposals Out",
    domain: "business",
    unit: "count",
    module: "partnerships",
    records: {
      title: "Proposals Out",
      columns: [["proposal", "Proposal"], ["opportunity", "Opportunity"], ["partner", "Partner", { phone: true }], ["sent", "Sent", { phone: true }], ["value", "Value", { numeric: true }]],
      rows: () => PARTNERS.filter((p) => p.stage === "Proposal sent").map((p) => rec(sid(`proposal:${p.name}`), { proposal: text(`${p.name} Proposal`), opportunity: text(`${p.name}, ${p.type}`), partner: text(p.name), sent: time(at(p.days_at_stage, "10:00")), value: money(p.value) }, "/partnerships?tab=proposals")),
    },
  },
  /* Finance */
  {
    key: "expenses_pending",
    title: "Expenses Awaiting Approval",
    domain: "finance",
    unit: "money",
    module: "expenses",
    records: {
      title: "Expenses Awaiting Approval",
      columns: [["request", "Request"], ["employee", "Employee", { phone: true }], ["purpose", "Purpose"], ["category", "Category"], ["amount", "Amount", { numeric: true, phone: true }], ["submitted", "Submitted"]],
      rows: (u) => {
        const mine = expenseScope(u);
        return REQUESTS.filter((r) => IN_APPROVAL.includes(r.stage) && mine(r.requester)).map((r) => rec(r.request_id, { request: text(r.number), employee: person(byKey(r.requester)), purpose: text(r.title), category: text(r.category), amount: money(r.amount), submitted: time(r.submitted_at) }, `/expenses?tab=approvals&id=${r.request_id}`));
      },
    },
    figure: (rows, u) => {
      const mine = expenseScope(u);
      return { value: null, amount: sumMoney(REQUESTS.filter((r) => IN_APPROVAL.includes(r.stage) && mine(r.requester)).map((r) => r.amount)), denominator: null, groups: {}, extra: { requests: rows.length } };
    },
    caption: (f) => `${f.extra.requests} ${f.extra.requests === 1 ? "request" : "requests"}`,
  },
  {
    key: "budget_vs_actual",
    title: "Budget Used",
    domain: "finance",
    unit: "pct",
    module: "expenses",
    records: {
      title: "Budgets Running Now",
      columns: [["budget", "Budget"], ["department", "Department"], ["owner", "Owner"], ["allocated", "Allocated", { numeric: true }], ["spent", "Spent", { numeric: true, phone: true }], ["used", "Used", { numeric: true, phone: true }]],
      rows: () => BUDGETS.map(([name, dept, owner, allocated, spent]) => rec(sid(`budget:${name}`), { budget: text(name), department: text(dept), owner: person(byKey(owner)), allocated: money(allocated), spent: money(spent), used: number(usedPercent(spent, allocated)) }, "/expenses?tab=budgets")),
    },
    figure: () => counted(usedPercent(sumMoney(BUDGETS.map((b) => b[4])), sumMoney(BUDGETS.map((b) => b[3]))), { denominator: BUDGETS.length }),
    caption: (f) => (Number(f.denominator) > 0 ? `across ${f.denominator} ${f.denominator === 1 ? "budget" : "budgets"}` : null),
  },
];
const BY_KEY = new Map(CARDS.map((c) => [c.key, c]));

function signedThisYear() {
  return PARTNERS.filter((p) => p.since && p.since.slice(0, 4) === thisYear());
}
function quietPartners() {
  return PARTNERS.filter((p) => p.stage !== "On hold" && p.quiet_days >= QUIET_DAYS).sort((a, b) => b.quiet_days - a.quiet_days);
}
/** The leave type My Leave leads with: Annual, else the first with an allowance. */
function leadBalance(user: string) {
  const balances = leaveYear(user, Number(thisYear())).balances.filter((b) => b.remaining !== null);
  const lead = balances.find((b) => b.code === "annual") ?? balances[0];
  return lead ? { leave_type_id: lead.leave_type_id, name: lead.name, remaining: lead.remaining! } : null;
}

/** The cards a person may see: their module's view grant and the card's capability; the CEO, every one. */
function eligibleFor(user: string): Set<string> {
  const m = me(user);
  return new Set(CARDS.filter((c) => (m.is_ceo || mayView(m, c.module)) && (!c.capability || holds(m, c.capability))).map((c) => c.key));
}

function figureOf(card: MockCard, user: string): Figure {
  const rows = card.records.rows(user);
  return card.figure ? card.figure(rows, user) : counted(rows.length, { groups: tally(rows) });
}

const isZero = (unit: HomeKpiUnit, f: Figure) => (unit === "money" ? /^0+(\.0+)?$/.test(f.amount ?? "0") : f.value === 0);

function cardOf(card: MockCard, f: Figure): HomeKpiCard {
  const ratio = card.unit === "pct" || card.unit === "pair";
  return {
    key: card.key,
    title: card.title,
    unit: card.unit,
    value: card.unit === "money" ? null : f.value,
    amount: card.unit === "money" ? f.amount : null,
    denominator: ratio ? f.denominator : null,
    measurable: ratio ? (f.denominator ?? 0) > 0 : true,
    caption: card.caption ? card.caption(f) : null,
    tone: card.tone && !isZero(card.unit, f) ? card.tone : null,
    trend: null,
    opens: true,
  };
}

function metaOf(card: MockCard, f: Figure): HomeKpiDetailMeta {
  return {
    key: card.key,
    title: card.records.title,
    summary: card.summary ? card.summary(f) : null,
    columns: card.records.columns.map(([key, label, opts]) => ({ key, label, numeric: opts?.numeric === true, phone: opts?.phone === true })),
    groups: (card.records.groups ?? []).map(([value, label]) => ({ value, label, count: f.groups[value] ?? 0 })),
  };
}

/* ------------------------------------------------------------------ *
 * Which cards show, and the picker (the server's kpi-catalog/resolve.js)
 * ------------------------------------------------------------------ */
const MAX_CARDS = 4;
const VIEW_DEFAULTS: Record<string, string[]> = {
  operations: ["attendance_today", "tasks_overdue", "expenses_pending", "partnerships_active", "headcount"],
  ceo: ["goals_on_track", "approvals_awaiting_you", "partnerships_signed_value", "alerts_high_open", "attendance_today"],
  partnerships: ["partnerships_active", "partnerships_signed_value", "partnerships_quiet_30d", "proposals_out"],
  staff: ["my_targets_on_track", "my_tasks_overdue", "my_reviews_due", "my_attendance_30d", "my_leave_left"],
};
/**
 * A role's cards, as Settings · Roles will set them (M9) through the routes below. Operations &
 * People locks Clocked In Today, so the demonstration shows a locked card in the picker.
 */
const ROLE_CARDS: Record<string, { default_ids: string[]; locked_ids: string[] }> = {
  operations_people: { default_ids: ["attendance_today", "tasks_overdue", "expenses_pending", "partnerships_active"], locked_ids: ["attendance_today"] },
};
/** Each person's own pick; none until they choose. */
const PICKS = new Map<string, string[]>();

const pickable = (id: string, eligible: Set<string>) => BY_KEY.get(id)?.pickable !== false && BY_KEY.has(id) && eligible.has(id);
const keepEligible = (ids: string[], eligible: Set<string>) => [...new Set(ids)].filter((id) => pickable(id, eligible));

function choiceOf(user: string) {
  const m = me(user);
  const eligible = eligibleFor(user);
  const roleCards = m.roles.flatMap((r) => (ROLE_CARDS[r.code] ? [ROLE_CARDS[r.code]] : []));
  const locked = keepEligible(roleCards.flatMap((r) => r.locked_ids), eligible);
  const lead = (ids: string[]) => [...locked, ...ids.filter((id) => !locked.includes(id))].slice(0, MAX_CARDS);
  const fallback = (): { source: HomeKpiSource; ids: string[] } => {
    const fromRoles = keepEligible(roleCards.flatMap((r) => r.default_ids), eligible);
    if (fromRoles.length) return { source: "role", ids: lead(fromRoles) };
    return { source: "view", ids: lead(keepEligible(VIEW_DEFAULTS[m.home_view] ?? [], eligible).slice(0, MAX_CARDS)) };
  };
  const picks = PICKS.get(user);
  const showing = picks ? { source: "user" as const, ids: lead(keepEligible(picks, eligible)) } : fallback();
  return { m, eligible, locked, picks, showing, fallback: fallback() };
}

function pickerOf(user: string): HomeKpiPicker {
  const c = choiceOf(user);
  return {
    max: MAX_CARDS,
    cards: CARDS.filter((card) => pickable(card.key, c.eligible)).map((card) => ({ key: card.key, title: card.title, domain: card.domain, unit: card.unit })),
    kpi_ids: c.picks ? keepEligible(c.picks, c.eligible).slice(0, MAX_CARDS) : null,
    default_ids: c.fallback.ids,
    locked_ids: c.locked.slice(0, MAX_CARDS),
    showing_ids: c.showing.ids,
    source: c.showing.source,
  };
}

/* ------------------------------------------------------------------ *
 * The Overview's sections (the server's dashboard.layout.js)
 * ------------------------------------------------------------------ */
const VIEWS: Record<string, { chart?: HomeChart["kind"]; donut?: HomeDonut["kind"]; clocked_in?: boolean; pipeline?: boolean; goals?: boolean; staff?: boolean }> = {
  operations: { chart: "attendance_days", donut: "on_time", clocked_in: true, pipeline: true, goals: true },
  ceo: { chart: "goals", donut: "org_kpi", pipeline: true },
  partnerships: { chart: "signed_value", pipeline: true, goals: true },
  staff: { staff: true },
};

/** The organisation's goals this quarter. Progress is null until Performance measures it (M2). */
const GOALS: HomeGoal[] = [
  ["Revenue, FY Target ₦180M", 75],
  ["Ember to Remember Delivered", 40],
  ["Headcount, 30 by Q1", 60],
  ["Partner Network, 10 Signed", 70],
  ["On Time Attendance 90%", 74],
].map(([title, days]) => ({ title: title as string, progress: null, due_on: isoDaysAhead(days as number), link: "/performance?tab=goals" }));
const MY_GOALS: HomeGoal[] = [
  ["24 Pieces Published", 70],
  ["Enugu Shot List", 12],
  ["Channel Growth", 74],
  ["Team Reviews Filed", 9],
].map(([title, days]) => ({ title: title as string, progress: null, due_on: isoDaysAhead(days as number), link: "/ess?tab=my-performance" }));

/** Who was in on each of the last 14 working days, today the last when it is one. */
function attendanceDays(user: string) {
  const keys = keysOf(user);
  const days: Array<{ date: string; present: number; expected: number }> = [];
  if (shiftOf(todayIso()).working_day) {
    const r = rosterOf(user);
    days.push({ date: todayIso(), present: r.filter(present).length, expected: r.filter((x) => x.status !== "on_leave").length });
  }
  for (let back = 1; days.length < 14 && back <= 45; back += 1) {
    const day = isoDaysAgo(back);
    if (!shiftOf(day).working_day) continue;
    const rows = HISTORY.filter((h) => h.date === day && keys.has(h.person.user_key));
    days.push({ date: day, present: rows.filter((h) => h.clock_in_at).length, expected: rows.filter((h) => h.status !== "leave").length });
  }
  return days.reverse();
}

/** This month so far: the days people were in on time, late, or absent. */
function onTimeDonut(user: string): HomeDonut {
  const keys = keysOf(user);
  const first = `${todayIso().slice(0, 7)}-01`;
  const month = HISTORY.filter((h) => h.date >= first && keys.has(h.person.user_key));
  const today = shiftOf(todayIso()).working_day ? rosterOf(user) : [];
  return {
    kind: "on_time",
    on_time: month.filter((h) => h.clock_in_at && h.status !== "late").length + today.filter((r) => r.status === "on_site" || r.status === "remote").length,
    late: month.filter((h) => h.status === "late").length + today.filter((r) => r.status === "late").length,
    absent: month.filter((h) => h.status === "absent").length,
  };
}

/** The year read whole, as Signed Value reads it: to this month, or to a later one an agreement starts in. */
function signedByMonth(): HomeChart {
  const year = thisYear();
  const last = Math.max(Number(todayIso().slice(5, 7)), ...signedThisYear().map((p) => Number(p.since!.slice(5, 7))));
  const months = Array.from({ length: last }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  return { kind: "signed_value", months: months.map((month) => ({ month, amount: sumMoney(["0.00", ...signedThisYear().filter((p) => p.since!.startsWith(month)).map((p) => p.value)]) })) };
}

function pipelineOf(): HomePipeline {
  return {
    stages: OPEN_STAGES.map((stage) => ({ stage: stage.toLowerCase().replace(/[^a-z]+/g, "_"), label: stage, open: PARTNERS.filter((p) => p.stage === stage).length })).filter((s) => s.open > 0),
    quiet_30d: quietPartners().length,
  };
}

function dayStripOf(user: string): HomeDayStrip {
  const t = todayOf(user);
  const p = byKey(user)!;
  const startMin = t.shift.starts_at ? Number(t.shift.starts_at.slice(0, 2)) * 60 + Number(t.shift.starts_at.slice(3, 5)) + t.shift.grace_minutes : null;
  const inMin = t.clock_in_at ? Number(formatTime(t.clock_in_at).slice(0, 2)) * 60 + Number(formatTime(t.clock_in_at).slice(3, 5)) : null;
  const remote = p.work_pattern === "remote";
  const status: HomeRosterStatus | null =
    t.state === "unavailable" ? "on_leave" : t.clock_in_at ? (startMin !== null && inMin !== null && inMin > startMin ? "late" : remote ? "remote" : "on_site") : t.shift.working_day ? "not_in" : null;
  const worked = t.clock_in_at && t.clock_out_at ? Math.floor((Date.parse(t.clock_out_at) - Date.parse(t.clock_in_at)) / 60000) : 0;
  return {
    starts_at: t.shift.starts_at,
    ends_at: t.shift.ends_at,
    clock_in_at: t.clock_in_at,
    clock_out_at: t.clock_out_at,
    status,
    worksite: t.clock_in_at && !remote && t.location.kind === "worksite" ? t.location.name : null,
    worked_minutes: Math.max(0, worked),
  };
}

function upcomingLeaveOf(user: string): HomeUpcomingLeave {
  const today = todayIso();
  const requests = leaveRequests()
    .filter((l) => l.key === user && (l.status === "submitted" || l.status === "approved") && l.ends_on >= today)
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on))
    .map(({ key: _key, ...r }) => r);
  return { balance: leadBalance(user), requests };
}

/** Today's events, as the allow-list lets them through: people's in the reader's scope, the community's to every holder. */
function activityOf(user: string, m: Me): HomeActivityItem[] | null {
  const people = mayView(m, "people");
  const community = mayView(m, "community");
  if (!people && !community) return null;
  const keys = keysOf(user);
  const events: Array<[string, string, string, string | null, string, string]> = [
    ["celebration.posted", "community", "00:01", null, "hauwa", "/community?tab=channels"],
    ["attendance.review_required", "people", "08:58", null, "seyi", "/people?tab=attendance"],
    ["leave_request.approved", "people", "09:12", "cynthia", "tobi", "/people?tab=leave"],
    ["employee.created", "people", "10:05", "cynthia", "samuel", "/people?tab=employees"],
    ["recognition.posted", "community", "11:20", "ngozi", "adedotun", "/community?tab=channels"],
  ];
  const now = Date.now();
  return events
    .filter(([, module, , , subject]) => (module === "community" ? community : people && keys.has(subject)))
    .map(([event_key, module_key, hm, actor, subject, link]) => ({
      event_id: sid(`event:${event_key}:${subject}`),
      event_key,
      module_key,
      occurred_at: at(0, hm),
      actor_name: actor ? byKey(actor)!.display_name : null,
      subject: byKey(subject)!.display_name,
      link,
    }))
    .filter((e) => Date.parse(e.occurred_at) <= now)
    .reverse();
}

/** What each Home view's week holds: [weekday, 1 is Monday; event or task; title; time]. */
const WEEK_ITEMS: Record<string, Array<[number, "event" | "task", string, string | null]>> = {
  operations: [[1, "task", "Close out Q4 departmental targets", "17:00"], [2, "event", "Panel interview, Adaeze Nnamdi", "11:00"], [3, "event", "Ember to Remember, all hands", "10:00"], [4, "task", "Onboarding pack for the Enugu hires", "16:00"], [5, "event", "Weekly productivity review", "09:30"]],
  ceo: [[1, "task", "Board pack review", "17:00"], [2, "event", "Payroll sign off", "14:00"], [3, "event", "Ember to Remember, Lagos leg", "10:00"], [4, "task", "Investor update draft", "16:00"]],
  partnerships: [[1, "task", "Eko Hotels re-engagement call", "11:00"], [2, "event", "ProvidusBank proposal review", "14:00"], [3, "event", "MTN quarterly review", "10:00"], [4, "task", "Pipeline review with Operations", "15:00"]],
  staff: [[3, "event", "Ember to Remember, Lagos leg", "10:00"], [5, "task", "Reviews due to your manager", "17:00"]],
};

function weekOf(user: string, m: Me): HomeWeekDay[] {
  const today = todayIso();
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const monday = new Date(`${today}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((dow + 6) % 7));
  const items = mayView(m, "workspace") ? (WEEK_ITEMS[m.home_view] ?? []) : [];
  const days: HomeWeekDay[] = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    const day = d.toISOString().slice(0, 10);
    const shift = shiftOf(day);
    if (!shift.working_day) continue;
    days.push({
      date: day,
      starts_at: shift.starts_at,
      ends_at: shift.ends_at,
      holiday: null,
      on_leave: leaveCovers(user, day),
      items: items.filter(([w]) => w === i + 1).map(([, kind, title, hm]) => ({ kind, title, at: hm ? new Date(`${day}T${hm}:00+01:00`).toISOString() : null, link: kind === "task" ? "/workspace?tab=tasks" : "/workspace?tab=calendar" })),
    });
  }
  return days;
}

function overviewOf(user: string): HomeOverview {
  const c = choiceOf(user);
  const m = c.m;
  const v = VIEWS[m.home_view] ?? VIEWS.staff;
  const may = (module: string) => mayView(m, module);
  const cards = c.showing.ids.map((id) => cardOf(BY_KEY.get(id)!, figureOf(BY_KEY.get(id)!, user)));
  const roster = v.clocked_in && may("people") ? rosterOf(user) : null;
  const charts: Record<HomeChart["kind"], () => HomeChart | null> = {
    attendance_days: () => (may("people") ? { kind: "attendance_days", days: attendanceDays(user) } : null),
    goals: () => (may("performance") ? { kind: "goals", goals: GOALS.map(({ title, progress, link }) => ({ title, progress, link })) } : null),
    signed_value: () => (may("partnerships") ? signedByMonth() : null),
  };
  const donuts: Record<HomeDonut["kind"], () => HomeDonut | null> = {
    on_time: () => (may("people") ? onTimeDonut(user) : null),
    org_kpi: () => (may("performance") ? { kind: "org_kpi", percent: null, departments: DEPARTMENTS.map((name) => ({ department_id: departmentId(name), department: name, percent: null })) } : null),
  };
  const t = todayOf(user);
  return {
    greeting_name: m.first_name,
    date: todayIso(),
    clocked_in: roster ? { present: roster.filter(present).length, expected: roster.filter((r) => r.status !== "on_leave").length } : null,
    cards,
    picker_source: c.showing.source,
    chart: v.chart ? charts[v.chart]() : null,
    donut: v.donut ? donuts[v.donut]() : null,
    day_strip: v.staff && may("ess") ? dayStripOf(user) : null,
    pipeline: v.pipeline && may("partnerships") ? pipelineOf() : null,
    goals: v.goals && may("performance") ? GOALS : null,
    my_goals: v.staff && may("ess") ? MY_GOALS : null,
    upcoming_leave: v.staff && may("ess") ? upcomingLeaveOf(user) : null,
    activity: activityOf(user, m),
    week: weekOf(user, m),
    alerts_to_clear: holds(m, "alerts.clear") ? alertsToClear(user).length : null,
    // The mock keeps one session per tab, so every Overview it answers is the day's first session's.
    prompt_clock_in: t.state === "not_clocked_in" && t.shift.working_day,
  };
}

/* ------------------------------------------------------------------ *
 * Alerts and their rules, in the contract's shapes (packages/contract/schemas/alerts.js)
 * ------------------------------------------------------------------ */

/** A High alert open this many days goes to the CEO (home.md §6). */
const AGED_DAYS = 14;
/** Overdue 7 Days +: open more than this many days. */
const OVERDUE_DAYS = 7;
const DAY_MS = 86_400_000;
/**
 * A person's login id, as Home's tables keep it (`created_by`, `cleared_by`, a report's owner and
 * recipients): the same id the other mocks' people lists and profile cards give, so a recipient
 * picked on New Report is a login this mock knows.
 */
const loginOf = (key: string) => sid(`user:${key}`);
/** The note a switched-off rule leaves on the alerts it dismisses. */
const RULE_OFF_NOTE = "Rule switched off";

type Severity = HomeAlertRule["severity"];
type RuleSeed = [name: string, metric: keyof typeof alertsContract.HOME_ALERT_METRICS, threshold: string, window: number | null, severity: Severity, permission: string, enabled: boolean];

/**
 * A rule's key, as the server makes it: `<metric>.<slug of the name>`, the slug lower case with
 * accents dropped, runs of anything else as one `_`, at most 40 characters ("rule" when nothing
 * is left), and `_2`, `_3` on the end when taken (keys compare without case).
 */
function ruleKey(metric: string, name: string, taken: (key: string) => boolean): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .slice(0, 40)
    .replace(/^_+|_+$/g, "");
  const base = `${metric}.${slug || "rule"}`;
  let key = base;
  for (let n = 2; taken(key.toLowerCase()); n += 1) key = `${base}_${n}`;
  return key;
}

/** A rule on every metric, two on late arrivals and one switched off, so a laptop shows every state. */
const RULE_SEEDS: RuleSeed[] = [
  ["Late Arrivals", "late_arrivals", "3", 30, "medium", "people.view", true],
  ["Repeated Lateness", "late_arrivals", "5", 30, "high", "people.view", true],
  ["Missing Clock-Outs", "missing_clock_out", "2", 14, "medium", "people.view", true],
  ["Approvals Waiting", "approval_ageing", "3", null, "high", "people.approve", true],
  ["Documents Expiring", "document_expiry", "30", null, "low", "people.edit", true],
  ["Probation Ending", "confirmation_due", "14", null, "medium", "people.edit", true],
  ["Contracts Ending", "contract_ending", "30", null, "medium", "people.edit", true],
  ["Quiet Partners", "partner_inactivity", "30", null, "medium", "partnerships.edit", true],
  ["Budget Nearly Spent", "budget_threshold", "90", null, "medium", "expenses.approve", true],
  ["Slow Hiring Stages", "recruitment_sla", "5", null, "high", "recruitment.edit", false],
];

type MockRule = Omit<HomeAlertRule, "category" | "kind" | "who_can_clear" | "open_alerts">;
const RULES: MockRule[] = [];
for (const [name, metric, threshold, window_days, severity, permission_key, enabled] of RULE_SEEDS) {
  const key = ruleKey(metric, name, (k) => RULES.some((r) => r.key.toLowerCase() === k));
  RULES.push({
    home_alert_rule_id: sid(`alert-rule:${key}`),
    key,
    name,
    metric,
    threshold,
    window_days,
    severity,
    permission_key,
    enabled,
    created_by: loginOf("cynthia"),
    updated_by: loginOf("cynthia"),
    created_at: at(60, "10:00"),
    updated_at: at(enabled ? 60 : 6, "10:00"),
  });
}
const ruleNamed = (name: string) => RULES.find((r) => r.name === name)!;

/** An alert as the mock keeps it: the row the shared engine writes. */
interface MockAlert {
  home_alert_id: string;
  home_alert_rule_id: string;
  subject_type: string;
  subject_id: string;
  subject_employee_id: string | null;
  title: string;
  trigger: string | null;
  severity: Severity;
  over_by: string | null;
  raised_at: string;
  last_seen_at: string;
  escalated_at: string | null;
  cleared_at: string | null;
  cleared_by: string | null;
  outcome: "cleared" | "dismissed" | null;
  note: string | null;
  link: string | null;
}

/** "Late on 09/10/2026, 12/10/2026 and 14/10/2026", or for many days "Late on 6 days, last on 14/10/2026", as the server words a trigger. */
function onDays(lead: string, back: number[]): string {
  const shown = [...back].sort((a, b) => b - a).map((n) => formatDate(isoDaysAgo(n)));
  if (shown.length > 3) return `${lead} ${shown.length} days, last on ${shown[shown.length - 1]}`;
  return shown.length === 1 ? `${lead} ${shown[0]}` : `${lead} ${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

type AlertSeed = {
  rule: string;
  subject: [type: string, id: string];
  /** The person it is about, by their key; none for a partner or a budget. */
  who: string | null;
  title: string;
  trigger: string;
  over_by: string;
  /** Raised this many days ago. */
  raised: number;
  /** Closed this many days ago, and how; open when absent. A rule switched off closes its alerts as no one (`by` null). */
  closed?: { days: number; at: string; outcome: "cleared" | "dismissed"; by: string | null; note?: string };
  link: string | null;
};

const staff = (key: string) => byKey(key)!;
const employeeLink = (key: string) => `/people?tab=employees&id=${staff(key).employee_id}`;
const partnerNamed = (name: string) => PARTNERS.find((p) => p.name === name)!;

/**
 * Open alerts on every category, of both kinds (a count at or past its threshold, a date coming
 * up, falling today or gone), about people across the tree (one about Ngozi, whom only
 * Operations and the CEO see) and about no one in particular; two dismissed (one by a person,
 * one by its rule being switched off) and some cleared this week.
 */
const ALERT_SEEDS: AlertSeed[] = [
  { rule: "Late Arrivals", subject: ["employee", "bashir"], who: "bashir", title: "Bashir Lawal: 4 late arrivals in 30 days", trigger: onDays("Late on", [1, 6, 9, 13]), over_by: "1", raised: 2, link: "/people?tab=attendance" },
  { rule: "Late Arrivals", subject: ["employee", "rotimi"], who: "rotimi", title: "Rotimi Alade: 6 late arrivals in 30 days", trigger: onDays("Late on", [0, 3, 8, 15, 17, 22]), over_by: "3", raised: 17, link: "/people?tab=attendance" },
  { rule: "Repeated Lateness", subject: ["employee", "rotimi"], who: "rotimi", title: "Rotimi Alade: 6 late arrivals in 30 days", trigger: onDays("Late on", [0, 3, 8, 15, 17, 22]), over_by: "1", raised: 16, link: "/people?tab=attendance" },
  { rule: "Late Arrivals", subject: ["employee", "ngozi"], who: "ngozi", title: "Ngozi Eze: 3 late arrivals in 30 days", trigger: onDays("Late on", [2, 7, 19]), over_by: "0", raised: 2, link: "/people?tab=attendance" },
  { rule: "Missing Clock-Outs", subject: ["employee", "emeka"], who: "emeka", title: "Emeka Obi: 3 missing clock-outs in 14 days", trigger: onDays("No clock-out on", [1, 5, 12]), over_by: "1", raised: 1, link: "/people?tab=attendance" },
  { rule: "Approvals Waiting", subject: ["workflow_instance", "leave:funke"], who: "funke", title: "Annual Leave for Funke Bello: waiting 5 days", trigger: `At Line Manager since ${formatDate(isoDaysAgo(5))}`, over_by: "2", raised: 2, link: "/people?tab=leave" },
  { rule: "Documents Expiring", subject: ["document", "permit:grace"], who: "grace", title: "Grace Okon: Work Permit", trigger: `Expires on ${formatDate(isoDaysAhead(12))}`, over_by: "12", raised: 18, link: employeeLink("grace") },
  { rule: "Documents Expiring", subject: ["document", "first-aid:hauwa"], who: "hauwa", title: "Hauwa Yusuf: First Aid Certificate", trigger: `Expired on ${formatDate(isoDaysAgo(3))}`, over_by: "-3", raised: 33, link: employeeLink("hauwa") },
  { rule: "Documents Expiring", subject: ["document", "passport:tobi"], who: "tobi", title: "Tobi Ojo: Passport", trigger: `Expires on ${formatDate(isoDaysAhead(0))}`, over_by: "0", raised: 30, link: employeeLink("tobi") },
  { rule: "Probation Ending", subject: ["employee", "chidera"], who: "chidera", title: "Chidera Nwosu: confirmation due", trigger: `Due on ${formatDate(isoDaysAhead(6))}`, over_by: "6", raised: 8, link: employeeLink("chidera") },
  { rule: "Contracts Ending", subject: ["employee", "amara"], who: "amara", title: "Amara Okafor: contract ending", trigger: `Ends on ${formatDate(isoDaysAhead(21))}`, over_by: "21", raised: 9, link: employeeLink("amara") },
  { rule: "Quiet Partners", subject: ["partner", "Eko Hotels"], who: null, title: "Eko Hotels: no contact in 34 days", trigger: `Last contact on ${formatDate(isoDaysAgo(34))}`, over_by: "4", raised: 4, link: `/partnerships?tab=partners&id=${partnerNamed("Eko Hotels").partner_id}` },
  { rule: "Quiet Partners", subject: ["partner", "Kano Trade Council"], who: null, title: "Kano Trade Council: no contact in 52 days", trigger: `Last contact on ${formatDate(isoDaysAgo(52))}`, over_by: "22", raised: 22, link: `/partnerships?tab=partners&id=${partnerNamed("Kano Trade Council").partner_id}` },
  { rule: "Budget Nearly Spent", subject: ["budget", "marketing-sales"], who: null, title: "Marketing & Sales: 94% spent", trigger: "₦4,700,000.00 of ₦5,000,000.00", over_by: "4", raised: 3, link: "/expenses?tab=budgets" },
  { rule: "Late Arrivals", subject: ["employee", "seyi"], who: "seyi", title: "Seyi Balogun: 3 late arrivals in 30 days", trigger: onDays("Late on", [11, 14, 20]), over_by: "0", raised: 10, closed: { days: 5, at: "11:20", outcome: "dismissed", by: "cynthia", note: "Client site visits, agreed in advance" }, link: "/people?tab=attendance" },
  { rule: "Slow Hiring Stages", subject: ["application", "senior-designer"], who: null, title: "Senior Designer: 7 days at Interview", trigger: `At Interview since ${formatDate(isoDaysAgo(15))}`, over_by: "2", raised: 8, closed: { days: 6, at: "10:00", outcome: "dismissed", by: null, note: RULE_OFF_NOTE }, link: "/recruitment?tab=interviews" },
  { rule: "Missing Clock-Outs", subject: ["employee", "yusuf"], who: "yusuf", title: "Yusuf Musa: 2 missing clock-outs in 14 days", trigger: onDays("No clock-out on", [4, 9]), over_by: "0", raised: 3, closed: { days: 0, at: "08:05", outcome: "cleared", by: "cynthia" }, link: "/people?tab=attendance" },
  { rule: "Documents Expiring", subject: ["document", "ndpa:damilola"], who: "damilola", title: "Damilola Eke: NDPA Certificate", trigger: `Expired on ${formatDate(isoDaysAgo(20))}`, over_by: "-20", raised: 40, closed: { days: 0, at: "08:10", outcome: "cleared", by: "cynthia" }, link: employeeLink("damilola") },
];

const ALERTS: MockAlert[] = ALERT_SEEDS.map((s) => {
  const rule = ruleNamed(s.rule);
  const raised = at(s.raised, "06:00");
  return {
    home_alert_id: sid(`alert:${rule.key}:${s.subject.join(":")}`),
    home_alert_rule_id: rule.home_alert_rule_id,
    subject_type: s.subject[0],
    subject_id: s.who ? staff(s.who).employee_id : sid(`${s.subject[0]}:${s.subject[1]}`),
    subject_employee_id: s.who ? staff(s.who).employee_id : null,
    title: s.title,
    trigger: s.trigger,
    severity: rule.severity,
    over_by: `${s.over_by}.00`,
    raised_at: raised,
    last_seen_at: s.closed ? at(s.closed.days, "06:00") : at(0, "06:00"),
    escalated_at: rule.severity === "high" && !s.closed && s.raised >= AGED_DAYS ? at(s.raised - AGED_DAYS, "06:10") : null,
    cleared_at: s.closed ? at(s.closed.days, s.closed.at) : null,
    cleared_by: s.closed?.by ? loginOf(s.closed.by) : null,
    outcome: s.closed?.outcome ?? null,
    note: s.closed?.note ?? null,
    link: s.link,
  };
});

/** Who Can Clear as the server words a rule's grant: the module's label and who holds the action ("People Approvers"). */
const HOLDERS: Record<string, string> = { view: "Viewers", create: "Creators", edit: "Editors", delete: "Deleters", approve: "Approvers", export: "Exporters" };
const grantWords = (permissionKey: string) => {
  const [module, action] = permissionKey.split(".");
  return `${MODULES.find((m) => m.key === module)?.label ?? module} ${HOLDERS[action] ?? action}`;
};

const ruleOf = (a: MockAlert) => RULES.find((r) => r.home_alert_rule_id === a.home_alert_rule_id)!;
const metricOf = (metric: string) => (Object.hasOwn(alertsContract.HOME_ALERT_METRICS, metric) ? alertsContract.HOME_ALERT_METRICS[metric as keyof typeof alertsContract.HOME_ALERT_METRICS] : null);
const nameOfLogin = (userId: string | null) => (userId ? (PEOPLE.find((p) => loginOf(p.user_key) === userId)?.display_name ?? null) : null);
const openDays = (a: MockAlert) => Math.floor((Date.now() - Date.parse(a.raised_at)) / DAY_MS);
const stateOf = (a: MockAlert): HomeAlert["outcome"] | "open" => a.outcome ?? "open";

/** Alerts and rules are read by holders of either capability; the routes check it before reading anything. */
const withoutAlerts = (user: string) => {
  const m = me(user);
  return holds(m, "alerts.clear") || holds(m, "alerts.manage") ? null : fail(403, "CAPABILITY_REQUIRED", "This needs an authority you do not hold");
};
const withoutCapability = (user: string, code: string) => (holds(me(user), code) ? null : fail(403, "CAPABILITY_REQUIRED", "This needs an authority you do not hold"));

/**
 * Does the reader's grant on the rule's `permission_key` reach the alert's subject (home.md §6
 * Alerts)? The grant's module and action, then its scope over the person it is about: the
 * reader's scope as Team reads it (everyone for Operations and the CEO, else the reader and
 * everyone below them). An alert about no one in particular reaches only an organisation-wide
 * scope, and one about the reader never does. The CEO reaches every alert.
 */
function grantReaches(user: string, a: MockAlert): boolean {
  const m = me(user);
  if (m.is_ceo) return true;
  if (a.subject_employee_id !== null && a.subject_employee_id === byKey(user)?.employee_id) return false;
  const [module, action] = ruleOf(a).permission_key.split(".");
  if (!grants(m, module).includes(action)) return false;
  if (a.subject_employee_id === null) return full(user);
  const p = byId(a.subject_employee_id);
  return !!p && keysOf(user).has(p.user_key);
}
const visibleAlerts = (user: string) => ALERTS.filter((a) => grantReaches(user, a));
/** Clear Alert works: the alert is open, the reader holds alerts.clear, and their grant reaches its subject. */
const mayClearAlert = (user: string, a: MockAlert) => a.cleared_at === null && holds(me(user), "alerts.clear") && grantReaches(user, a);
/** The open alerts the reader may clear: Needs You, and the Overview's alerts beside Need You. */
const alertsToClear = (user: string) => ALERTS.filter((a) => mayClearAlert(user, a));

/** "4.00" as a person reads it: 4, "2.50" is 2.5, thousands grouped; read from the digits, as the server does. */
function figureOfWire(value: string): string {
  const [whole, fraction = ""] = value.replace(/^[-+]/, "").split(".");
  const kept = fraction.replace(/0+$/, "");
  return `${value.startsWith("-") ? "-" : ""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${kept ? `.${kept}` : ""}`;
}

/** What an alert's over_by holds, from its rule's metric: past a count's threshold, or a deadline's days left. */
const overByKindOf = (metric: string): HomeAlert["over_by_kind"] => {
  const m = metricOf(metric);
  return m ? (m.kind === "deadline" ? "days_left" : "over") : null;
};

/**
 * Over By as the server words it for the Open High Alerts card (alerts.service overByText), in
 * the Alerts tab's list words: "+1" past a count, "12 days left", Due Today, Expired.
 */
export function overByWords(overBy: string | null, kind: HomeAlert["over_by_kind"]): string | null {
  if (overBy === null) return null;
  if (kind === "days_left") {
    const left = Number(overBy);
    return left < 0 ? "Expired" : left === 0 ? "Due Today" : `${figureOfWire(overBy)} ${left === 1 ? "day" : "days"} left`;
  }
  return kind === "over" ? `+${figureOfWire(overBy)}` : figureOfWire(overBy);
}

function alertOf(a: MockAlert, user: string): HomeAlert {
  const rule = ruleOf(a);
  const metric = metricOf(rule.metric);
  return {
    home_alert_id: a.home_alert_id,
    home_alert_rule_id: a.home_alert_rule_id,
    rule_name: rule.name,
    metric: rule.metric,
    category: metric?.category ?? null,
    subject_type: a.subject_type,
    subject_id: a.subject_id,
    subject_employee_id: a.subject_employee_id,
    title: a.title,
    trigger: a.trigger,
    severity: a.severity,
    over_by: a.over_by,
    over_by_kind: overByKindOf(rule.metric),
    threshold: rule.threshold,
    permission_key: rule.permission_key,
    who_can_clear: grantWords(rule.permission_key),
    raised_at: a.raised_at,
    last_seen_at: a.last_seen_at,
    escalated_at: a.escalated_at,
    cleared_at: a.cleared_at,
    cleared_by: a.cleared_by,
    cleared_by_name: nameOfLogin(a.cleared_by),
    outcome: a.outcome,
    note: a.note,
    link: a.link,
    can_clear: mayClearAlert(user, a),
  };
}

function ruleRowOf(r: MockRule): HomeAlertRule {
  const metric = metricOf(r.metric);
  return {
    ...r,
    category: metric?.category ?? null,
    kind: (metric?.kind ?? null) as HomeAlertRule["kind"],
    who_can_clear: grantWords(r.permission_key),
    open_alerts: ALERTS.filter((a) => a.home_alert_rule_id === r.home_alert_rule_id && a.cleared_at === null).length,
  };
}

/**
 * A body the contract refuses, as the API answers it (src/shared/http/validate.js): 422 with
 * each field's first message, keyed by its dotted path ("schedule.recipient_user_ids"), and a
 * key the contract does not know named on its own.
 */
function refused422(issues: Array<{ path: PropertyKey[]; message: string; code?: string; keys?: string[] }>) {
  const fields: Record<string, string[]> = {};
  for (const issue of issues) {
    const at = issue.path.map(String).join(".");
    if (issue.code === "unrecognized_keys") for (const k of issue.keys ?? []) fields[at ? `${at}.${k}` : k] ??= ["is not allowed"];
    else fields[at || "_"] ??= [issue.message];
  }
  return invalid(fields);
}

/** The start of this week, Monday, Lagos. */
function mondayOf(now = new Date()): number {
  const today = Date.parse(todayIso(now));
  const weekday = (new Date(today).getUTCDay() + 6) % 7;
  return today - weekday * DAY_MS;
}

/* ------------------------------------------------------------------ *
 * Reports, in the contract's shapes (packages/contract/schemas/reports.js)
 * ------------------------------------------------------------------ */

type ReportSource = HomeReport["report_key"];
type ReportFormat = HomeReportRun["format"];

/** A report's schedule as the mock keeps it: its recipients by their roster keys. */
interface MockSchedule {
  report_schedule_id: string;
  recurrence: HomeReportRecurrence;
  starts_on: string;
  run_time: string;
  formats: ReportFormat[];
  recipients: string[];
  active: boolean;
  last_run_at: string | null;
}

/** A report as the mock keeps it: its owner by their roster key, so who sees it reads from the roster. */
interface MockReport {
  saved_report_id: string;
  owner: string;
  name: string;
  report_key: ReportSource;
  filters: HomeReportFilters;
  shared: boolean;
  schedule: MockSchedule | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One file. A run made on this laptop is generated a few seconds after it is asked for, as
 * the outbox would make it (`settles_at`); the seeded runs keep the state they were given.
 */
interface MockRun extends Omit<HomeReportRun, "report_name" | "report_key" | "recipient_user_id" | "recipient_name" | "requested_by"> {
  recipient: string;
  requested_by: string | null;
  settles_at: number | null;
}

/** How long a run asked for here stays Pending before its file is there. */
const SETTLE_MS = 4_000;

/** RPT-0001 onwards, never reset; the seeded history starts the laptop's numbers at RPT-0201. */
let lastRunNumber = 200;
const nextRunNumber = () => `RPT-${String(++lastRunNumber).padStart(4, "0")}`;

/** The person a login names, whether it came from a people list (loginOf) or is the reader's own from /me. */
const keyOfLogin = (userId: string) => PEOPLE.find((p) => loginOf(p.user_key) === userId || me(p.user_key).user_id === userId)?.user_key ?? null;

/** A source as the contract declares it: the module whose grant opens it, and the filters it takes. */
const sourceOf = (key: string) => (reportsContract.HOME_REPORT_SOURCES as Record<string, { module: string; filters: readonly string[] }>)[key];

interface ReportSeed {
  name: string;
  owner: string;
  source: ReportSource;
  filters?: HomeReportFilters;
  shared: boolean;
  /** Days ago it was made. */
  made: number;
  schedule?: { recurrence: HomeReportRecurrence; time: string; formats: ReportFormat[]; to: string[]; active?: boolean };
  /** Days ago it was archived. */
  archived?: number;
}

/**
 * Reports across the sources, scheduled, paused and on demand, shared and private, owned by
 * Operations, the CEO and a Head of Department, and one archived, so a laptop shows every state.
 */
const REPORT_SEEDS: ReportSeed[] = [
  { name: "Daily Attendance", owner: "cynthia", source: "daily_attendance", shared: true, made: 60, schedule: { recurrence: { freq: "daily", working_days_only: true }, time: "18:00", formats: ["pdf"], to: ["cynthia", "ifeoma", "damilola"] } },
  { name: "Late Arrivals", owner: "cynthia", source: "daily_attendance", filters: { roster_status: "late" }, shared: false, made: 40, schedule: { recurrence: { freq: "weekly", by_weekday: [1] }, time: "09:30", formats: ["xlsx"], to: ["cynthia"] } },
  { name: "Leave This Month", owner: "cynthia", source: "leave", filters: { leave_status: "approved" }, shared: true, made: 90, schedule: { recurrence: { freq: "monthly", by_month_day: 1 }, time: "08:00", formats: ["pdf", "xlsx"], to: ["cynthia", "ngozi", "musa"] } },
  { name: "Open High Alerts", owner: "ifeoma", source: "open_alerts", filters: { severity: "high" }, shared: true, made: 30, schedule: { recurrence: { freq: "weekly", by_weekday: [1] }, time: "07:45", formats: ["pdf"], to: ["ifeoma", "cynthia"], active: false } },
  { name: "Headcount by Department", owner: "cynthia", source: "headcount", shared: true, made: 20 },
  { name: "Partnership Pipeline", owner: "ngozi", source: "partnerships", shared: true, made: 50, schedule: { recurrence: { freq: "weekly", by_weekday: [5] }, time: "16:00", formats: ["pdf", "xlsx"], to: ["ngozi", "ifeoma", "bashir"] } },
  { name: "Monthly Expenses", owner: "ifeoma", source: "expenses", shared: false, made: 120, schedule: { recurrence: { freq: "monthly", by_month_day: -1, working_days_only: true }, time: "17:00", formats: ["xlsx"], to: ["ifeoma", "amara"] } },
  { name: "Open Tasks", owner: "cynthia", source: "tasks", shared: false, made: 10 },
  { name: "Recruitment Pipeline", owner: "cynthia", source: "recruitment", shared: true, made: 70, schedule: { recurrence: { freq: "weekly", by_weekday: [4] }, time: "10:00", formats: ["pdf"], to: ["cynthia"], active: false } },
  { name: "Studio Hours", owner: "cynthia", source: "daily_attendance", filters: { department_id: departmentId("Studio") }, shared: false, made: 100, archived: 12, schedule: { recurrence: { freq: "weekly", by_weekday: [5] }, time: "17:00", formats: ["pdf"], to: ["cynthia"], active: false } },
];

const REPORTS: MockReport[] = REPORT_SEEDS.map((s) => {
  const id = sid(`report:${s.name}`);
  const made = at(s.made, "10:00");
  return {
    saved_report_id: id,
    owner: s.owner,
    name: s.name,
    report_key: s.source,
    filters: s.filters ?? {},
    shared: s.shared,
    schedule: s.schedule
      ? {
          report_schedule_id: sid(`report-schedule:${s.name}`),
          recurrence: s.schedule.recurrence,
          starts_on: isoDaysAgo(s.made),
          run_time: s.schedule.time,
          formats: s.schedule.formats,
          recipients: s.schedule.to,
          active: s.schedule.active ?? true,
          last_run_at: null,
        }
      : null,
    archived_at: s.archived === undefined ? null : at(s.archived, "11:20"),
    created_at: made,
    updated_at: s.archived === undefined ? made : at(s.archived, "11:20"),
  };
});
const reportNamed = (name: string) => REPORTS.find((r) => r.name === name)!;

const RUNS: MockRun[] = [];

/** A seeded file of a scheduled report: its slot, one recipient, one format, in the state it ended in. */
function seedRun(name: string, daysAgo: number, recipient: string, format: ReportFormat, status: Exclude<HomeReportRun["status"], "pending">) {
  const report = reportNamed(name);
  const schedule = report.schedule!;
  const slot = at(daysAgo, schedule.run_time);
  const finished = new Date(Date.parse(slot) + 90_000).toISOString();
  const number = nextRunNumber();
  RUNS.push({
    home_report_run_id: sid(`report-run:${number}`),
    number,
    saved_report_id: report.saved_report_id,
    report_schedule_id: schedule.report_schedule_id,
    scheduled_for: slot,
    recipient,
    requested_by: null,
    format,
    status,
    document_id: status === "done" ? sid(`report-file:${number}`) : null,
    emailed_at: status === "done" ? finished : null,
    run_at: slot,
    finished_at: finished,
    settles_at: null,
  });
  if (!schedule.last_run_at || slot > schedule.last_run_at) schedule.last_run_at = slot;
}

/* Oldest first, so the numbers rise with time; Recent Runs lists them newest first. */
seedRun("Studio Hours", 19, "cynthia", "pdf", "done");
seedRun("Monthly Expenses", 18, "ifeoma", "xlsx", "done");
seedRun("Monthly Expenses", 18, "amara", "xlsx", "done");
for (const [recipient, format, status] of [
  ["cynthia", "pdf", "done"],
  ["cynthia", "xlsx", "done"],
  ["ngozi", "pdf", "done"],
  ["ngozi", "xlsx", "done"],
  // Suspended since the schedule was saved: no file and no email for her.
  ["musa", "pdf", "skipped"],
  ["musa", "xlsx", "skipped"],
] as const)
  seedRun("Leave This Month", 17, recipient, format, status);
seedRun("Open High Alerts", 7, "ifeoma", "pdf", "done");
seedRun("Open High Alerts", 7, "cynthia", "pdf", "failed");
for (let day = 8; day >= 1; day -= 1) {
  for (const recipient of ["cynthia", "ifeoma", "damilola"]) seedRun("Daily Attendance", day, recipient, "pdf", day === 1 && recipient === "damilola" ? "failed" : "done");
  if (day === 3) for (const recipient of ["ngozi", "ifeoma", "bashir"]) for (const format of ["pdf", "xlsx"] as const) seedRun("Partnership Pipeline", day, recipient, format, "done");
  if (day === 1) seedRun("Late Arrivals", day, "cynthia", "xlsx", "done");
}

/* Two files asked for by hand: Headcount, done three hours ago, and Open Tasks, still being made. */
const ASKED: Array<[name: string, recipient: string, format: ReportFormat, at: string, status: HomeReportRun["status"]]> = [
  ["Headcount by Department", "cynthia", "pdf", new Date(Date.now() - 3 * 3_600_000).toISOString(), "done"],
  ["Open Tasks", "cynthia", "xlsx", new Date(Date.now() - 60_000).toISOString(), "pending"],
];
for (const [name, recipient, format, runAt, status] of ASKED) {
  const number = nextRunNumber();
  const done = status === "done";
  RUNS.push({
    home_report_run_id: sid(`report-run:${number}`),
    number,
    saved_report_id: reportNamed(name).saved_report_id,
    report_schedule_id: null,
    scheduled_for: null,
    recipient,
    requested_by: recipient,
    format,
    status,
    document_id: done ? sid(`report-file:${number}`) : null,
    emailed_at: done ? runAt : null,
    run_at: runAt,
    finished_at: done ? runAt : null,
    settles_at: null,
  });
}

/** A run asked for here becomes its file once the outbox would have made it. */
function settle(run: MockRun) {
  if (run.status !== "pending" || run.settles_at === null || Date.now() < run.settles_at) return;
  const now = new Date().toISOString();
  Object.assign(run, { status: "done", document_id: sid(`report-file:${run.number}`), finished_at: now, emailed_at: now, settles_at: null });
}

/**
 * May a person open a source, as the server reads it (reports.sources.js): its module's `view`
 * grant and, for Open Alerts, one of the capabilities that open the Alerts tab.
 */
const mayOpenSource = (m: Me, key: string) =>
  m.is_ceo || (mayView(m, sourceOf(key).module) && (key !== "open_alerts" || holds(m, "alerts.clear") || holds(m, "alerts.manage")));

/**
 * Who sees a report (home.md §6 Reports): its owner; its recipients and, when it is shared,
 * every holder of `home.reports`, while they may open its source; the CEO sees every one.
 * Archived ones only when asked for.
 */
function mayReadReport(user: string, r: MockReport): boolean {
  const m = me(user);
  return m.is_ceo || r.owner === user || ((r.shared || !!r.schedule?.recipients.includes(user)) && mayOpenSource(m, r.report_key));
}
const mayEditReport = (user: string, r: MockReport) => r.owner === user || me(user).is_ceo;
/** The reports Reports lists: never the Overview Export's own report. */
const listedReports = (user: string) => REPORTS.filter((r) => r.report_key !== "overview" && mayReadReport(user, r));
const statusOfReport = (r: MockReport): HomeReport["status"] => (!r.schedule ? "on_demand" : r.schedule.active ? "scheduled" : "paused");

/** Recent Runs: the files the reader received, and every file of the reports they own; the CEO sees every one. */
function visibleRuns(user: string): MockRun[] {
  const ceo = me(user).is_ceo;
  RUNS.forEach(settle);
  return RUNS.filter((run) => ceo || run.recipient === user || REPORTS.find((r) => r.saved_report_id === run.saved_report_id)?.owner === user);
}

const addDays = (date: string, n: number) => todayIso(new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY_MS));
const daysFrom = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS);
const weekdayOfDate = (date: string) => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
const lastDayOf = (date: string) => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();

/** Does the rule fall on this day? Working days here are Monday to Saturday, as the working week has them. */
function falls(s: MockSchedule, date: string): boolean {
  const r = s.recurrence;
  const every = r.interval ?? 1;
  if (r.working_days_only && weekdayOfDate(date) === 7) return false;
  if (r.freq === "daily") return daysFrom(s.starts_on, date) % every === 0;
  if (r.freq === "weekly") {
    const weeks = Math.floor(daysFrom(addDays(s.starts_on, 1 - weekdayOfDate(s.starts_on)), date) / 7);
    return weeks % every === 0 && (r.by_weekday ?? [weekdayOfDate(s.starts_on)]).includes(weekdayOfDate(date));
  }
  const months = (Number(date.slice(0, 4)) - Number(s.starts_on.slice(0, 4))) * 12 + Number(date.slice(5, 7)) - Number(s.starts_on.slice(5, 7));
  const wanted = r.by_month_day ?? Number(s.starts_on.slice(8, 10));
  const day = wanted === -1 ? lastDayOf(date) : Math.min(wanted, lastDayOf(date));
  return months % every === 0 && Number(date.slice(8, 10)) === day;
}

/** The next slot a running schedule fires at, in Lagos; none while it is paused. */
function nextRunOf(s: MockSchedule): string | null {
  if (!s.active) return null;
  const today = todayIso();
  for (let d = s.starts_on > today ? s.starts_on : today, n = 0; n < 400; d = addDays(d, 1), n += 1) {
    const slot = new Date(`${d}T${s.run_time}:00+01:00`).toISOString();
    if (slot > new Date().toISOString() && falls(s, d)) return slot;
  }
  return null;
}

const recipientOf = (key: string): HomeReportRecipient => ({ user_id: loginOf(key), display_name: staff(key).display_name, email: staff(key).work_email });

function reportOf(r: MockReport, user: string): HomeReport {
  const s = r.schedule;
  return {
    saved_report_id: r.saved_report_id,
    name: r.name,
    report_key: r.report_key,
    filters: r.filters,
    shared: r.shared,
    owner_user_id: loginOf(r.owner),
    owner_name: staff(r.owner).display_name,
    status: statusOfReport(r),
    schedule: s && {
      report_schedule_id: s.report_schedule_id,
      recurrence: s.recurrence,
      starts_on: s.starts_on,
      run_time: s.run_time,
      formats: s.formats,
      audience: s.recipients.map(recipientOf),
      active: s.active,
      last_run_at: s.last_run_at,
      next_run_at: nextRunOf(s),
    },
    can_edit: mayEditReport(user, r),
    archived_at: r.archived_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function runOf(run: MockRun): HomeReportRun {
  const { recipient, requested_by, settles_at: _settles, ...rest } = run;
  const report = REPORTS.find((r) => r.saved_report_id === run.saved_report_id)!;
  return {
    ...rest,
    report_name: report.name,
    report_key: report.report_key,
    recipient_user_id: loginOf(recipient),
    recipient_name: staff(recipient).display_name,
    requested_by: requested_by && loginOf(requested_by),
  };
}

/** The same Idempotency-Key from the same person is the same run, never a second file. */
const RUN_REPLAYS = new Map<string, MockRun>();

/** A run answered while its file is still being made: 202, as the API answers Run Now and Export. */
const queued = (run: HomeReportRun) => ({ status: 202, body: run });

/**
 * Run Now and Export: one file for the caller, in the format they chose, answered while it is
 * still being made. Pressed again while that file waits (or with the same Idempotency-Key), it
 * answers the same run.
 */
function runFor(report: MockReport, user: string, format: ReportFormat, key: string | undefined): HomeReportRun {
  RUNS.forEach(settle);
  const replay =
    (key ? RUN_REPLAYS.get(`${user}:${key}`) : undefined) ??
    RUNS.find((r) => r.saved_report_id === report.saved_report_id && r.report_schedule_id === null && r.recipient === user && r.format === format && r.status === "pending");
  if (replay) return runOf(replay);
  const number = nextRunNumber();
  const run: MockRun = {
    home_report_run_id: sid(`report-run:${number}:${Date.now()}`),
    number,
    saved_report_id: report.saved_report_id,
    report_schedule_id: null,
    scheduled_for: null,
    recipient: user,
    requested_by: user,
    format,
    status: "pending",
    document_id: null,
    emailed_at: null,
    run_at: new Date().toISOString(),
    finished_at: null,
    settles_at: Date.now() + SETTLE_MS,
  };
  RUNS.push(run);
  if (key) RUN_REPLAYS.set(`${user}:${key}`, run);
  return runOf(run);
}

/** The reader's own Overview, as a report the Export runs: made the first time they export, never listed. */
function overviewReportOf(user: string): MockReport {
  const found = REPORTS.find((r) => r.report_key === "overview" && r.owner === user);
  if (found) return found;
  const now = new Date().toISOString();
  const made: MockReport = { saved_report_id: sid(`report:overview:${user}`), owner: user, name: "Overview", report_key: "overview", filters: {}, shared: false, schedule: null, archived_at: null, created_at: now, updated_at: now };
  REPORTS.push(made);
  return made;
}

/**
 * May this login receive a report of the source: someone on the roster, not suspended, who holds
 * `home.reports` and may open the source. The people who sign in on this laptop are held to their
 * own grants; the rest of the roster has no account here, and stands for the managers the real
 * roles give them to. Musa, suspended since Leave This Month was scheduled, may not.
 */
function mayReceive(userId: string, source: string): boolean {
  const key = keyOfLogin(userId);
  if (key === null || staff(key).status === "suspended") return false;
  if (!SIGN_INS[key]) return true;
  const m = me(key);
  return holds(m, "home.reports") && mayOpenSource(m, source);
}

/**
 * What the service holds a report to beyond its contract: a source the owner may open, a name
 * they have not used, filters its source takes, and recipients who may receive it. A recipient
 * the saved schedule already goes to (`kept`) is not asked again; each one refused is named.
 */
function reportProblems(
  user: string,
  report: Pick<MockReport, "name" | "report_key" | "filters" | "saved_report_id">,
  recipientIds: string[] | null,
  kept: readonly string[] = [],
): Record<string, string[]> | null {
  const fields: Record<string, string[]> = {};
  if (!mayOpenSource(me(user), report.report_key)) fields.report_key = ["Not open to you"];
  if (REPORTS.some((r) => r.owner === user && r.saved_report_id !== report.saved_report_id && r.name.toLowerCase() === report.name.toLowerCase())) fields.name = ["Name already used"];
  const takes: readonly string[] = sourceOf(report.report_key).filters;
  for (const [key, value] of Object.entries(report.filters)) if (value !== undefined && !takes.includes(key)) fields[`filters.${key}`] = ["Not for this source"];
  const refused = (recipientIds ?? []).filter((id) => !kept.includes(id) && !mayReceive(id, report.report_key));
  if (refused.length) {
    fields["schedule.recipient_user_ids"] = refused.map((id) => {
      const key = keyOfLogin(id);
      return key === null ? "Cannot receive this report" : `${staff(key).display_name}: no access`;
    });
  }
  return Object.keys(fields).length ? fields : null;
}

/** A schedule as the form sends it, kept running or paused as it was (a new one runs). */
function scheduleFrom(save: HomeReportScheduleSave, was: MockSchedule | null, reportId: string): MockSchedule {
  return {
    report_schedule_id: was?.report_schedule_id ?? sid(`report-schedule:${reportId}`),
    recurrence: save.recurrence,
    starts_on: save.starts_on,
    run_time: save.run_time,
    formats: save.formats,
    recipients: save.recipient_user_ids.map((id) => keyOfLogin(id)!),
    active: was?.active ?? true,
    last_run_at: was?.last_run_at ?? null,
  };
}

/** A report the reader may see, by id: archived ones too, since a link may name one. */
const readableReport = (user: string, id: string) => REPORTS.find((r) => r.saved_report_id === id && r.report_key !== "overview" && mayReadReport(user, r));
const archivedRefusal = () => fail(409, "REPORT_ARCHIVED", "This report is archived");
const notYours = () => fail(403, "PERMISSION_DENIED", "Only its owner or the CEO can change it");

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */
route("GET /api/v1/home/overview", (req) => ok(overviewOf(req.user!)));

route("GET /api/v1/home/kpi-picker", (req) => ok(pickerOf(req.user!)));
route("PUT /api/v1/home/kpi-picks", (req) => {
  const ids = (req.body as { kpi_ids?: unknown }).kpi_ids;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) return invalid({ kpi_ids: ["Required"] });
  if (ids.length > MAX_CARDS) return invalid({ kpi_ids: [`Up to ${MAX_CARDS} cards`] });
  if (new Set(ids).size !== ids.length) return invalid({ kpi_ids: ["Each card once"] });
  const c = choiceOf(req.user!);
  if (ids.some((id) => !pickable(id, c.eligible))) return fail(422, "KPI_NOT_AVAILABLE", "Pick cards you can see", { kpi_ids: ["Card not available"] });
  if (c.locked.some((id) => !ids.includes(id))) return fail(422, "KPI_LOCKED", "Locked cards stay on your Home", { kpi_ids: ["Locked cards stay"] });
  // The roles' own cards restated in their order follow the roles, so a later change to the role reaches them.
  const followRoles = ids.length === c.fallback.ids.length && ids.every((id, i) => id === c.fallback.ids[i]);
  if (followRoles) PICKS.delete(req.user!);
  else PICKS.set(req.user!, [...ids]);
  return ok(pickerOf(req.user!));
});
route("DELETE /api/v1/home/kpi-picks", (req) => {
  PICKS.delete(req.user!);
  return noContent();
});

/*
 * A role's cards (GET, PUT and DELETE /home/roles/:role_id/kpis). A role held by a demonstration
 * account is offered the cards its holder may see; any other role (Implementation, System
 * Administrator, Line Manager, one made on Settings) answers as a role with no card it can see,
 * never a 404, as the server answers 200 for every role.
 */
/** The demonstration account holding each role. */
const ROLE_HOLDER: Record<string, string> = { operations_people: "cynthia", management: "ifeoma", head_of_department: "ngozi", employee: "chidera" };
const roleCodeOf = (id: string) => Object.keys(ROLE_HOLDER).find((code) => sid(`role:${code}`) === id) ?? null;
const maySettings = (user: string, action: string) => {
  const m = me(user);
  return m.is_ceo || !!m.grants.settings?.includes(action);
};
const settingsDenied = () => fail(403, "PERMISSION_DENIED", "You do not have access to this");

function roleCardsOf(roleId: string, code: string): HomeRoleKpis {
  const eligible = eligibleFor(ROLE_HOLDER[code]);
  const row = ROLE_CARDS[code];
  const defaults = row ? keepEligible(row.default_ids, eligible).slice(0, MAX_CARDS) : [];
  return {
    role_id: roleId,
    default_ids: defaults,
    locked_ids: row ? keepEligible(row.locked_ids, eligible).filter((id) => defaults.includes(id)) : [],
    configured: !!row,
    view_default_ids: keepEligible(VIEW_DEFAULTS[me(ROLE_HOLDER[code]).home_view] ?? [], eligible).slice(0, MAX_CARDS),
    cards: CARDS.filter((card) => pickable(card.key, eligible)).map((card) => ({ key: card.key, title: card.title, domain: card.domain, unit: card.unit })),
  };
}

/** A role no demonstration account holds: nothing configured and no card to offer. */
const noCardsFor = (roleId: string): HomeRoleKpis => ({ role_id: roleId, default_ids: [], locked_ids: [], configured: false, view_default_ids: [], cards: [] });

route("GET /api/v1/home/roles/:role_id/kpis", (req) => {
  if (!maySettings(req.user!, "view")) return settingsDenied();
  const code = roleCodeOf(req.params.role_id);
  return ok(code ? roleCardsOf(req.params.role_id, code) : noCardsFor(req.params.role_id));
});
route("PUT /api/v1/home/roles/:role_id/kpis", (req) => {
  if (!maySettings(req.user!, "edit")) return settingsDenied();
  const code = roleCodeOf(req.params.role_id);
  const listOf = (v: unknown) => (Array.isArray(v) && v.every((id) => typeof id === "string") && v.length <= MAX_CARDS && new Set(v).size === v.length ? (v as string[]) : null);
  const defaults = listOf((req.body as { default_ids?: unknown }).default_ids);
  const locked = listOf((req.body as { locked_ids?: unknown }).locked_ids);
  if (!defaults) return invalid({ default_ids: [`Up to ${MAX_CARDS} cards`] });
  if (!locked || locked.some((id) => !defaults.includes(id))) return invalid({ locked_ids: ["Lock a chosen card"] });
  if (!code) return defaults.length ? fail(422, "KPI_NOT_FOR_ROLE", "Pick cards this role can see", { default_ids: ["Role cannot see it"] }) : ok(noCardsFor(req.params.role_id));
  if (defaults.some((id) => !pickable(id, eligibleFor(ROLE_HOLDER[code])))) return fail(422, "KPI_NOT_FOR_ROLE", "Pick cards this role can see", { default_ids: ["Role cannot see it"] });
  // A role with no default follows its Home view's cards again, as after DELETE.
  if (defaults.length) ROLE_CARDS[code] = { default_ids: [...defaults], locked_ids: [...locked] };
  else delete ROLE_CARDS[code];
  return ok(roleCardsOf(req.params.role_id, code));
});
route("DELETE /api/v1/home/roles/:role_id/kpis", (req) => {
  if (!maySettings(req.user!, "edit")) return settingsDenied();
  const code = roleCodeOf(req.params.role_id);
  if (code) delete ROLE_CARDS[code];
  return noContent();
});

/** A live card the reader may see, or null: an unknown, hidden or unavailable card is the same 404. */
const cardFor = (user: string, key: string) => (eligibleFor(user).has(key) ? (BY_KEY.get(key) ?? null) : null);

route("GET /api/v1/home/kpi/:key/meta", (req) => {
  const card = cardFor(req.user!, req.params.key);
  return card ? ok(metaOf(card, figureOf(card, req.user!))) : notFound();
});
route("GET /api/v1/home/kpi/:key", (req: Req) => {
  const card = cardFor(req.user!, req.params.key);
  if (!card) return notFound();
  if (req.query.group && !(card.records.groups ?? []).some(([value]) => value === req.query.group)) return invalid({ group: ["Not a group of this card"] });
  const res = paged(card.records.rows(req.user!), req, {
    search: (r) => Object.values(r.cells).map((c) => (c?.kind === "text" ? c.text : c?.kind === "person" ? c.person.display_name : "")),
    filters: { group: (r, v) => !!r.groups?.includes(v) },
  });
  const body = res.body as { data?: Rec[] } | undefined;
  if (body?.data) body.data = body.data.map(({ groups: _groups, ...row }) => row);
  return res;
});

/* ------------------------------------------------------------------ *
 * Team: today's roster and each person's month, in the reader's `home` scope
 * ------------------------------------------------------------------ */
const TEAM_CARDS = ["team_present", "team_on_site", "team_remote", "team_flags"];
const ROSTER_STATUSES: readonly string[] = ["on_leave", "late", "on_site", "remote", "field", "absent", "not_in"];

/** The routes check the capability before reading anything, as requireCapability does. */
const withoutTeam = (user: string) => (holds(me(user), "home.team") ? null : fail(403, "CAPABILITY_REQUIRED", "This needs an authority you do not hold"));

const teamRowOf = (r: RosterRow): HomeTeamRow => ({
  employee: refOf(r.person),
  department_id: departmentId(r.person.department),
  status: r.status,
  clock_in_at: r.clock_in_at,
  clock_out_at: r.clock_out_at,
  worksite: r.worksite,
  no_clock_out_yesterday: r.no_clock_out_yesterday,
  // Performance measures KPIs and Tasks counts open tasks from M2: the server sends neither yet.
  kpi_percent: null,
  open_tasks: null,
});

/**
 * This month so far, as My Attendance counts a person's days: a day counts once it is recorded,
 * so today counts once they are in, and today's leave and absence wait for the day-close.
 */
function monthOf(user: string): HomeTeamAttendanceRow[] {
  const first = `${todayIso().slice(0, 7)}-01`;
  return rosterOf(user).map((r) => {
    const days = HISTORY.filter((h) => h.person.user_key === r.person.user_key && h.date >= first);
    const onTime = days.filter((h) => h.clock_in_at && h.status !== "late").length + (r.status === "on_site" || r.status === "remote" ? 1 : 0);
    const late = days.filter((h) => h.status === "late").length + (r.status === "late" ? 1 : 0);
    const absent = days.filter((h) => h.status === "absent").length;
    const onLeave = days.filter((h) => h.status === "leave").length;
    return { employee: refOf(r.person), expected: onTime + late + absent, on_time: onTime, late, absent, on_leave: onLeave };
  });
}

/** People in the server's order: last name, then first name. */
const surnameFirst = (r: { employee: { employee_id: string; display_name: string } }) => {
  const p = byId(r.employee.employee_id);
  return p ? `${p.last_name} ${p.first_name}` : r.employee.display_name;
};
const byName = <R extends { employee: { employee_id: string; display_name: string } }>(a: R, b: R) => surnameFirst(a).localeCompare(surnameFirst(b));
/** Earliest first, and nobody in yet last, as Postgres orders a null going up. */
const byClockIn = (a: HomeTeamRow, b: HomeTeamRow) => {
  if (a.clock_in_at === b.clock_in_at) return 0;
  if (a.clock_in_at === null) return 1;
  if (b.clock_in_at === null) return -1;
  return a.clock_in_at < b.clock_in_at ? -1 : 1;
};

route("GET /api/v1/home/team/summary", (req) => {
  const refused = withoutTeam(req.user!);
  if (refused) return refused;
  const summary: HomeTeamSummary = {
    date: todayIso(),
    scope: full(req.user!) ? "all" : "team",
    cards: TEAM_CARDS.map((key) => {
      const card = BY_KEY.get(key)!;
      return cardOf(card, figureOf(card, req.user!));
    }),
  };
  return ok(summary);
});
route("GET /api/v1/home/team", (req) => {
  const refused = withoutTeam(req.user!);
  if (refused) return refused;
  if (req.query.status && !ROSTER_STATUSES.includes(req.query.status)) return invalid({ status: ["Choose one"] });
  if (req.query.no_clock_out_yesterday && !["true", "false"].includes(req.query.no_clock_out_yesterday)) return invalid({ no_clock_out_yesterday: ["Choose one"] });
  return paged(rosterOf(req.user!).map(teamRowOf), req, {
    search: (r) => [r.employee.display_name, r.employee.job_title],
    filters: {
      department_id: (r, v) => r.department_id === v,
      status: (r, v) => r.status === v,
      no_clock_out_yesterday: (r, v) => String(r.no_clock_out_yesterday) === v,
    },
    sort: {
      display_name: byName,
      department: (a, b) => (a.employee.department ?? "").localeCompare(b.employee.department ?? ""),
      clock_in_at: byClockIn,
    },
  });
});
route("GET /api/v1/home/team/attendance", (req) => {
  const refused = withoutTeam(req.user!);
  if (refused) return refused;
  return paged(monthOf(req.user!), req, {
    search: (r) => [r.employee.display_name, r.employee.job_title],
    filters: { department_id: (r, v) => departmentId(r.employee.department ?? "") === v },
    sort: { display_name: byName, on_time: (a, b) => a.on_time - b.on_time },
  });
});

/* ------------------------------------------------------------------ *
 * Alerts: the counts, the list, one alert, clearing; and the rules
 * ------------------------------------------------------------------ */
const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2 };
const STATES: readonly string[] = ["open", "cleared", "dismissed"];
const ALERT_SORT: Record<string, (a: MockAlert, b: MockAlert) => number> = {
  raised_at: (a, b) => a.raised_at.localeCompare(b.raised_at),
  severity: (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
};

route("GET /api/v1/home/alerts/summary", (req) => {
  const refused = withoutAlerts(req.user!);
  if (refused) return refused;
  const seen = visibleAlerts(req.user!);
  const open = seen.filter((a) => a.cleared_at === null);
  const monday = mondayOf();
  const raisedSince = Date.now() - 30 * DAY_MS;
  const count = <K extends string>(keys: Array<K | null>) => {
    const out = new Map<K, number>();
    for (const k of keys) if (k !== null) out.set(k, (out.get(k) ?? 0) + 1);
    return out;
  };
  const categories = count<string>(open.map((a) => metricOf(ruleOf(a).metric)?.category ?? null));
  const sources = count(seen.filter((a) => Date.parse(a.raised_at) >= raisedSince).map((a) => ruleOf(a).metric));
  const summary: HomeAlertSummary = {
    open: open.length,
    needs_you: open.filter((a) => mayClearAlert(req.user!, a)).length,
    overdue: open.filter((a) => openDays(a) > OVERDUE_DAYS).length,
    cleared_this_week: seen.filter((a) => a.outcome === "cleared" && Date.parse(todayIso(new Date(a.cleared_at!))) >= monday).length,
    categories: alertsContract.HOME_ALERT_CATEGORIES.filter((c) => categories.has(c)).map((category) => ({ category, count: categories.get(category)! })),
    sources: [...sources].map(([metric, n]) => ({ metric, count: n })).sort((a, b) => b.count - a.count || a.metric.localeCompare(b.metric)),
  };
  return ok(summary);
});

route("GET /api/v1/home/alerts", (req) => {
  const refused = withoutAlerts(req.user!);
  if (refused) return refused;
  const user = req.user!;
  if (req.query.state && !STATES.includes(req.query.state)) return invalid({ state: ["Choose one"] });
  // Open alerts unless the state asks for the cleared or the dismissed: open newest first, a closed list most recently closed first.
  const closed = req.query.state === "cleared" || req.query.state === "dismissed";
  const rows = visibleAlerts(user)
    .filter((a) => (req.query.state ? true : a.cleared_at === null))
    .sort((a, b) => (closed ? (b.cleared_at ?? "").localeCompare(a.cleared_at ?? "") : b.raised_at.localeCompare(a.raised_at)));
  const res = paged(rows, req, {
    search: (a) => [a.title, a.trigger],
    filters: {
      category: (a, v) => metricOf(ruleOf(a).metric)?.category === v,
      severity: (a, v) => a.severity === v,
      state: (a, v) => stateOf(a) === v,
      mine: (a, v) => mayClearAlert(user, a) === (v === "true"),
      overdue: (a, v) => (a.cleared_at === null && openDays(a) > OVERDUE_DAYS) === (v === "true"),
      home_alert_rule_id: (a, v) => a.home_alert_rule_id === v,
    },
    // The server's own order is newest first; a sort the person picks replaces it.
    ...(req.query.sort ? { sort: ALERT_SORT } : {}),
  });
  const body = res.body as { data?: MockAlert[] } | undefined;
  if (body?.data) (body as { data: HomeAlert[] }).data = body.data.map((a) => alertOf(a, user));
  return res;
});

route("GET /api/v1/home/alerts/:id", (req) => {
  const refused = withoutAlerts(req.user!);
  if (refused) return refused;
  const a = visibleAlerts(req.user!).find((x) => x.home_alert_id === req.params.id);
  return a ? ok(alertOf(a, req.user!)) : notFound();
});

route("POST /api/v1/home/alerts/:id/clear", (req) => {
  const user = req.user!;
  const refused = withoutCapability(user, "alerts.clear");
  if (refused) return refused;
  const a = visibleAlerts(user).find((x) => x.home_alert_id === req.params.id);
  if (!a) return notFound();
  const body = alertsContract.HomeAlertClear.safeParse(req.body);
  if (!body.success) return refused422(body.error.issues);
  if (!grantReaches(user, a)) return fail(403, "PERMISSION_DENIED", "You cannot clear this alert");
  // Clearing a closed alert answers it as it stands.
  if (a.cleared_at === null) {
    a.cleared_at = new Date().toISOString();
    a.cleared_by = loginOf(user);
    a.outcome = body.data.outcome;
    a.note = body.data.note ?? null;
  }
  return ok(alertOf(a, user));
});

route("GET /api/v1/home/alert-rules", (req) => {
  const refused = withoutCapability(req.user!, "alerts.manage");
  if (refused) return refused;
  return paged(RULES.map(ruleRowOf), req, {
    search: (r) => [r.name, r.key],
    filters: {
      metric: (r, v) => r.metric === v,
      category: (r, v) => r.category === v,
      enabled: (r, v) => String(r.enabled) === v,
    },
    sort: {
      name: (a, b) => a.name.localeCompare(b.name),
      created_at: (a, b) => a.created_at.localeCompare(b.created_at),
    },
  });
});

route("GET /api/v1/home/alert-rules/:id", (req) => {
  const refused = withoutCapability(req.user!, "alerts.manage");
  if (refused) return refused;
  const r = RULES.find((x) => x.home_alert_rule_id === req.params.id);
  return r ? ok(ruleRowOf(r)) : notFound();
});

route("POST /api/v1/home/alert-rules", (req) => {
  const user = req.user!;
  const refused = withoutCapability(user, "alerts.manage");
  if (refused) return refused;
  const body = alertsContract.HomeAlertRuleCreate.safeParse(req.body);
  if (!body.success) return refused422(body.error.issues);
  const b = body.data;
  const now = new Date().toISOString();
  const key = ruleKey(b.metric, b.name, (k) => RULES.some((r) => r.key.toLowerCase() === k));
  const rule: MockRule = {
    home_alert_rule_id: sid(`alert-rule:${key}:${now}`),
    key,
    name: b.name,
    metric: b.metric,
    threshold: b.threshold,
    window_days: b.window_days ?? null,
    severity: b.severity,
    permission_key: b.permission_key,
    enabled: true,
    created_by: loginOf(user),
    updated_by: loginOf(user),
    created_at: now,
    updated_at: now,
  };
  RULES.push(rule);
  return created(ruleRowOf(rule));
});

route("PATCH /api/v1/home/alert-rules/:id", (req) => {
  const user = req.user!;
  const refused = withoutCapability(user, "alerts.manage");
  if (refused) return refused;
  const r = RULES.find((x) => x.home_alert_rule_id === req.params.id);
  if (!r) return notFound();
  const body = alertsContract.HomeAlertRuleUpdate.safeParse(req.body);
  if (!body.success) return refused422(body.error.issues);
  const { enabled, ...change } = body.data;
  const next = { ...r, ...change, window_days: "window_days" in change ? (change.window_days ?? null) : r.window_days };
  // The metric stays, so the change is held to it as a new rule is (a window only where the metric counts over days).
  if (Object.keys(change).length > 0) {
    const fits = alertsContract.HomeAlertRuleCreate.safeParse({ name: next.name, metric: next.metric, threshold: next.threshold, window_days: next.window_days ?? undefined, severity: next.severity, permission_key: next.permission_key });
    if (!fits.success) return refused422(fits.error.issues);
  }
  const now = new Date().toISOString();
  // Switching a rule off dismisses its open alerts as the rule change itself: no person is recorded as closing them.
  if (enabled === false && r.enabled) {
    for (const a of ALERTS.filter((x) => x.home_alert_rule_id === r.home_alert_rule_id && x.cleared_at === null)) {
      Object.assign(a, { cleared_at: now, cleared_by: null, outcome: "dismissed", note: RULE_OFF_NOTE });
    }
  }
  Object.assign(r, next, enabled === undefined ? {} : { enabled }, { updated_by: loginOf(user), updated_at: now });
  return ok(ruleRowOf(r));
});

route("GET /api/v1/home/reports/summary", (req) => {
  const user = req.user!;
  const refused = withoutCapability(user, "home.reports");
  if (refused) return refused;
  const listed = listedReports(user).filter((r) => r.archived_at === null);
  const monthStart = Date.parse(`${todayIso().slice(0, 8)}01T00:00:00+01:00`);
  const scheduled = listed.filter((r) => statusOfReport(r) === "scheduled");
  const summary: HomeReportSummary = {
    scheduled: scheduled.length,
    paused: listed.filter((r) => statusOfReport(r) === "paused").length,
    // The files on the reader's own Recent Runs made since the 1st, Lagos.
    runs_this_month: visibleRuns(user).filter((run) => run.status === "done" && Date.parse(run.run_at) >= monthStart).length,
    recipients: new Set(scheduled.flatMap((r) => r.schedule!.recipients)).size,
  };
  return ok(summary);
});

route("GET /api/v1/home/reports", (req) => {
  const user = req.user!;
  const refused = withoutCapability(user, "home.reports");
  if (refused) return refused;
  const archived = req.query.archived === "true";
  const rows = listedReports(user).filter((r) => (r.archived_at !== null) === archived);
  const res = paged(rows, req, {
    search: (r) => [r.name],
    filters: {
      report_key: (r, v) => r.report_key === v,
      status: (r, v) => statusOfReport(r) === v,
      archived: () => true,
      mine: (r, v) => (r.owner === user || !!r.schedule?.recipients.includes(user)) === (v === "true"),
    },
    sort: {
      name: (a, b) => a.name.localeCompare(b.name),
      created_at: (a, b) => a.created_at.localeCompare(b.created_at),
    },
  });
  const body = res.body as { data?: unknown[] } | undefined;
  if (body?.data) body.data = (body.data as MockReport[]).map((r) => reportOf(r, user));
  return res;
});

route("GET /api/v1/home/reports/:id", (req) => {
  const refused = withoutCapability(req.user!, "home.reports");
  if (refused) return refused;
  const r = readableReport(req.user!, req.params.id);
  return r ? ok(reportOf(r, req.user!)) : notFound();
});

route("POST /api/v1/home/reports", (req) => {
  const user = req.user!;
  const refused = withoutCapability(user, "home.reports");
  if (refused) return refused;
  const body = reportsContract.HomeReportCreate.safeParse(req.body);
  if (!body.success) return refused422(body.error.issues);
  const b = body.data;
  const problems = reportProblems(user, { ...b, saved_report_id: "" }, b.schedule?.recipient_user_ids ?? null);
  if (problems) return invalid(problems);
  const now = new Date().toISOString();
  const id = sid(`report:${user}:${b.name}:${now}`);
  const report: MockReport = {
    saved_report_id: id,
    owner: user,
    name: b.name,
    report_key: b.report_key,
    filters: b.filters,
    shared: b.shared,
    schedule: b.schedule && scheduleFrom(b.schedule, null, id),
    archived_at: null,
    created_at: now,
    updated_at: now,
  };
  REPORTS.push(report);
  return created(reportOf(report, user));
});

route("PATCH /api/v1/home/reports/:id", (req) => {
  const user = req.user!;
  const refused = withoutCapability(user, "home.reports");
  if (refused) return refused;
  const r = readableReport(user, req.params.id);
  if (!r) return notFound();
  if (!mayEditReport(user, r)) return notYours();
  if (r.archived_at) return archivedRefusal();
  const body = reportsContract.HomeReportUpdate.safeParse(req.body);
  if (!body.success) return refused422(body.error.issues);
  const b = body.data;
  const next = { name: b.name ?? r.name, report_key: r.report_key, filters: b.filters ?? r.filters, saved_report_id: r.saved_report_id };
  const kept = (r.schedule?.recipients ?? []).map(loginOf);
  const problems = reportProblems(user, next, b.schedule?.recipient_user_ids ?? null, kept);
  if (problems) return invalid(problems);
  Object.assign(r, { name: next.name, filters: next.filters, updated_at: new Date().toISOString() });
  if (b.shared !== undefined) r.shared = b.shared;
  if (b.schedule !== undefined) r.schedule = b.schedule && scheduleFrom(b.schedule, r.schedule, r.saved_report_id);
  return ok(reportOf(r, user));
});

route("PATCH /api/v1/home/reports/:id/schedule", (req) => {
  const user = req.user!;
  const refused = withoutCapability(user, "home.reports");
  if (refused) return refused;
  const r = readableReport(user, req.params.id);
  if (!r) return notFound();
  if (!mayEditReport(user, r)) return notYours();
  if (r.archived_at) return archivedRefusal();
  const body = reportsContract.HomeReportScheduleState.safeParse(req.body);
  if (!body.success) return refused422(body.error.issues);
  if (!r.schedule) return fail(409, "REPORT_ON_DEMAND", "This report has no schedule to pause");
  r.schedule.active = body.data.active;
  r.updated_at = new Date().toISOString();
  return ok(reportOf(r, user));
});

route("POST /api/v1/home/reports/:id/archive", (req) => {
  const user = req.user!;
  const refused = withoutCapability(user, "home.reports");
  if (refused) return refused;
  const r = readableReport(user, req.params.id);
  if (!r) return notFound();
  if (!mayEditReport(user, r)) return notYours();
  // Archiving stops the schedule and keeps the runs; archiving it again answers it as it is.
  if (!r.archived_at) {
    const now = new Date().toISOString();
    Object.assign(r, { archived_at: now, updated_at: now });
    if (r.schedule) r.schedule.active = false;
  }
  return ok(reportOf(r, user));
});

route("POST /api/v1/home/reports/:id/run", (req) => {
  const user = req.user!;
  const refused = withoutCapability(user, "home.reports");
  if (refused) return refused;
  const r = readableReport(user, req.params.id);
  if (!r) return notFound();
  if (r.archived_at) return archivedRefusal();
  if (!mayOpenSource(me(user), r.report_key)) return fail(403, "REPORT_SOURCE_CLOSED", "You cannot open this report's source");
  const body = reportsContract.HomeReportRunNow.safeParse(req.body);
  if (!body.success) return refused422(body.error.issues);
  // A scheduled report runs in a format its schedule offers; one on demand in either.
  if (r.schedule && !r.schedule.formats.includes(body.data.format)) return invalid({ format: ["Not offered"] });
  return queued(runFor(r, user, body.data.format, req.idempotency_key));
});

route("GET /api/v1/home/report-runs", (req) => {
  const refused = withoutCapability(req.user!, "home.reports");
  if (refused) return refused;
  const rows = visibleRuns(req.user!).sort((a, b) => b.run_at.localeCompare(a.run_at) || b.number.localeCompare(a.number));
  const res = paged(rows, req, {
    filters: {
      saved_report_id: (run, v) => run.saved_report_id === v,
      status: (run, v) => run.status === v,
      format: (run, v) => run.format === v,
    },
    // The server's own order is newest first; a sort the person picks replaces it.
    ...(req.query.sort ? { sort: { run_at: (a: MockRun, b: MockRun) => a.run_at.localeCompare(b.run_at) } } : {}),
  });
  const body = res.body as { data?: unknown[] } | undefined;
  if (body?.data) body.data = (body.data as MockRun[]).map(runOf);
  return res;
});

/* One run on the reader's Recent Runs, however far back, for a link to it (⌘K). */
route("GET /api/v1/home/report-runs/:id", (req) => {
  const refused = withoutCapability(req.user!, "home.reports");
  if (refused) return refused;
  const run = visibleRuns(req.user!).find((r) => r.home_report_run_id === req.params.id);
  return run ? ok(runOf(run)) : notFound();
});

/* The Overview Export: any Home reader, on their own Overview. */
route("POST /api/v1/home/overview/export", (req) => {
  const body = reportsContract.HomeReportRunNow.safeParse(req.body);
  if (!body.success) return refused422(body.error.issues);
  return queued(runFor(overviewReportOf(req.user!), req.user!, body.data.format, req.idempotency_key));
});
