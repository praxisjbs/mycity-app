import type { AttendanceDay, SearchGroup, SearchHit, SearchResult } from "@mycity/contract/contract.gen.ts";
import { formatDate } from "@mycity/ui";
import { MODULES } from "@/shell/catalogue";
import type { MockPerson } from "./people";

/** One person's attendance day, as ⌘K finds it by their name (src/modules/attendance/attendance.search.js). */
export interface SearchDay {
  person: MockPerson;
  attendance_day_id: string;
  attendance_date: string;
  status: AttendanceDay["status"];
}

/** A day's status in the words the attendance screens show (features/attendance/labels.ts). */
const DAY_STATUS: Record<string, string> = { present: "Present", late: "Late", absent: "Absent", leave: "On Leave" };
/** Days listed at most, newest first, after the person (the provider's `cap`). */
const DAYS_LISTED = 3;

/**
 * Stands in for GET /search (src/shared/search) on laptops and in CI: the screens a
 * person's grants open, the actions most screens offer, people by name and then at most
 * three of their attendance days, newest first, each with its status and date, ending with
 * All Days of each person listed (the provider's `more`), in the contract's groups of 25. The server's catalogues (synonyms, every action, every
 * module's records) are the real thing; this only draws the palette.
 */
const SIZE = __CONTRACT_PAGE_SIZE__;
const fold = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ");

const hit = (h: Partial<SearchHit> & Pick<SearchHit, "id" | "kind" | "type" | "title">): SearchHit => ({ sub: null, ref: null, status: null, link: null, run: null, ...h });

const ACTIONS: Array<{ hit: SearchHit; need: [string, string] | null; words: string }> = [
  { hit: hit({ id: "request_leave", kind: "action", type: "action", title: "Request Leave", sub: "My Leave", link: "/ess?tab=my-leave&action=new" }), need: ["ess", "create"], words: "holiday vacation time off" },
  { hit: hit({ id: "clock_in", kind: "action", type: "action", title: "Clock In", sub: "My Attendance", link: "/ess?tab=my-attendance", run: "clock" }), need: ["ess", "view"], words: "clock out punch" },
  { hit: hit({ id: "change_password", kind: "action", type: "action", title: "Change Password", sub: "My Security", link: "/ess?tab=my-security&action=password" }), need: ["ess", "view"], words: "password" },
  { hit: hit({ id: "set_pin", kind: "action", type: "action", title: "Set PIN", sub: "My Security", link: "/ess?tab=my-security&action=pin" }), need: ["ess", "view"], words: "pin" },
  { hit: hit({ id: "mark_all_read", kind: "action", type: "action", title: "Mark All Read", run: "read_all" }), need: null, words: "notifications bell" },
  { hit: hit({ id: "notification_settings", kind: "action", type: "action", title: "Notification Settings", run: "notify_settings" }), need: null, words: "notifications push mute sound" },
  { hit: hit({ id: "turn_on_notifications", kind: "action", type: "action", title: "Turn On Notifications", run: "notify_on" }), need: null, words: "push phone enable allow" },
  { hit: hit({ id: "send_test_notification", kind: "action", type: "action", title: "Send Test Notification", run: "notify_test" }), need: null, words: "test push check" },
  { hit: hit({ id: "add_employee", kind: "action", type: "action", title: "Add Employee", sub: "Employees", link: "/people?tab=employees&action=new" }), need: ["people", "create"], words: "new staff hire" },
  { hit: hit({ id: "invite_user", kind: "action", type: "action", title: "Invite User", sub: "Users", link: "/settings?tab=users&action=new" }), need: ["settings", "create"], words: "invite login" },
  { hit: hit({ id: "start_import", kind: "action", type: "action", title: "Start Import", sub: "Imports", link: "/settings?tab=imports&action=new" }), need: ["settings", "view"], words: "import upload spreadsheet" },
  { hit: hit({ id: "theme_dark", kind: "action", type: "action", title: "Use Dark Theme", run: "theme_dark" }), need: null, words: "dark mode night" },
  { hit: hit({ id: "theme_light", kind: "action", type: "action", title: "Use Light Theme", run: "theme_light" }), need: null, words: "light mode day" },
  { hit: hit({ id: "density", kind: "action", type: "action", title: "Change Density", run: "density" }), need: null, words: "compact comfortable spacing" },
  { hit: hit({ id: "install_app", kind: "action", type: "action", title: "Install App", run: "install" }), need: null, words: "install home screen" },
  { hit: hit({ id: "refresh_screen", kind: "action", type: "action", title: "Refresh Screen", run: "refresh" }), need: null, words: "refresh reload data update latest" },
  { hit: hit({ id: "reload_app", kind: "action", type: "action", title: "Reload App", run: "reload" }), need: null, words: "reload restart hard refresh" },
  { hit: hit({ id: "sign_out", kind: "action", type: "action", title: "Sign Out", run: "sign_out" }), need: null, words: "log out logout" },
];

function group(kind: SearchGroup["kind"], type: string, label: string, items: SearchHit[], page: number): SearchGroup | null {
  const pages = Math.ceil(items.length / SIZE);
  const data = items.slice((page - 1) * SIZE, page * SIZE);
  if (!data.length) return null;
  return { kind, type, label, module: kind === "record" ? "people" : null, page: { number: page, size: SIZE as SearchGroup["page"]["size"], total: items.length, pages, has_next: page < pages }, items: data };
}

export function searchResult(people: MockPerson[], grants: Record<string, string[]>, q: string, type: string | null, page: number, days: SearchDay[] = []): SearchResult {
  const term = fold(q).trim();
  const can = (m: string, a = "view") => (grants[m] ?? []).includes(a);
  const match = (...texts: unknown[]) => !term || texts.some((t) => fold(t).includes(term));
  const screens = MODULES.filter((m) => can(m.key)).flatMap((m) =>
    m.tabs
      .filter((t) => match(t.label, m.label))
      .map((t) => hit({ id: `${m.key}.${t.slug}`, kind: "screen", type: "screen", title: t.label, sub: m.label, link: `/${m.key.replace(/_/g, "-")}?tab=${t.slug}` })),
  );
  const actions = ACTIONS.filter((a) => (!a.need || can(...a.need)) && match(a.hit.title, a.words)).map((a) => a.hit);
  const staff =
    term.length >= 2 && can("people")
      ? people
          .filter((p) => match(p.display_name, p.staff_number, p.job_title))
          .map((p) => hit({ id: p.employee_id, kind: "record", type: "employee", title: p.display_name, ref: p.staff_number, sub: `${p.job_title} · ${p.department}`, link: `/people?tab=employees&id=${p.employee_id}` }))
      : [];
  const listed =
    term.length >= 2 && can("people")
      ? days
          .filter((d) => match(d.person.display_name, `${d.person.first_name} ${d.person.last_name}`))
          .sort((a, b) => b.attendance_date.localeCompare(a.attendance_date))
          .slice(0, DAYS_LISTED)
      : [];
  const named = (d: SearchDay) => `${d.person.first_name} ${d.person.last_name}`;
  const attendance = [
    ...listed.map((d) =>
      hit({
        id: d.attendance_day_id,
        kind: "record",
        type: "attendance_record",
        title: named(d),
        ref: formatDate(d.attendance_date),
        sub: `${(d.status && DAY_STATUS[d.status]) || "Not Counted"} · ${formatDate(d.attendance_date)}`,
        status: d.status,
        link: `/people?tab=attendance&id=${d.attendance_day_id}`,
      }),
    ),
    // The way to the rest: All Days of each person listed, in the order they came.
    ...[...new Map(listed.map((d) => [d.person.employee_id, d] as const)).values()].map((d) =>
      hit({ id: d.person.employee_id, kind: "record", type: "attendance_days", title: `All Days of ${named(d)}`, link: `/people?tab=attendance&person=${d.person.employee_id}` }),
    ),
  ];
  const groups = [
    !type || type === "screen" ? group("screen", "screen", "Screens", screens, page) : null,
    !type || type === "action" ? group("action", "action", "Actions", actions, page) : null,
    !type || type === "employee" ? group("record", "employee", "Employees", staff, page) : null,
    !type || type === "attendance_record" ? group("record", "attendance_record", "Attendance Days", attendance, page) : null,
  ].filter((g): g is SearchGroup => g !== null);
  return { q: q.trim(), hint: null, groups };
}
