import type { RichTextBlock, RichTextSpan, Sop, SopDraft, SopDraftSuggestion, SopRow, SopStep, SopVersion, SopVersionRow } from "@mycity/contract/contract.gen.ts";
import knowledge from "@mycity/contract/schemas/knowledge.js";
import { MODULES } from "@/shell/catalogue";
import { at, created, fail, invalid, notFound, ok, paged, route, sid, type Req } from "../core";
import { byKey, SIGN_INS } from "../data/people";

/**
 * Knowledge Hub · SOPs on the mock, in the contract's shapes (docs/guides/knowledge.md §4 to §6):
 * five departments' procedures with their versions, a draft being written, one still a draft and
 * one archived; who writes is the server's rule (§6.2): Operations and the CEO hold Manage SOPs,
 * and Ngozi heads Marketing & Sales. Steps are Markdown, drawn as the API draws them.
 */

/* ------------------------------------------------------------------ *
 * Text: a step's Markdown as the reader's blocks
 * ------------------------------------------------------------------ */
function spansOf(text: string): RichTextSpan[] {
  const out: RichTextSpan[] = [];
  for (const part of text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)) {
    if (!part) continue;
    if (part.startsWith("**")) out.push({ text: part.slice(2, -2), bold: true, italic: false, href: null });
    else if (part.startsWith("*")) out.push({ text: part.slice(1, -1), bold: false, italic: true, href: null });
    else out.push({ text: part, bold: false, italic: false, href: null });
  }
  return out;
}
function blocksOf(md: string): RichTextBlock[] {
  return md
    .split(/\n{2,}/)
    .map((chunk) => chunk.split("\n").map((l) => l.trim()).filter(Boolean))
    .filter((lines) => lines.length > 0)
    .map((lines): RichTextBlock =>
      lines.every((l) => l.startsWith("- "))
        ? { kind: "bullets", items: lines.map((l) => spansOf(l.slice(2))) }
        : { kind: "paragraph", spans: spansOf(lines.join(" ")) },
    );
}

/* ------------------------------------------------------------------ *
 * The SOPs
 * ------------------------------------------------------------------ */
const dept = (name: string) => ({ department_id: sid(`dept:${name}`), department_name: name });
const SCREENS = new Map(MODULES.flatMap((m) => m.tabs.map((t) => [`${m.key}/${t.slug}`, `${m.label} · ${t.label}`] as [string, string])));

type StepIn = { text: string; who?: string | null; screen_key?: string | null; document_id?: string | null; document_name?: string | null };
type VersionRec = { sop_version_id: string; version: number; title: string; purpose: string; scope: string | null; roles: string[]; steps: StepIn[]; note: string | null; published_at: string; published_by: string };
type DraftRec = { sop_version_id: string; title: string; purpose: string | null; scope: string | null; roles: string[]; steps: StepIn[]; updated_at: string; updated_by: string };
type SopRec = { sop_id: string; number: string; department_id: string; department_name: string; title: string; status: "active" | "archived"; archived_at: string | null; archive_reason: string | null; versions: VersionRec[]; draft: DraftRec | null; updated_at: string };

const BRAND_KIT = sid("doc:sop:brand-kit");
const CAMPAIGN_V1: StepIn[] = [
  { text: "Write the **brief**: the audience, the offer and the budget.", who: "Campaign Lead" },
  { text: "Design the launch assets from the brand kit.", who: "Designer", document_id: BRAND_KIT, document_name: "brand-kit.pdf" },
  { text: "Post the launch in #announcements on the morning it goes live.", who: "Campaign Lead", screen_key: "community/announcements" },
];
const CAMPAIGN_V2: StepIn[] = [CAMPAIGN_V1[0]!, { text: "Agree the budget line with Finance before anything is booked.", who: "Campaign Lead", screen_key: "expenses/requisitions" }, ...CAMPAIGN_V1.slice(1)];
const JOINER: StepIn[] = [
  { text: "Add the new joiner's record before their first day, with their line manager.", who: "People Officer", screen_key: "people/employees" },
  { text: "Register their phone as a clock-in device on day one.", who: "People Officer", screen_key: "people/devices" },
  { text: "Walk them through *Staff Community* and their first week's tasks.", who: "Line Manager" },
];

const version = (key: string, n: number, title: string, purpose: string, roles: string[], steps: StepIn[], daysAgo: number, note: string | null, by = "cynthia"): VersionRec => ({
  sop_version_id: sid(`sopv:${key}:${n}`),
  version: n,
  title,
  purpose,
  scope: null,
  roles,
  steps,
  note,
  published_at: at(daysAgo, "10:15"),
  published_by: by,
});

const SOPS: SopRec[] = [
  {
    sop_id: sid("sop:campaign"),
    number: "SOP-0001",
    ...dept("Marketing & Sales"),
    title: "Campaign Launch",
    status: "active",
    archived_at: null,
    archive_reason: null,
    versions: [
      version("campaign", 1, "Campaign Launch", "How Marketing takes a campaign from brief to launch day.", ["Campaign Lead", "Designer"], CAMPAIGN_V1, 60, null, "ngozi"),
      { ...version("campaign", 2, "Campaign Launch", "How Marketing takes a campaign from brief to launch day.", ["Campaign Lead", "Designer"], CAMPAIGN_V2, 12, "Added the budget step", "ngozi"), scope: "Every paid or partner campaign." },
    ],
    draft: null,
    updated_at: at(12, "10:15"),
  },
  {
    sop_id: sid("sop:partner"),
    number: "SOP-0002",
    ...dept("Operations & People"),
    title: "Partner Onboarding",
    status: "active",
    archived_at: null,
    archive_reason: null,
    versions: [
      version("partner", 1, "Partner Onboarding", "How a signed partner is set up and introduced within a week.", ["Partnerships Officer", "Account Manager"], [
        { text: "Confirm the signed agreement is on the partner's record.", who: "Partnerships Officer", screen_key: "partnerships/contracts-and-mous" },
        { text: "Create the partner with its category and region.", who: "Partnerships Officer", screen_key: "partnerships/partners" },
        { text: "Introduce the account manager by email within two working days.", who: "Account Manager" },
      ], 30, null),
    ],
    draft: null,
    updated_at: at(30, "10:15"),
  },
  {
    sop_id: sid("sop:joiner"),
    number: "SOP-0003",
    ...dept("Operations & People"),
    title: "New Joiner Setup",
    status: "active",
    archived_at: null,
    archive_reason: null,
    versions: [version("joiner", 1, "New Joiner Setup", "How People get a new joiner ready for their first day.", ["People Officer", "Line Manager"], JOINER, 45, null)],
    draft: {
      sop_version_id: sid("sopv:joiner:draft"),
      title: "New Joiner Setup",
      purpose: "How People get a new joiner ready for their first day.",
      scope: null,
      roles: ["People Officer", "Line Manager"],
      steps: [...JOINER, { text: "Book their policy acknowledgements for the first week.", who: "People Officer", screen_key: "knowledge/policies" }],
      updated_at: at(2, "16:40"),
      updated_by: "cynthia",
    },
    updated_at: at(45, "10:15"),
  },
  {
    sop_id: sid("sop:close"),
    number: "SOP-0004",
    ...dept("Finance"),
    title: "Month End Close",
    status: "active",
    archived_at: null,
    archive_reason: null,
    versions: [],
    draft: { sop_version_id: sid("sopv:close:draft"), title: "Month End Close", purpose: null, scope: null, roles: [], steps: [], updated_at: at(1, "09:05"), updated_by: "cynthia" },
    updated_at: at(1, "09:05"),
  },
  {
    sop_id: sid("sop:escalation"),
    number: "SOP-0005",
    ...dept("Support"),
    title: "Ticket Escalation",
    status: "archived",
    archived_at: at(20, "11:00"),
    archive_reason: "Replaced by the support desk's own tool",
    versions: [version("escalation", 1, "Ticket Escalation", "How Support hands a ticket to Engineering.", ["Support Agent"], [{ text: "Escalate a ticket open past two days to Engineering.", who: "Support Agent" }], 90, null)],
    draft: null,
    updated_at: at(20, "11:00"),
  },
];

/* ------------------------------------------------------------------ *
 * Who writes, and what each reader sees
 * ------------------------------------------------------------------ */
const HEADS: Record<string, string[]> = { ngozi: [sid("dept:Marketing & Sales")] };
function reachOf(user: string | null) {
  const view = SIGN_INS[user ?? ""]?.view;
  return { all: view === "operations" || view === "ceo", departments: HEADS[user ?? ""] ?? [] };
}
const writes = (user: string | null, departmentId: string) => {
  const r = reachOf(user);
  return r.all || r.departments.includes(departmentId);
};
const nameOf = (key: string) => byKey(key)?.display_name ?? null;
const inForceOf = (s: SopRec) => s.versions[s.versions.length - 1] ?? null;
const stateOf = (s: SopRec): SopRow["state"] => (s.status === "archived" ? "archived" : inForceOf(s) ? "published" : "draft");
const visible = (s: SopRec, user: string | null) => writes(user, s.department_id) || (s.status === "active" && Boolean(inForceOf(s)));

const stepOut = (s: StepIn, i: number): SopStep => ({
  position: i + 1,
  text: s.text,
  blocks: blocksOf(s.text),
  who: s.who ?? null,
  screen_key: s.screen_key ?? null,
  screen_label: s.screen_key ? (SCREENS.get(s.screen_key) ?? null) : null,
  document_id: s.document_id ?? null,
  document_name: s.document_id ? (s.document_name ?? "File") : null,
});
const contentKey = (c: { title: string; purpose: string | null; scope: string | null; roles: string[]; steps: StepIn[] }) =>
  JSON.stringify([c.title, c.purpose ?? null, c.scope ?? null, c.roles, c.steps.map((x) => [x.text, x.who ?? null, x.screen_key ?? null, x.document_id ?? null])]);

const versionOut = (s: SopRec, v: VersionRec): SopVersion => ({
  sop_version_id: v.sop_version_id,
  sop_id: s.sop_id,
  number: s.number,
  department_id: s.department_id,
  department_name: s.department_name,
  version: v.version,
  title: v.title,
  purpose: v.purpose,
  scope: v.scope,
  roles: v.roles,
  steps: v.steps.map(stepOut),
  note: v.note,
  published_at: v.published_at,
  published_by_name: nameOf(v.published_by),
  content_hash: `mock-${v.sop_version_id}`,
});
const draftOut = (s: SopRec, d: DraftRec): SopDraft => {
  const base = inForceOf(s);
  return {
    sop_version_id: d.sop_version_id,
    title: d.title,
    purpose: d.purpose,
    scope: d.scope,
    roles: d.roles,
    steps: d.steps.map(stepOut),
    has_changes: !base || contentKey(base) !== contentKey(d),
    updated_at: d.updated_at,
    updated_by_name: nameOf(d.updated_by),
  };
};
function sopOut(s: SopRec, user: string | null): Sop {
  const writer = writes(user, s.department_id);
  const v = inForceOf(s);
  const active = s.status === "active";
  return {
    sop_id: s.sop_id,
    number: s.number,
    department_id: s.department_id,
    department_name: s.department_name,
    title: s.title,
    state: stateOf(s),
    in_force: v ? versionOut(s, v) : null,
    draft: writer && s.draft ? draftOut(s, s.draft) : null,
    archived_at: s.archived_at,
    archive_reason: s.archive_reason,
    can_edit: active && writer,
    can_archive: active && writer,
  };
}
const rowOut = (s: SopRec): SopRow => ({
  sop_id: s.sop_id,
  number: s.number,
  title: s.title,
  department_id: s.department_id,
  department_name: s.department_name,
  state: stateOf(s),
  version: inForceOf(s)?.version ?? null,
  has_draft: Boolean(s.draft),
  updated_at: s.updated_at,
});

/** A contract refusal as the API's 422: each problem on its dotted field. */
function refused(r: { error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) {
  const fields: Record<string, string[]> = {};
  for (const i of r.error?.issues ?? []) (fields[i.path.join(".") || "body"] ??= []).push(i.message);
  return invalid(fields);
}
const byIdOr404 = (req: Req) => {
  const s = SOPS.find((x) => x.sop_id === req.params.id);
  return s && visible(s, req.user) ? s : null;
};
const notWriter = () => fail(403, "NOT_SOP_WRITER", "You may not write this department's SOPs");
const SORTS = { title: (a: SopRow, b: SopRow) => a.title.localeCompare(b.title), number: (a: SopRow, b: SopRow) => a.number.localeCompare(b.number), updated_at: (a: SopRow, b: SopRow) => a.updated_at.localeCompare(b.updated_at) };
const byDepartment = (a: SopRow, b: SopRow) => a.department_name.localeCompare(b.department_name) || a.title.localeCompare(b.title);

/* ------------------------------------------------------------------ *
 * Routes (static paths before /:id)
 * ------------------------------------------------------------------ */
route("GET /api/v1/knowledge/sops/departments", (req) => {
  const r = reachOf(req.user);
  const all = [...new Map(SOPS.map((s) => [s.department_id, s.department_name])).entries()].map(([department_id, name]) => ({ department_id, name }));
  const names = ["Executive", "Operations & People", "Marketing & Sales", "Content", "Finance", "Engineering", "Support", "Studio"].map((name) => ({ department_id: sid(`dept:${name}`), name }));
  const rows =
    req.query.writable === "true"
      ? names.filter((d) => r.all || r.departments.includes(d.department_id))
      : all.filter((d) => SOPS.some((s) => s.department_id === d.department_id && visible(s, req.user)));
  return paged([...rows].sort((a, b) => a.name.localeCompare(b.name)), req, { search: (d) => [d.name], filters: { writable: () => true } });
});

route("GET /api/v1/knowledge/sops/for-screen", (req) => {
  const rows = SOPS.filter((s) => s.status === "active" && inForceOf(s)?.steps.some((x) => x.screen_key === req.query.screen_key)).map(rowOut);
  return paged(rows.sort(byDepartment), req, { search: (r) => [r.title], filters: { screen_key: () => true } });
});

route("POST /api/v1/knowledge/sops/draft-with-ai", (req) => {
  const parsed = knowledge.SopDraftWithAi.safeParse(req.body);
  if (!parsed.success) return refused(parsed);
  const body = parsed.data as { department_id: string; text?: string; document_id?: string };
  if (!writes(req.user, body.department_id)) return notWriter();
  if (!body.text) return fail(422, "NO_TEXT", "No text in this file", { document_id: ["No text in this file"] });
  const sentences = body.text.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter((x) => x.length >= 3);
  const out: SopDraftSuggestion = {
    title: (sentences[0] ?? "Procedure").replace(/[.!?]$/, "").slice(0, 60),
    purpose: `The steps for ${(sentences[0] ?? "this procedure").replace(/[.!?]$/, "").toLowerCase()}, in order.`,
    scope: null,
    roles: [],
    steps: sentences.slice(0, 50).map((text) => ({ text, who: null })),
  };
  return ok(out);
});

route("GET /api/v1/knowledge/sops/versions/:id", (req) => {
  for (const s of SOPS) {
    const v = s.versions.find((x) => x.sop_version_id === req.params.id);
    if (v && (s.status === "active" || writes(req.user, s.department_id))) return ok(versionOut(s, v));
  }
  return notFound();
});

route("GET /api/v1/knowledge/sops", (req) => {
  const state = req.query.state || "published";
  const rows = SOPS.filter((s) => {
    if (state === "archived") return s.status === "archived" && writes(req.user, s.department_id);
    if (state === "draft") return s.status === "active" && Boolean(s.draft) && writes(req.user, s.department_id);
    return s.status === "active" && Boolean(inForceOf(s));
  }).map(rowOut);
  const sorted = req.query.sort ? rows : rows.sort(byDepartment);
  return paged(sorted, req, { search: (r) => [r.title, r.number], filters: { state: () => true, department_id: (r, v) => r.department_id === v }, sort: req.query.sort ? SORTS : undefined });
});

route("POST /api/v1/knowledge/sops", (req) => {
  const parsed = knowledge.SopCreate.safeParse(req.body);
  if (!parsed.success) return refused(parsed);
  const body = parsed.data as { department_id: string; title: string };
  if (!writes(req.user, body.department_id)) return notWriter();
  const name = ["Executive", "Operations & People", "Marketing & Sales", "Content", "Finance", "Engineering", "Support", "Studio"].find((n) => sid(`dept:${n}`) === body.department_id);
  if (!name) return invalid({ department_id: ["Pick a department"] });
  const n = SOPS.length + 1;
  const s: SopRec = {
    sop_id: sid(`sop:new:${n}`),
    number: `SOP-${String(n).padStart(4, "0")}`,
    ...dept(name),
    title: body.title,
    status: "active",
    archived_at: null,
    archive_reason: null,
    versions: [],
    draft: { sop_version_id: sid(`sopv:new:${n}`), title: body.title, purpose: null, scope: null, roles: [], steps: [], updated_at: new Date().toISOString(), updated_by: req.user ?? "cynthia" },
    updated_at: new Date().toISOString(),
  };
  SOPS.push(s);
  return created(sopOut(s, req.user));
});

route("GET /api/v1/knowledge/sops/:id", (req) => {
  const s = byIdOr404(req);
  return s ? ok(sopOut(s, req.user)) : notFound();
});

route("PUT /api/v1/knowledge/sops/:id/draft", (req) => {
  const s = byIdOr404(req);
  if (!s) return notFound();
  if (s.status !== "active") return fail(409, "SOP_ARCHIVED", "This SOP is archived");
  if (!writes(req.user, s.department_id)) return notWriter();
  const parsed = knowledge.SopDraftSave.safeParse(req.body);
  if (!parsed.success) return refused(parsed);
  const body = parsed.data as { title: string; purpose?: string; scope?: string; roles: string[]; steps: StepIn[] };
  const unknown = body.steps.findIndex((x) => x.screen_key && !SCREENS.has(x.screen_key));
  if (unknown >= 0) return fail(422, "UNKNOWN_SCREEN", "Pick a screen the hub has", { [`steps.${unknown}.screen_key`]: ["Pick a screen"] });
  const names = new Map([...s.versions.flatMap((v) => v.steps), ...(s.draft?.steps ?? [])].filter((x) => x.document_id).map((x) => [x.document_id, x.document_name]));
  s.draft = {
    sop_version_id: s.draft?.sop_version_id ?? sid(`sopv:${s.sop_id}:${s.versions.length + 1}`),
    title: body.title,
    purpose: body.purpose ?? null,
    scope: body.scope ?? null,
    roles: body.roles,
    steps: body.steps.map((x) => ({ ...x, document_name: x.document_id ? (names.get(x.document_id) ?? "File") : null })),
    updated_at: new Date().toISOString(),
    updated_by: req.user ?? "cynthia",
  };
  if (!inForceOf(s)) s.title = body.title;
  return ok(sopOut(s, req.user));
});

route("POST /api/v1/knowledge/sops/:id/draft/discard", (req) => {
  const s = byIdOr404(req);
  if (!s) return notFound();
  if (!writes(req.user, s.department_id)) return notWriter();
  if (!s.draft) return fail(409, "NO_DRAFT", "There is no draft");
  s.draft = null;
  return ok(sopOut(s, req.user));
});

route("POST /api/v1/knowledge/sops/:id/publish", (req) => {
  const s = byIdOr404(req);
  if (!s) return notFound();
  if (s.status !== "active") return fail(409, "SOP_ARCHIVED", "This SOP is archived");
  if (!writes(req.user, s.department_id)) return notWriter();
  const parsed = knowledge.SopPublish.safeParse(req.body);
  if (!parsed.success) return refused(parsed);
  const note = (parsed.data as { note?: string }).note ?? null;
  const d = s.draft;
  if (!d) return fail(409, "NO_DRAFT", "Save the changes as a draft first");
  if (!d.purpose || d.purpose.length < 10) return fail(422, "SOP_NO_PURPOSE", "Write the purpose first", { purpose: ["Write the purpose"] });
  if (!d.steps.length) return fail(422, "SOP_NO_STEPS", "Add a step first", { steps: ["Add a step"] });
  const base = inForceOf(s);
  if (base && contentKey(base) === contentKey(d)) return fail(409, "NO_CHANGES", "The draft changes nothing");
  if (base && !note) return invalid({ note: ["Required"] });
  s.versions.push({ sop_version_id: d.sop_version_id, version: s.versions.length + 1, title: d.title, purpose: d.purpose, scope: d.scope, roles: d.roles, steps: d.steps, note, published_at: new Date().toISOString(), published_by: req.user ?? "cynthia" });
  s.draft = null;
  s.title = d.title;
  s.updated_at = new Date().toISOString();
  return ok(sopOut(s, req.user));
});

route("POST /api/v1/knowledge/sops/:id/archive", (req) => {
  const s = byIdOr404(req);
  if (!s) return notFound();
  if (s.status !== "active") return fail(409, "SOP_ARCHIVED", "This SOP is already archived");
  if (!writes(req.user, s.department_id)) return notWriter();
  const parsed = knowledge.SopReason.safeParse(req.body);
  if (!parsed.success) return refused(parsed);
  s.status = "archived";
  s.archived_at = new Date().toISOString();
  s.archive_reason = (parsed.data as { reason: string }).reason;
  s.updated_at = s.archived_at;
  return ok(sopOut(s, req.user));
});

route("GET /api/v1/knowledge/sops/:id/versions", (req) => {
  const s = byIdOr404(req);
  if (!s) return notFound();
  const rows: SopVersionRow[] = [...s.versions].reverse().map((v) => ({ sop_version_id: v.sop_version_id, version: v.version, title: v.title, note: v.note, published_at: v.published_at, published_by_name: nameOf(v.published_by) }));
  return paged(rows, req);
});
