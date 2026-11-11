import type {
  Assignment,
  Course,
  CourseRow,
  CourseState,
  EnrolmentRow,
  EnrolmentStatus,
  ItemKind,
  MyCourse,
  MyCourseRow,
  MyItem,
  TrainingItem,
} from "@mycity/contract/contract.gen.ts";
import trainingContract from "@mycity/contract/schemas/training.js";
import { todayIso } from "@mycity/ui";
import { at, created, fail, invalid, isoDaysAgo, isoDaysAhead, notFound, ok, paged, route, sid, uuid, type Req } from "../core";
import { byId, byKey, DEPARTMENTS, PEOPLE, ref, type MockPerson } from "../data/people";
import { UPLOADS } from "../uploads";
import { me } from "./identity";
import { blocksOf } from "./policies";
import { exportFile } from "./shared";

/**
 * Knowledge Hub · Training and ESS · My Training on the mock (docs/guides/knowledge.md §5 to
 * §6.11), in the contract's shapes (packages/contract/schemas/training.js): courses with their
 * items, settings, signature and counts; assignments to everyone, departments, roles or people;
 * everyone's place on a course; and the signed-in person's own lists, items and proof.
 *
 * Cynthia (Operations, the crawl's account) builds courses and has one of each of her own: Fire
 * Safety to do, Data Protection under way, the Platform Walkthrough completed with its certificate,
 * Customer Service open in the Library. Support and Marketing & Sales are overdue on Customer
 * Service. A lesson is kept as the editor's HTML and read as blocks (policies.ts blocksOf).
 */

type MockItem = TrainingItem;
type MockCourse = Omit<Course, "items" | "minutes" | "counts"> & { items: MockItem[]; updated_at: string };
type MockAssignment = {
  id: string;
  course_id: string;
  everyone: boolean;
  department_ids: string[];
  role_ids: string[];
  employee_ids: string[];
  due_within_days: number | null;
  keep_assigning: boolean;
  withdrawn_at: string | null;
  created_at: string;
  created_by: string;
};
type MockEnrolment = {
  id: string;
  course_id: string;
  employee_id: string;
  assignment_id: string | null;
  due_on: string | null;
  started_at: string | null;
  completed_at: string | null;
  proof_url: string | null;
  proof_document_id: string | null;
  proof_document_name: string | null;
  certificate_number: string | null;
  certificate_ready: boolean;
  /** Item id to when it was done. */
  done: Record<string, string>;
  reminded_on: string | null;
};

/** The roles an assignment may name, as Settings · Roles & Permissions lists them (settings.ts). */
const ROLES: Record<string, string> = Object.fromEntries(
  [
    ["implementation", "Implementation Team"],
    ["operations_people", "Operations & People"],
    ["management", "Management"],
    ["head_of_department", "Head of Department"],
    ["administrator", "System Administrator"],
    ["manager", "Line Manager"],
    ["employee", "Staff"],
  ].map(([code, name]) => [sid(`role:${code}`), name]),
);
const DEPT_NAME: Record<string, string> = Object.fromEntries(DEPARTMENTS.map((name) => [sid(`dept:${name}`), name]));

const PDF = "application/pdf";
const MP4 = "video/mp4";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

let itemSeq = 0;
function item(courseKey: string, kind: ItemKind, title: string, minutes: number | null, x: { url?: string; file?: [string, string]; html?: string } = {}): MockItem {
  itemSeq += 1;
  const html = kind === "lesson" ? (x.html ?? "") : null;
  return {
    training_item_id: sid(`training-item:${courseKey}:${itemSeq}`),
    position: 0,
    kind,
    title,
    url: x.url ?? null,
    youtube_id: kind === "video" && x.url ? youtubeIdOf(x.url) : null,
    document_id: x.file ? sid(`training-doc:${x.file[0]}`) : null,
    document_name: x.file ? x.file[0] : null,
    document_type: x.file ? x.file[1] : null,
    lesson_html: html,
    lesson: html === null ? null : blocksOf(html),
    minutes,
  };
}

/** A YouTube link's video id, as the API reads it (youtube.com/watch, youtu.be, youtube.com/shorts). */
function youtubeIdOf(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m)\./, "");
    const id = host === "youtu.be" ? u.pathname.split("/")[1] : host === "youtube.com" ? (u.pathname === "/watch" ? u.searchParams.get("v") : (/^\/shorts\/([^/]+)/.exec(u.pathname)?.[1] ?? null)) : null;
    return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

const numbered = (items: MockItem[]) => items.map((it, i) => ({ ...it, position: i + 1 }));
const cynthia = byKey("cynthia")!;

function course(n: number, title: string, summary: string, state: CourseState, items: MockItem[], { publishedAgo = 30, ...o }: Partial<MockCourse> & { publishedAgo?: number } = {}): MockCourse {
  const published = state !== "draft" ? at(publishedAgo, "10:15") : null;
  return {
    training_course_id: sid(`training-course:${n}`),
    number: `TRN-${String(n).padStart(4, "0")}`,
    title,
    summary,
    state,
    library: false,
    proof_required: false,
    proof_prompt: null,
    issue_certificate: true,
    items: numbered(items),
    published_at: published,
    published_by_name: published ? cynthia.display_name : null,
    signer_name: published ? cynthia.display_name : null,
    signer_title: published ? cynthia.job_title : null,
    archived_at: null,
    archive_reason: null,
    updated_at: published ?? at(2, "16:40"),
    ...o,
  };
}

const LESSON_RULES =
  "<h2>Why it matters</h2><p>Personal data is anything that names a person: a phone number, an address, a payslip. The NDPA holds MyCity to account for every record.</p><h2>Key Points</h2><ul><li>Lock your screen when you step away.</li><li>Never share a password, even with IT.</li><li>Send personal data only through the hub, never by WhatsApp.</li></ul>";
const LESSON_PROMISE =
  "<h2>Our promise</h2><p>Every partner and member of the public hears back within one working day. If you cannot solve it, you say who will and when.</p><ul><li>Listen first, then repeat the problem back.</li><li>Write it down in the ticket as you go.</li></ul>";
const LESSON_FIRE =
  "<h2>When the alarm sounds</h2><p>Stop work, leave by the nearest marked exit and gather at the assembly point in the car park. Do not use the lift.</p><ul><li>Fire wardens wear yellow vests.</li><li>Report to your warden by name.</li></ul>";
const LESSON_WAY = "<h2>Finding your way</h2><p>Home shows what needs you today. The bottom bar on a phone, and the rail on a computer, lead to every module you may open.</p>";
const LESSON_STAGES = "<h2>Stages and owners</h2><p>A partner moves from Lead to Signed through five stages. Each stage has one owner, who updates it after every meeting.</p>";

const COURSES: MockCourse[] = [
  course(
    1,
    "Data Protection Essentials",
    "What the NDPA asks of everyone at MyCity.",
    "published",
    [
      item("c1", "file", "Staff Data Handbook", 20, { file: ["staff-data-handbook.pdf", PDF] }),
      item("c1", "video", "Why Data Matters", 6, { url: "https://www.youtube.com/watch?v=M7lc1UVf-VE" }),
      item("c1", "lesson", "Key Rules", 10, { html: LESSON_RULES }),
      item("c1", "link", "NDPA in Practice", 45, { url: "https://learn.example.com/ndpa-in-practice" }),
    ],
    { publishedAgo: 21 },
  ),
  course(
    2,
    "Customer Service Basics",
    "How we answer partners and the public.",
    "published",
    [
      item("c2", "link", "Customer Service Fundamentals", 90, { url: "https://learn.example.com/customer-service" }),
      item("c2", "file", "Handling a Complaint", 8, { file: ["handling-a-complaint.mp4", MP4] }),
      item("c2", "lesson", "Our Promise", 5, { html: LESSON_PROMISE }),
    ],
    { publishedAgo: 50, library: true, proof_required: true, proof_prompt: "Paste your certificate link" },
  ),
  course(
    3,
    "Platform Walkthrough",
    "A short tour of the hub.",
    "published",
    [item("c3", "video", "The Hub in Ten Minutes", 10, { url: "https://vimeo.com/76979871" }), item("c3", "lesson", "Finding Your Way", 5, { html: LESSON_WAY })],
    { publishedAgo: 60, library: true },
  ),
  course(
    4,
    "Partnership Pipeline",
    "Stages, owners and what each one updates.",
    "draft",
    [item("c4", "lesson", "Stages and Owners", 10, { html: LESSON_STAGES }), item("c4", "file", "Pipeline Stages", 15, { file: ["pipeline-stages.pptx", PPTX] })],
  ),
  course(5, "Expense Requests 2025", "Last year's expense steps.", "archived", [item("c5", "lesson", "Raising a Request", 5, { html: LESSON_WAY })], {
    publishedAgo: 300,
    archived_at: at(20, "11:00"),
    archive_reason: "Replaced by the Expenses chapter of the User Guide",
  }),
  course(
    6,
    "Fire Safety at the Office",
    "Alarms, exits and the assembly point.",
    "published",
    [
      item("c6", "file", "Evacuation Plan", 5, { file: ["evacuation-plan.pdf", PDF] }),
      item("c6", "lesson", "When the Alarm Sounds", 5, { html: LESSON_FIRE }),
      item("c6", "video", "Using an Extinguisher", 4, { url: "https://youtu.be/M7lc1UVf-VE" }),
    ],
    { publishedAgo: 2 },
  ),
];
const C = (n: number) => COURSES[n - 1]!;

const ASSIGNMENTS: MockAssignment[] = [
  { id: sid("training-assignment:1"), course_id: C(1).training_course_id, everyone: true, department_ids: [], role_ids: [], employee_ids: [], due_within_days: 30, keep_assigning: true, withdrawn_at: null, created_at: at(21, "10:20"), created_by: "cynthia" },
  {
    id: sid("training-assignment:2"),
    course_id: C(2).training_course_id,
    everyone: false,
    department_ids: [sid("dept:Support"), sid("dept:Marketing & Sales")],
    role_ids: [],
    employee_ids: [],
    due_within_days: 14,
    keep_assigning: true,
    withdrawn_at: null,
    created_at: at(30, "09:40"),
    created_by: "cynthia",
  },
  { id: sid("training-assignment:3"), course_id: C(2).training_course_id, everyone: false, department_ids: [], role_ids: [], employee_ids: [byKey("musa")!.employee_id], due_within_days: null, keep_assigning: false, withdrawn_at: at(25, "15:00"), created_at: at(29, "12:00"), created_by: "cynthia" },
  { id: sid("training-assignment:4"), course_id: C(6).training_course_id, everyone: true, department_ids: [], role_ids: [], employee_ids: [], due_within_days: 14, keep_assigning: true, withdrawn_at: null, created_at: at(2, "11:05"), created_by: "cynthia" },
];

const ENROLMENTS: MockEnrolment[] = [];
let certSeq = 0;
function enrol(c: MockCourse, p: MockPerson, a: MockAssignment | null, o: { done?: number; started?: number; completed?: number; dueIn?: number | null; proof?: string } = {}): MockEnrolment {
  const done: Record<string, string> = {};
  c.items.slice(0, o.done ?? 0).forEach((it, i) => (done[it.training_item_id] = at((o.started ?? 1) - Math.min(i, o.started ?? 1), "12:00")));
  const completed = o.completed !== undefined ? at(o.completed, "16:30") : null;
  if (completed) c.items.forEach((it) => (done[it.training_item_id] ??= completed));
  if (completed && c.issue_certificate) certSeq += 1;
  const e: MockEnrolment = {
    id: sid(`training-enrolment:${c.number}:${p.user_key}`),
    course_id: c.training_course_id,
    employee_id: p.employee_id,
    assignment_id: a?.id ?? null,
    due_on: o.dueIn === undefined || o.dueIn === null ? null : o.dueIn >= 0 ? isoDaysAhead(o.dueIn) : isoDaysAgo(-o.dueIn),
    started_at: o.started !== undefined ? at(o.started, "09:30") : completed,
    completed_at: completed,
    proof_url: o.proof ?? null,
    proof_document_id: null,
    proof_document_name: null,
    certificate_number: completed && c.issue_certificate ? `CERT-2026-${String(certSeq).padStart(4, "0")}` : null,
    certificate_ready: Boolean(completed && c.issue_certificate),
    done,
    reminded_on: null,
  };
  ENROLMENTS.push(e);
  return e;
}

// Data Protection: everyone, due in 9 days; a third done, some under way, the rest not started.
PEOPLE.forEach((p, i) => {
  const a = ASSIGNMENTS[0]!;
  if (p.user_key === "cynthia") return enrol(C(1), p, a, { done: 2, started: 4, dueIn: 9 });
  if (i % 3 === 0) return enrol(C(1), p, a, { completed: 3 + (i % 5), dueIn: 9 });
  if (i % 3 === 1) return enrol(C(1), p, a, { done: 1 + (i % 3), started: 5, dueIn: 9 });
  return enrol(C(1), p, a, { dueIn: 9 });
});
// Customer Service: Support and Marketing & Sales, due 16 days ago; two finished with proof.
PEOPLE.filter((p) => ["Support", "Marketing & Sales"].includes(p.department)).forEach((p, i) => {
  const a = ASSIGNMENTS[1]!;
  if (i < 2) return enrol(C(2), p, a, { completed: 18 - i, dueIn: -16, proof: "https://learn.example.com/certificates/CS-48213" });
  return enrol(C(2), p, a, i % 2 ? { done: 1, started: 20, dueIn: -16 } : { dueIn: -16 });
});
// The Platform Walkthrough, from the Library.
["cynthia", "chidera", "kemi", "seyi"].forEach((k, i) => enrol(C(3), byKey(k)!, null, { completed: 12 + i * 3 }));
enrol(C(3), byKey("obinna")!, null, { done: 1, started: 6 });
// Fire Safety: everyone, two days ago, due in 12 days; nobody has started.
PEOPLE.forEach((p) => enrol(C(6), p, ASSIGNMENTS[3]!, { dueIn: 12 }));
// Expense Requests 2025 (archived): a few finished long ago.
["tolu", "amara"].forEach((k, i) => enrol(C(5), byKey(k)!, null, { completed: 200 + i * 10 }));

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

const today = () => todayIso();
function statusOf(e: MockEnrolment): EnrolmentStatus {
  if (e.completed_at) return "completed";
  if (e.due_on && e.due_on < today()) return "overdue";
  return e.started_at ? "in_progress" : "not_started";
}
const enrolledOn = (c: MockCourse) => ENROLMENTS.filter((e) => e.course_id === c.training_course_id);
const minutesOf = (items: MockItem[]) => {
  const set = items.filter((i) => i.minutes !== null);
  return set.length ? set.reduce((s, i) => s + (i.minutes ?? 0), 0) : null;
};
const countsOf = (c: MockCourse) => {
  const on = enrolledOn(c);
  return {
    assigned: on.length,
    in_progress: on.filter((e) => !e.completed_at && e.started_at).length,
    completed: on.filter((e) => e.completed_at).length,
    overdue: on.filter((e) => statusOf(e) === "overdue").length,
  };
};
const fullCourse = ({ updated_at: _u, ...c }: MockCourse): Course => ({ ...c, items: c.items, minutes: minutesOf(c.items), counts: countsOf({ ...c, updated_at: _u }) });
const rowOf = (c: MockCourse): CourseRow => {
  const n = countsOf(c);
  return { training_course_id: c.training_course_id, number: c.number, title: c.title, state: c.state, library: c.library, items: c.items.length, assigned: n.assigned, completed: n.completed, overdue: n.overdue, updated_at: c.updated_at };
};
const doneOn = (e: MockEnrolment, c: MockCourse) => c.items.filter((i) => e.done[i.training_item_id]).length;

function assignmentOf(a: MockAssignment): Assignment {
  const departments = a.department_ids.map((id) => ({ department_id: id, name: DEPT_NAME[id] ?? "Department" }));
  const roles = a.role_ids.map((id) => ({ role_id: id, name: ROLES[id] ?? "Role" }));
  const people = a.employee_ids.map((id) => ref(byId(id))!).filter(Boolean);
  const parts = [...departments.map((d) => d.name), ...roles.map((r) => r.name)];
  if (people.length === 1) parts.push(people[0]!.display_name);
  else if (people.length > 1) parts.push(`${people.length} people`);
  const audience = a.everyone ? "Everyone" : parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "Nobody");
  return {
    training_assignment_id: a.id,
    training_course_id: a.course_id,
    everyone: a.everyone,
    departments,
    roles,
    people,
    audience_text: audience,
    due_within_days: a.due_within_days,
    keep_assigning: a.keep_assigning,
    enrolled: ENROLMENTS.filter((e) => e.assignment_id === a.id).length,
    withdrawn_at: a.withdrawn_at,
    created_at: a.created_at,
    created_by_name: byKey(a.created_by)?.display_name ?? null,
  };
}

function enrolmentRowOf(e: MockEnrolment): EnrolmentRow {
  const c = COURSES.find((x) => x.training_course_id === e.course_id)!;
  return {
    training_enrolment_id: e.id,
    person: ref(byId(e.employee_id))!,
    status: statusOf(e),
    assigned: e.assignment_id !== null,
    due_on: e.due_on,
    started_at: e.started_at,
    completed_at: e.completed_at,
    items_done: doneOn(e, c),
    items_total: c.items.length,
    proof_url: e.proof_url,
    proof_document_id: e.proof_document_id,
    certificate_number: e.certificate_number,
    certificate_ready: e.certificate_ready,
  };
}

function myRowOf(c: MockCourse, e: MockEnrolment | null): MyCourseRow {
  return {
    training_course_id: c.training_course_id,
    number: c.number,
    title: c.title,
    summary: c.summary,
    minutes: minutesOf(c.items),
    items_total: c.items.length,
    items_done: e ? doneOn(e, c) : 0,
    status: e ? statusOf(e) : null,
    due_on: e?.due_on ?? null,
    completed_at: e?.completed_at ?? null,
    certificate_number: e?.certificate_number ?? null,
    certificate_ready: e?.certificate_ready ?? false,
  };
}

function myCourseOf(c: MockCourse, e: MockEnrolment | null): MyCourse {
  const items: MyItem[] = c.items.map((i) => ({ ...i, done_at: e?.done[i.training_item_id] ?? null }));
  return {
    training_course_id: c.training_course_id,
    number: c.number,
    title: c.title,
    summary: c.summary,
    minutes: minutesOf(c.items),
    items,
    proof_required: c.proof_required,
    proof_prompt: c.proof_prompt,
    issue_certificate: c.issue_certificate,
    enrolled: e !== null,
    status: e ? statusOf(e) : null,
    due_on: e?.due_on ?? null,
    started_at: e?.started_at ?? null,
    completed_at: e?.completed_at ?? null,
    proof_url: e?.proof_url ?? null,
    proof_document_name: e?.proof_document_name ?? null,
    certificate_number: e?.certificate_number ?? null,
    certificate_ready: e?.certificate_ready ?? false,
  };
}

/* ------------------------------------------------------------------ *
 * Rules
 * ------------------------------------------------------------------ */

const manages = (user: string | null) => {
  if (!user) return false;
  const m = me(user);
  return m.is_ceo || m.capabilities.includes("training.manage");
};
const refused = () => fail(403, "CAPABILITY_REQUIRED", "You need Manage Training for this.");
const courseOf = (id: string) => COURSES.find((c) => c.training_course_id === id);
const archivedRefusal = () => fail(409, "COURSE_ARCHIVED", "This course is archived");
const touch = (c: MockCourse) => (c.updated_at = new Date().toISOString());

/** The contract's own refusal for a body, as a 422 on its fields, or null when it parses. */
function check(schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } } }, body: unknown) {
  const r = schema.safeParse(body);
  if (r.success) return null;
  const fields: Record<string, string[]> = {};
  for (const i of r.error?.issues ?? []) (fields[String(i.path[0] ?? "body")] ??= []).push(i.message);
  return invalid(fields);
}

/** The person's own place on a course, and whether every item (and the proof, where asked) is in. */
function completeIfReady(c: MockCourse, e: MockEnrolment) {
  if (e.completed_at || !c.items.length) return;
  if (c.items.some((i) => !e.done[i.training_item_id])) return;
  if (c.proof_required && !e.proof_url && !e.proof_document_id) return;
  e.completed_at = new Date().toISOString();
  if (c.issue_certificate) {
    certSeq += 1;
    e.certificate_number = `CERT-2026-${String(certSeq).padStart(4, "0")}`;
    // The worker renders the PDF after commit; on the mock it is there at once.
    e.certificate_ready = true;
  }
}

/** An item's content from the body, checked for its kind (§6.5). */
function contentOf(body: Record<string, unknown>, at: MockItem | null): MockItem | ReturnType<typeof invalid> {
  const bad = check(trainingContract.ItemCreate, body);
  if (bad) return bad;
  const kind = body.kind as ItemKind;
  const base = { ...(at ?? { training_item_id: uuid(), position: 0 }), kind, title: String(body.title).trim(), minutes: (body.minutes as number | undefined) ?? null };
  const empty = { url: null, youtube_id: null, document_id: null, document_name: null, document_type: null, lesson_html: null, lesson: null };
  if (kind === "file") {
    const doc = UPLOADS.get(String(body.document_id));
    const same = at?.document_id === body.document_id ? at : null;
    if (!doc && !same) return invalid({ document_id: ["Upload the file again"] });
    return { ...base, ...empty, document_id: String(body.document_id), document_name: doc?.file_name ?? same!.document_name, document_type: doc?.mime_type ?? same!.document_type };
  }
  if (kind === "lesson") {
    const html = String(body.lesson_html);
    return { ...base, ...empty, lesson_html: html, lesson: blocksOf(html) };
  }
  const url = String(body.url).trim();
  return { ...base, ...empty, url, youtube_id: kind === "video" ? youtubeIdOf(url) : null };
}

/** Everyone an assignment reaches who has no place yet; a Library starter moves onto it (§6.7). */
function reach(a: MockAssignment, c: MockCourse) {
  const roleOf = (p: MockPerson) => sid(`role:${me(p.user_key).roles[0]?.code ?? "employee"}`);
  const reached = PEOPLE.filter(
    (p) => a.everyone || a.department_ids.includes(sid(`dept:${p.department}`)) || a.employee_ids.includes(p.employee_id) || a.role_ids.includes(roleOf(p)),
  );
  const due = a.due_within_days ? isoDaysAhead(a.due_within_days) : null;
  for (const p of reached) {
    const held = ENROLMENTS.find((e) => e.course_id === c.training_course_id && e.employee_id === p.employee_id);
    if (!held) enrol(c, p, a, { dueIn: a.due_within_days ?? null });
    else if (!held.completed_at && !held.assignment_id) Object.assign(held, { assignment_id: a.id, due_on: due });
    else if (!held.completed_at && due && (!held.due_on || due < held.due_on)) held.due_on = due;
  }
}

/* ------------------------------------------------------------------ *
 * Knowledge Hub · Training (training.manage)
 * ------------------------------------------------------------------ */

const bySort = <T,>(f: (r: T) => string) => (a: T, b: T) => f(a).localeCompare(f(b));

route("GET /api/v1/training/courses", (req) => {
  if (!manages(req.user)) return refused();
  return paged(
    COURSES.map(rowOf),
    req,
    {
      search: (r) => [r.title, r.number],
      filters: { state: (r, v) => r.state === v },
      sort: { updated_at: (a, b) => b.updated_at.localeCompare(a.updated_at), title: bySort((r) => r.title), number: bySort((r) => r.number) },
    },
  );
});

route("POST /api/v1/training/courses", (req) => {
  if (!manages(req.user)) return refused();
  const bad = check(trainingContract.CourseCreate, req.body);
  if (bad) return bad;
  const n = COURSES.length + 1;
  const c = course(n, String(req.body.title).trim(), String(req.body.summary ?? "").trim(), "draft", []);
  c.summary = c.summary || null;
  c.updated_at = new Date().toISOString();
  COURSES.push(c);
  return created(fullCourse(c));
});

route("GET /api/v1/training/courses/:id", (req) => {
  if (!manages(req.user)) return refused();
  const c = courseOf(req.params.id);
  return c ? ok(fullCourse(c)) : notFound();
});

route("PATCH /api/v1/training/courses/:id", (req) => {
  if (!manages(req.user)) return refused();
  const c = courseOf(req.params.id);
  if (!c) return notFound();
  if (c.state === "archived") return archivedRefusal();
  const bad = check(trainingContract.CourseUpdate, req.body);
  if (bad) return bad;
  const b = req.body as Partial<MockCourse>;
  const proofOff = c.proof_required && b.proof_required === false;
  for (const k of ["title", "summary", "library", "proof_required", "proof_prompt", "issue_certificate"] as const) {
    if (b[k] !== undefined) (c as Record<string, unknown>)[k] = typeof b[k] === "string" ? (b[k] as string).trim() || null : b[k];
  }
  if (proofOff) enrolledOn(c).forEach((e) => completeIfReady(c, e));
  touch(c);
  return ok(fullCourse(c));
});

route("POST /api/v1/training/courses/:id/items", (req) => {
  if (!manages(req.user)) return refused();
  const c = courseOf(req.params.id);
  if (!c) return notFound();
  if (c.state === "archived") return archivedRefusal();
  if (c.items.length >= 40) return fail(422, "TOO_MANY_ITEMS", "A course holds at most 40 items");
  const next = contentOf(req.body, null);
  if ("status" in next) return next;
  c.items = numbered([...c.items, next]);
  touch(c);
  return ok(fullCourse(c));
});

const ownerOf = (itemId: string) => COURSES.find((c) => c.items.some((i) => i.training_item_id === itemId));

route("PATCH /api/v1/training/items/:id", (req) => {
  if (!manages(req.user)) return refused();
  const c = ownerOf(req.params.id);
  if (!c) return notFound();
  if (c.state === "archived") return archivedRefusal();
  const was = c.items.find((i) => i.training_item_id === req.params.id)!;
  const next = contentOf(req.body, was);
  if ("status" in next) return next;
  c.items = c.items.map((i) => (i.training_item_id === was.training_item_id ? next : i));
  touch(c);
  return ok(fullCourse(c));
});

route("DELETE /api/v1/training/items/:id", (req) => {
  if (!manages(req.user)) return refused();
  const c = ownerOf(req.params.id);
  if (!c) return notFound();
  if (c.state === "archived") return archivedRefusal();
  c.items = numbered(c.items.filter((i) => i.training_item_id !== req.params.id));
  // Its progress goes; anyone now done with the rest completes (§6.6).
  enrolledOn(c).forEach((e) => {
    delete e.done[req.params.id];
    completeIfReady(c, e);
  });
  touch(c);
  return ok(fullCourse(c));
});

route("PUT /api/v1/training/courses/:id/order", (req) => {
  if (!manages(req.user)) return refused();
  const c = courseOf(req.params.id);
  if (!c) return notFound();
  if (c.state === "archived") return archivedRefusal();
  const ids = (req.body.item_ids as string[] | undefined) ?? [];
  const same = ids.length === c.items.length && new Set(ids).size === ids.length && ids.every((id) => c.items.some((i) => i.training_item_id === id));
  if (!same) return invalid({ item_ids: ["Every item of the course, once"] });
  c.items = numbered(ids.map((id) => c.items.find((i) => i.training_item_id === id)!));
  touch(c);
  return ok(fullCourse(c));
});

route("POST /api/v1/training/lesson-with-ai", (req) => {
  if (!manages(req.user)) return refused();
  const bad = check(trainingContract.LessonWithAi, req.body);
  if (bad) return bad;
  const text = String(req.body.text ?? "").trim();
  if (req.body.document_id && !text) return fail(422, "NO_TEXT", "No text in this file", { document_id: ["No text in this file"] });
  if (text.length < 40) return invalid({ text: ["Paste more text"] });
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<h2>${esc(String(req.body.title))}</h2><p>${esc(sentences.slice(0, 3).join(" "))}</p><h2>Key Points</h2><ul>${sentences
    .slice(0, 4)
    .map((s) => `<li>${esc(s)}</li>`)
    .join("")}</ul>`;
  return ok({ lesson_html: html });
});

route("POST /api/v1/training/courses/:id/publish", (req) => {
  if (!manages(req.user)) return refused();
  const c = courseOf(req.params.id);
  if (!c) return notFound();
  if (c.state !== "draft") return fail(409, "COURSE_PUBLISHED", "This course is already published");
  if (!c.items.length) return fail(422, "NO_ITEMS", "Add an item first");
  const bad = check(trainingContract.CoursePublish, req.body);
  if (bad) return bad;
  const who = byKey(req.user)!;
  Object.assign(c, { state: "published", published_at: new Date().toISOString(), published_by_name: who.display_name, signer_name: who.display_name, signer_title: who.job_title });
  touch(c);
  return ok(fullCourse(c));
});

route("POST /api/v1/training/courses/:id/archive", (req) => {
  if (!manages(req.user)) return refused();
  const c = courseOf(req.params.id);
  if (!c) return notFound();
  if (c.state === "archived") return archivedRefusal();
  const bad = check(trainingContract.CourseReason, req.body);
  if (bad) return bad;
  Object.assign(c, { state: "archived", library: false, archived_at: new Date().toISOString(), archive_reason: String(req.body.reason).trim() });
  ASSIGNMENTS.filter((a) => a.course_id === c.training_course_id && !a.withdrawn_at).forEach((a) => withdraw(a));
  touch(c);
  return ok(fullCourse(c));
});

route("POST /api/v1/training/courses/:id/assignments", (req) => {
  if (!manages(req.user)) return refused();
  const c = courseOf(req.params.id);
  if (!c) return notFound();
  if (c.state !== "published") return fail(409, "COURSE_NOT_PUBLISHED", "Publish the course first");
  const bad = check(trainingContract.AssignmentCreate, req.body);
  if (bad) return bad;
  const b = trainingContract.AssignmentCreate.parse(req.body);
  const named = !b.everyone && b.department_ids.length + b.role_ids.length === 0;
  const a: MockAssignment = {
    id: uuid(),
    course_id: c.training_course_id,
    everyone: b.everyone,
    department_ids: b.everyone ? [] : b.department_ids,
    role_ids: b.everyone ? [] : b.role_ids,
    employee_ids: b.everyone ? [] : b.employee_ids,
    due_within_days: b.due_within_days ?? null,
    keep_assigning: named ? false : b.keep_assigning,
    withdrawn_at: null,
    created_at: new Date().toISOString(),
    created_by: req.user!,
  };
  ASSIGNMENTS.push(a);
  reach(a, c);
  touch(c);
  return ok(assignmentOf(a));
});

route("GET /api/v1/training/courses/:id/assignments", (req) => {
  if (!manages(req.user)) return refused();
  const c = courseOf(req.params.id);
  if (!c) return notFound();
  const rows = ASSIGNMENTS.filter((a) => a.course_id === c.training_course_id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(assignmentOf);
  return paged(rows, req);
});

function withdraw(a: MockAssignment) {
  a.withdrawn_at = new Date().toISOString();
  a.keep_assigning = false;
  for (const e of [...ENROLMENTS]) {
    if (e.assignment_id !== a.id || e.completed_at) continue;
    if (!e.started_at) ENROLMENTS.splice(ENROLMENTS.indexOf(e), 1);
    else e.due_on = null;
  }
}

route("POST /api/v1/training/assignments/:id/withdraw", (req) => {
  if (!manages(req.user)) return refused();
  const a = ASSIGNMENTS.find((x) => x.id === req.params.id);
  if (!a) return fail(404, "NOT_FOUND", "That assignment does not exist");
  if (a.withdrawn_at) return fail(409, "ASSIGNMENT_WITHDRAWN", "This assignment is already withdrawn");
  withdraw(a);
  return ok(assignmentOf(a));
});

route("GET /api/v1/training/courses/:id/people", (req) => {
  if (!manages(req.user)) return refused();
  const c = courseOf(req.params.id);
  if (!c) return notFound();
  const rows = enrolledOn(c)
    .map(enrolmentRowOf)
    .sort((a, b) => a.person.display_name.localeCompare(b.person.display_name));
  const orNull = (v: string | null) => v ?? "9999";
  return paged(rows, req, {
    search: (r) => [r.person.display_name, r.person.department],
    filters: { status: (r, v) => r.status === v },
    sort: { due_on: (a, b) => orNull(a.due_on).localeCompare(orNull(b.due_on)), started_at: (a, b) => orNull(a.started_at).localeCompare(orNull(b.started_at)), completed_at: (a, b) => orNull(a.completed_at).localeCompare(orNull(b.completed_at)) },
  });
});

route("POST /api/v1/training/courses/:id/remind", (req) => {
  if (!manages(req.user)) return refused();
  const c = courseOf(req.params.id);
  if (!c) return notFound();
  const due = enrolledOn(c).filter((e) => statusOf(e) === "overdue" && e.reminded_on !== today());
  due.forEach((e) => (e.reminded_on = today()));
  return ok({ reminded: due.length });
});

route("POST /api/v1/training/enrolments/:id/certificate", (req) => {
  if (!manages(req.user)) return refused();
  const e = ENROLMENTS.find((x) => x.id === req.params.id);
  if (!e || !e.certificate_number) return notFound();
  return exportFile(req.user!, e.certificate_number.toLowerCase(), "pdf");
});

/* ------------------------------------------------------------------ *
 * ESS · My Training (self)
 * ------------------------------------------------------------------ */

const employeeOf = (req: Req) => byKey(req.user)!.employee_id;
const placeOf = (req: Req, c: MockCourse) => ENROLMENTS.find((e) => e.course_id === c.training_course_id && e.employee_id === employeeOf(req)) ?? null;

/** A course the person may open: theirs (by its id or their enrolment's), or a published Library course. */
function openable(req: Req, id: string): { c: MockCourse; e: MockEnrolment | null } | null {
  const own = ENROLMENTS.find((e) => e.id === id && e.employee_id === employeeOf(req));
  const c = own ? courseOf(own.course_id) : courseOf(id);
  if (!c) return null;
  const e = own ?? placeOf(req, c);
  if (e) return { c, e };
  return c.state === "published" && c.library ? { c, e: null } : null;
}

route("GET /api/v1/training/me", (req) => {
  const list = req.query.list ?? "to_do";
  const mine = ENROLMENTS.filter((e) => e.employee_id === employeeOf(req));
  const pick = {
    to_do: () => mine.filter((e) => !e.completed_at && !e.started_at),
    in_progress: () => mine.filter((e) => !e.completed_at && e.started_at),
    completed: () => mine.filter((e) => e.completed_at),
  } as const;
  if (list === "library") {
    const rows = COURSES.filter((c) => c.state === "published" && c.library && !mine.some((e) => e.course_id === c.training_course_id))
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((c) => myRowOf(c, null));
    return paged(rows, req, { search: (r) => [r.title, r.number], filters: { list: () => true } });
  }
  if (!(list in pick)) return invalid({ list: ["Not a list"] });
  const due = (e: MockEnrolment) => e.due_on ?? "9999";
  const rows = pick[list as keyof typeof pick]()
    .sort(list === "completed" ? (a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? "") : (a, b) => due(a).localeCompare(due(b)))
    .map((e) => myRowOf(courseOf(e.course_id)!, e));
  return paged(rows, req, { search: (r) => [r.title, r.number], filters: { list: () => true } });
});

route("GET /api/v1/training/me/courses/:id", (req) => {
  const o = openable(req, req.params.id);
  return o ? ok(myCourseOf(o.c, o.e)) : notFound();
});

route("POST /api/v1/training/me/courses/:id/start", (req) => {
  const o = openable(req, req.params.id);
  if (!o) return notFound();
  if (o.e) {
    o.e.started_at ??= new Date().toISOString();
    return ok(myCourseOf(o.c, o.e));
  }
  const e = enrol(o.c, byKey(req.user)!, null, {});
  e.started_at = new Date().toISOString();
  return ok(myCourseOf(o.c, e));
});

function ownItem(req: Req) {
  const c = ownerOf(req.params.id);
  if (!c) return { error: notFound() };
  const o = openable(req, c.training_course_id);
  if (!o) return { error: notFound() };
  if (!o.e) return { error: fail(409, "NOT_STARTED", "Start the course first") };
  return { c, e: o.e };
}

route("POST /api/v1/training/me/items/:id/done", (req) => {
  const r = ownItem(req);
  if ("error" in r) return r.error!;
  if (!r.e.completed_at) {
    r.e.started_at ??= new Date().toISOString();
    r.e.done[req.params.id] ??= new Date().toISOString();
    completeIfReady(r.c, r.e);
  }
  return ok(myCourseOf(r.c, r.e));
});

route("POST /api/v1/training/me/items/:id/undone", (req) => {
  const r = ownItem(req);
  if ("error" in r) return r.error!;
  if (r.e.completed_at) return fail(409, "COURSE_COMPLETED", "A completed course stays as it is");
  delete r.e.done[req.params.id];
  return ok(myCourseOf(r.c, r.e));
});

route("POST /api/v1/training/me/courses/:id/proof", (req) => {
  const o = openable(req, req.params.id);
  if (!o) return notFound();
  if (!o.e) return fail(409, "NOT_STARTED", "Start the course first");
  if (o.e.completed_at) return fail(409, "COURSE_COMPLETED", "A completed course stays as it is");
  if (!o.c.proof_required) return fail(409, "PROOF_NOT_ASKED", "This course asks for no proof");
  if (o.c.items.some((i) => !o.e!.done[i.training_item_id])) return fail(409, "ITEMS_LEFT", "Mark every item done first");
  const bad = check(trainingContract.ProofAdd, req.body);
  if (bad) return bad;
  if (req.body.url) o.e.proof_url = String(req.body.url).trim();
  else {
    const doc = UPLOADS.get(String(req.body.document_id));
    o.e.proof_document_id = String(req.body.document_id);
    o.e.proof_document_name = doc?.file_name ?? "proof.pdf";
  }
  completeIfReady(o.c, o.e);
  return ok(myCourseOf(o.c, o.e));
});

route("POST /api/v1/training/me/courses/:id/certificate", (req) => {
  const o = openable(req, req.params.id);
  if (!o?.e?.certificate_number) return notFound();
  return exportFile(req.user!, o.e.certificate_number.toLowerCase(), "pdf");
});
