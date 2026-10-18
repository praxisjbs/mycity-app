import type {
  HomeActivityItem,
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
  HomeRoleKpis,
  HomeRosterStatus,
  HomeTeamAttendanceRow,
  HomeTeamRow,
  HomeTeamSummary,
  HomeUpcomingLeave,
  HomeWeekDay,
  Me,
} from "@mycity/contract/contract.gen.ts";
import type { HomeAlert, HomeReport } from "@/api/types/home";
import { formatTime, todayIso } from "@mycity/ui";
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
 * them). Alerts and Reports still answer their INTERIM shapes (@/api/types/home) until their own
 * PRs move them.
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

const present = (r: RosterRow) => r.status === "on_site" || r.status === "remote" || r.status === "late";

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
  ["late", "Late"],
  ["not_in", "Not In"],
  ["on_leave", "On Leave"],
  ["no_clock_out_yesterday", "No Clock-Out Yesterday"],
];
const ROSTER_PILL: Record<HomeRosterStatus, [Tone, string]> = {
  on_site: ["ok", "On Site"],
  remote: ["ok", "Remote"],
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
  const presentCount = (g.on_site ?? 0) + (g.remote ?? 0) + (g.late ?? 0);
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
      columns: [["alert", "Alert"], ["raised", "Raised", { phone: true }], ["over_by", "Over By", { numeric: true, phone: true }]],
      rows: (u) => alertScope(u).filter((a) => a.severity === "high").map((a) => rec(a.home_alert_id, { alert: text(a.title), raised: time(a.raised_at), over_by: number(a.over) }, `/home?tab=alerts&id=${a.home_alert_id}`, a.age_days >= AGED_DAYS ? ["aged"] : [])),
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
    alerts_to_clear: holds(m, "alerts.clear") ? alertScope(user).length : null,
    // The mock keeps one session per tab, so every Overview it answers is the day's first session's.
    prompt_clock_in: t.state === "not_clocked_in" && t.shift.working_day,
  };
}

/* ------------------------------------------------------------------ *
 * Alerts and rules (INTERIM until Home · Alerts is on the real API)
 * ------------------------------------------------------------------ */
type A = [string, string, string, string, string, "low" | "medium" | "high", string, number, string | null];
const A_ROWS: A[] = [
  ["Bashir Lawal, 3 late arrivals in 30 days", "Attendance rule", "Operations", "attendance", "+1 over 3", "high", "late_arrivals", 2, "/people?tab=attendance"],
  ["Emeka Obi, no clock-out yesterday", "Missing Punch", "Operations", "attendance", "1 day open", "medium", "missing_punch", 1, "/people?tab=attendance"],
  ["Seyi Balogun punched from a new device", "Device policy", "Operations", "attendance", "None", "medium", "device", 1, "/people?tab=devices"],
  ["Eko Hotels, no contact in 34 days", "Partnership inactivity", "Ngozi Eze", "partnership", "+4 over 30", "medium", "inactivity", 4, "/partnerships?tab=partners"],
  ["Kano Trade Council, no contact in 52 days", "Partnership inactivity", "Ngozi Eze", "partnership", "+22 over 30", "high", "inactivity", 22, "/partnerships?tab=partners"],
  ["Requisition REQ-0042 with CEO for 6 days", "Approval ageing", "CEO", "approval", "+4 over 2", "high", "approval_ageing", 6, "/expenses?tab=requisitions"],
  ["NDPA certificate expires soon", "Document expiry", "People", "document", "44 days left", "low", "document_expiry", 0, "/people?tab=employees"],
  ["MTN MOU renewal due", "Contract renewal", "Ngozi Eze", "partnership", "90 days notice", "low", "renewal", 0, "/partnerships?tab=contracts-and-mous"],
  ["Chidera Nwosu probation ends soon", "Confirmation due", "People", "people", "11 days left", "medium", "probation", 3, "/people?tab=employees"],
  ["Marketing spend at 92% of budget", "Budget threshold", "Finance", "budget", "+2 over 90", "medium", "budget", 1, "/expenses?tab=budgets"],
  ["October payroll not submitted", "Payroll cycle", "Operations", "payroll", "due today", "medium", "payroll", 0, "/payroll?tab=payroll-runs"],
  ["Adaeze Nnamdi awaiting panel feedback", "Recruitment SLA", "Hiring manager", "recruitment", "+2 over 3", "high", "recruitment_sla", 5, "/recruitment?tab=interviews"],
];
/** A High alert open this many days goes to the CEO (home.md §6). */
const AGED_DAYS = 14;
const ALERTS = A_ROWS.map((a, i) => ({
  home_alert_id: sid(`alert:${i}`),
  title: a[0],
  trigger: a[1],
  who_clears: a[2],
  category: a[3] as HomeAlert["category"],
  over_by: a[4],
  /** How far past its rule, as a number, for the records behind Open High Alerts. */
  over: Number(/^\+?(\d+)/.exec(a[4])?.[1] ?? 0),
  severity: a[5],
  metric: a[6],
  age: a[7] === 0 ? "today" : `${a[7]} day${a[7] === 1 ? "" : "s"}`,
  age_days: a[7],
  raised_at: at(a[7], "09:00"),
  link: a[8],
  cleared: false as boolean,
}));
const RULES = [...new Map(ALERTS.map((a) => [a.metric, a])).values()].map((a, i) => ({
  home_alert_rule_id: sid(`rule:${a.metric}`),
  name: a.trigger,
  metric: a.metric,
  example: a.title,
  threshold: [3, 1, 1, 30, 2, 60, 14, 90, 3, 1, 3][i] ?? 3,
  window_days: 30,
  severity: a.severity,
  enabled: true,
}));
const CATEGORY_LABEL: Record<string, string> = { attendance: "Attendance", partnership: "Partnerships", approval: "Approvals", document: "Documents", people: "People", budget: "Budget", payroll: "Payroll", recruitment: "Recruitment" };
function alertScope(user: string) {
  return (SIGN_INS[user]?.view === "partnerships" ? ALERTS.filter((a) => a.category === "partnership") : ALERTS).filter((a) => !a.cleared);
}

/* ------------------------------------------------------------------ *
 * Reports (INTERIM until Home · Reports is on the real API)
 * ------------------------------------------------------------------ */
const REPORTS = [
  ["Daily Attendance", "Every weekday at 18:00 to Operations and the CEO.", "scheduled", "Operations, CEO", ["operations", "ceo"]],
  ["Weekly Productivity", "Mondays at 08:00. Completion, overdue, workload by team.", "scheduled", "All managers", ["operations", "ceo"]],
  ["Recruitment Pipeline", "Fridays. Stage counts and time at stage per vacancy.", "scheduled", "Hiring managers", ["operations", "ceo"]],
  ["Partnership Pipeline", "Monthly. Stage movement, signed value, lead owner.", "paused", "Partnerships, CEO", ["operations", "ceo", "partnerships"]],
  ["Monthly Expenses", "First working day. By department, project and category.", "scheduled", "Operations, CEO", ["operations", "ceo"]],
  ["Pending Approvals", "Daily at 09:00 to whoever is holding one.", "scheduled", "Approvers", ["operations", "ceo"]],
].map((r, i) => ({ home_report_id: sid(`report:${i}`), name: r[0] as string, cadence: r[1] as string, status: r[2] as HomeReport["status"], audience: r[3] as string, roles: r[4] as string[] }));
const RUNS = [
  ["Daily Attendance", 1, "18:00", "Operations, CEO", "PDF"],
  ["Pending Approvals", 0, "09:00", "4 approvers", "PDF"],
  ["Weekly Productivity", 3, "08:00", "All managers", "PDF, XLSX"],
  ["Recruitment Pipeline", 6, "17:00", "Hiring managers", "PDF"],
  ["Monthly Expenses", 13, "09:12", "Operations, CEO", "XLSX"],
].map((r, i) => ({ run_id: sid(`run:${i}`), number: `RPT-${String(214 - i).padStart(4, "0")}`, report: r[0] as string, run_at: at(r[1] as number, r[2] as string), recipients: r[3] as string, formats: r[4] as string }));
const reportScope = (user: string) => REPORTS.filter((r) => r.roles.includes(SIGN_INS[user]?.view ?? "staff") || (SIGN_INS[user] == null && teamOf(user).length > 0 && r.roles.includes("operations")));

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
const ROSTER_STATUSES: readonly string[] = ["on_leave", "late", "on_site", "remote", "absent", "not_in"];

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

route("GET /api/v1/home/alerts/summary", (req) => {
  const l = alertScope(req.user!);
  const cats = [...new Set(l.map((a) => a.category))];
  return ok({
    kpis: [
      { key: "alerts_open", label: "Open Alerts", value: String(l.length) },
      { key: "alerts_needs", label: "Needs You", value: String(l.filter((a) => a.who_clears === "Operations" || a.who_clears === "People").length), tone: "warn" },
      { key: "alerts_overdue", label: "Overdue 7 Days +", value: String(l.filter((a) => a.age_days > 7).length), tone: "err" },
      { key: "alerts_cleared", label: "Cleared This Week", value: String(9 + ALERTS.filter((a) => a.cleared).length), tone: "ok" },
    ],
    sources: [["Attendance rules", 100, "18"], ["Partnership inactivity", 55, "10"], ["Approval ageing", 39, "7"], ["Document expiry", 33, "6"], ["Recruitment SLA", 22, "4"], ["Budget threshold", 11, "2"]].map(([label, pct, value]) => ({ label: label as string, pct: pct as number, value: value as string })),
    categories: cats.map((c) => ({ value: c, label: CATEGORY_LABEL[c], count: l.filter((a) => a.category === c).length })),
  });
});
route("GET /api/v1/home/alerts", (req) =>
  paged(
    alertScope(req.user!).map((a) => ({ home_alert_id: a.home_alert_id, title: a.title, trigger: a.trigger, category: a.category, who_clears: a.who_clears, age: a.age, over_by: a.over_by, severity: a.severity, raised_at: a.raised_at, link: a.link })),
    req,
    { search: (r) => [r.title, r.trigger], filters: { category: (r, v) => r.category === v } },
  ),
);
route("POST /api/v1/home/alerts/:id/clear", (req) => {
  const a = ALERTS.find((x) => x.home_alert_id === req.params.id);
  if (!a) return notFound();
  a.cleared = true;
  return ok(a);
});
route("GET /api/v1/home/alert-rules", (req) => paged(RULES, req, { search: (r) => [r.name, r.example] }));
route("POST /api/v1/home/alert-rules", (req) => {
  const b = req.body as { name: string; metric: string; threshold: number; window_days: number; severity: "low" };
  const rule = { home_alert_rule_id: sid(`rule:${b.name}:${Date.now()}`), name: b.name, metric: b.metric, example: `For example: ${b.name}`, threshold: b.threshold, window_days: b.window_days, severity: b.severity, enabled: true };
  RULES.push(rule);
  return created(rule);
});
route("PATCH /api/v1/home/alert-rules/:id", (req) => {
  const r = RULES.find((x) => x.home_alert_rule_id === req.params.id);
  if (!r) return notFound();
  Object.assign(r, req.body);
  return ok(r);
});

route("GET /api/v1/home/reports/summary", (req) => {
  const l = reportScope(req.user!);
  return ok({
    kpis: [
      { key: "rp_sched", label: "Scheduled", value: String(l.filter((r) => r.status === "scheduled").length) },
      { key: "rp_paused", label: "Paused", value: String(l.filter((r) => r.status === "paused").length), tone: "warn" },
      { key: "rp_runs", label: "Runs This Month", value: "38" },
      { key: "rp_recip", label: "Recipients", value: "11" },
    ],
  });
});
route("GET /api/v1/home/reports", (req) => paged(reportScope(req.user!).map((r) => ({ home_report_id: r.home_report_id, name: r.name, cadence: r.cadence, status: r.status, audience: r.audience })), req, { search: (r) => [r.name] }));
route("POST /api/v1/home/reports", (req) => {
  const b = req.body as { name: string; schedule: string; recipients: string };
  const r = { home_report_id: sid(`report:${b.name}`), name: b.name, cadence: b.schedule, status: "scheduled" as const, audience: b.recipients, roles: ["operations", "ceo", "partnerships"] };
  REPORTS.unshift(r);
  return created(r);
});
route("POST /api/v1/home/reports/:id/run", (req) => {
  const r = REPORTS.find((x) => x.home_report_id === req.params.id);
  if (!r) return notFound();
  const run = { run_id: sid(`run:${Date.now()}`), number: `RPT-${String(215 + RUNS.length).padStart(4, "0")}`, report: r.name, run_at: new Date().toISOString(), recipients: "You", formats: String(req.body.format).toUpperCase() };
  RUNS.unshift(run);
  return ok(run);
});
route("GET /api/v1/home/report-runs", (req) => paged(RUNS, req, { search: (r) => [r.report, r.number] }));
