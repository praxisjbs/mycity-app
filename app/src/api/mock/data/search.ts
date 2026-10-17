import type { SearchGroup, SearchHit, SearchResult } from "@mycity/contract/contract.gen.ts";
import { MODULES } from "@/shell/catalogue";
import type { MockPerson } from "./people";

/**
 * Stands in for GET /search (src/shared/search) on laptops and in CI: the screens a
 * person's grants open, the actions most screens offer, and people by name, in the
 * contract's groups of 25. The server's catalogues (synonyms, every action, every
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
  { hit: hit({ id: "add_employee", kind: "action", type: "action", title: "Add Employee", sub: "Employees", link: "/people?tab=employees&action=new" }), need: ["people", "create"], words: "new staff hire" },
  { hit: hit({ id: "invite_user", kind: "action", type: "action", title: "Invite User", sub: "Users", link: "/settings?tab=users&action=new" }), need: ["settings", "create"], words: "invite login" },
  { hit: hit({ id: "start_import", kind: "action", type: "action", title: "Start Import", sub: "Imports", link: "/settings?tab=imports&action=new" }), need: ["settings", "view"], words: "import upload spreadsheet" },
];

function group(kind: SearchGroup["kind"], type: string, label: string, items: SearchHit[], page: number): SearchGroup | null {
  const pages = Math.ceil(items.length / SIZE);
  const data = items.slice((page - 1) * SIZE, page * SIZE);
  if (!data.length) return null;
  return { kind, type, label, module: kind === "record" ? "people" : null, page: { number: page, size: SIZE as SearchGroup["page"]["size"], total: items.length, pages, has_next: page < pages }, items: data };
}

export function searchResult(people: MockPerson[], grants: Record<string, string[]>, q: string, type: string | null, page: number): SearchResult {
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
  const groups = [
    !type || type === "screen" ? group("screen", "screen", "Screens", screens, page) : null,
    !type || type === "action" ? group("action", "action", "Actions", actions, page) : null,
    !type || type === "employee" ? group("record", "employee", "Employees", staff, page) : null,
  ].filter((g): g is SearchGroup => g !== null);
  return { q: q.trim(), hint: null, groups };
}
