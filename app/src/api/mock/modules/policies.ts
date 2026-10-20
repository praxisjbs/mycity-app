import type {
  AppliesTo,
  AttendanceRules,
  MyPolicyDue,
  MyPolicyRow,
  MyPolicyVersion,
  Policy,
  PolicyAck,
  PolicyDraft,
  PolicyKind,
  PolicyRow,
  PolicySection,
  PolicySignature,
  PolicyState,
  PolicyVersion,
  RichTextBlock,
  RichTextSpan,
  VersionState,
} from "@mycity/contract/contract.gen.ts";
import attendanceContract from "@mycity/contract/schemas/attendance.js";
import policiesContract from "@mycity/contract/schemas/policies.js";
import { todayIso } from "@mycity/ui";
import { audit } from "../data/audit";
import { at, created, fail, invalid, isoDaysAgo, isoDaysAhead, noContent, notFound, ok, paged, route, sid } from "../core";
import { byKey, PEOPLE, ref, refKey, SIGN_INS, type MockPerson } from "../data/people";
import { exportFile } from "./shared";

/**
 * Knowledge Hub · Policies and ESS · Policy Updates on the mock (docs/guides/policies.md): every
 * policy with its draft, submission and versions, Applies To, acknowledgements with Later, the
 * CEO's approval and the Attendance policy's rules, which the clock's mock reads
 * (attendanceRulesInForce). The text is kept as blocks; the editor's HTML is read with the
 * browser's own parser, keeping headings, paragraphs, lists, bold, italic and safe links only.
 *
 * Cynthia (Operations, the crawl's account) has acknowledged everything, so no sheet opens over the
 * screens the gates read; Chidera (Staff) owes the Data Protection update; Ifeoma (CEO) has the
 * Remote and Hybrid Working change waiting on her.
 */

/* ------------------------------------------------------------------ *
 * Text: the editor's HTML to blocks and back
 * ------------------------------------------------------------------ */
const SAFE = /^(https?:|mailto:|tel:)/i;
type Marks = { bold: boolean; italic: boolean; href: string | null };

function spansOf(node: Node, marks: Marks = { bold: false, italic: false, href: null }): RichTextSpan[] {
  const out: RichTextSpan[] = [];
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent ?? "").replace(/\s+/g, " ");
      if (text) out.push({ text, ...marks });
      return;
    }
    if (!(child instanceof Element)) return;
    const tag = child.tagName.toLowerCase();
    if (tag === "script" || tag === "style") return;
    const href = tag === "a" && SAFE.test(child.getAttribute("href") ?? "") ? child.getAttribute("href") : marks.href;
    out.push(...spansOf(child, { bold: marks.bold || tag === "b" || tag === "strong", italic: marks.italic || tag === "i" || tag === "em", href }));
  });
  return out;
}

function blocksOf(html: string): RichTextBlock[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: RichTextBlock[] = [];
  for (const el of Array.from(doc.body.children)) {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) out.push({ kind: "heading", level: Math.min(4, Math.max(2, Number(tag[1]))), spans: spansOf(el) });
    else if (tag === "ul" || tag === "ol") out.push({ kind: tag === "ol" ? "numbered" : "bullets", items: Array.from(el.querySelectorAll("li")).map((li) => spansOf(li)) });
    else if (tag !== "script" && tag !== "style") {
      const spans = spansOf(el);
      if (spans.some((s) => s.text.trim())) out.push({ kind: "paragraph", spans });
    }
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const spanHtml = (s: RichTextSpan) => {
  let h = esc(s.text);
  if (s.italic) h = `<em>${h}</em>`;
  if (s.bold) h = `<strong>${h}</strong>`;
  return s.href ? `<a href="${esc(s.href)}">${h}</a>` : h;
};
const htmlOf = (blocks: RichTextBlock[]) =>
  blocks
    .map((b) =>
      b.kind === "heading"
        ? `<h${b.level}>${b.spans.map(spanHtml).join("")}</h${b.level}>`
        : b.kind === "paragraph"
          ? `<p>${b.spans.map(spanHtml).join("")}</p>`
          : `<${b.kind === "numbered" ? "ol" : "ul"}>${b.items.map((i) => `<li>${i.map(spanHtml).join("")}</li>`).join("")}</${b.kind === "numbered" ? "ol" : "ul"}>`,
    )
    .join("\n");
const plain = (text: string): RichTextSpan[] => [{ text, bold: false, italic: false, href: null }];
const P = (text: string): RichTextBlock => ({ kind: "paragraph", spans: plain(text) });
const H = (text: string, level = 2): RichTextBlock => ({ kind: "heading", level, spans: plain(text) });
const L = (numbered: boolean, ...items: string[]): RichTextBlock => ({ kind: numbered ? "numbered" : "bullets", items: items.map(plain) });
const wordsOf = (blocks: RichTextBlock[]) =>
  blocks.flatMap((b) => (b.kind === "bullets" || b.kind === "numbered" ? b.items.flat() : b.spans)).map((s) => s.text).join(" ");

/* ------------------------------------------------------------------ *
 * The Attendance policy's rules, as staff read them
 * ------------------------------------------------------------------ */
const DEFAULT_RULES: AttendanceRules = attendanceContract.AttendanceRules.parse({});
const VISIBLE = ["grace_minutes", "office_geofence_mode", "home_geofence_mode", "site_geofence_mode", "home_radius_m", "max_accuracy_m", "device_mode"] as const;
type Visible = (typeof VISIBLE)[number];
const RULE_LABEL: Record<Visible, string> = {
  grace_minutes: "Grace Minutes",
  office_geofence_mode: "Office Check",
  home_geofence_mode: "Home Check",
  site_geofence_mode: "Temporary Site Check",
  home_radius_m: "Home Radius",
  max_accuracy_m: "GPS Accuracy",
  device_mode: "Device Check",
};
const MODE: Record<string, string> = { off: "Off", warn: "Flag", block: "Refuse" };
const minutes = (n: number) => `${n} minute${n === 1 ? "" : "s"}`;
const ruleValue = (k: Visible, r: AttendanceRules) =>
  k === "grace_minutes" ? minutes(r.grace_minutes) : k === "home_radius_m" || k === "max_accuracy_m" ? `${r[k]} m` : MODE[r[k]];
const changedRules = (before: AttendanceRules | null, after: AttendanceRules) =>
  before ? VISIBLE.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])) : [];

function sectionsOf(r: AttendanceRules, changed: readonly string[]): PolicySection[] {
  const office =
    r.office_geofence_mode === "off"
      ? "At the office, your location is recorded with each clock-in and clock-out. Nothing is flagged."
      : r.office_geofence_mode === "warn"
        ? "At the office, a clock-in outside your office's radius is accepted and sent to People for review."
        : "At the office, a clock-in outside your office's radius is refused, and People see it. Clock in again from inside it.";
  const away = `Working from home, a clock-in more than ${r.home_radius_m} m from your approved home`;
  const home =
    r.home_geofence_mode === "off"
      ? ["Working from home, your location is recorded with each clock-in and clock-out. Nothing is flagged."]
      : [r.home_geofence_mode === "warn" ? `${away} is accepted and sent for review.` : `${away} is refused, and People see it.`, "Until People approve your home, your clock-ins are sent for review."];
  const elsewhere = "Working somewhere else? Add it from Home, or ask People.";
  const site =
    r.site_geofence_mode === "off"
      ? ["At a temporary site, your location is recorded with each clock-in and check-in. Nothing is flagged.", elsewhere]
      : r.site_geofence_mode === "warn"
        ? ["At a temporary site, a clock-in or check-in outside its addresses is accepted and sent for review.", elsewhere]
        : ["At a temporary site, a clock-in outside its addresses is refused, and People see it.", "A check-in outside them is sent for review.", elsewhere];
  const checked = [r.office_geofence_mode, r.home_geofence_mode, r.site_geofence_mode].some((m) => m !== "off");
  const device =
    r.device_mode === "off"
      ? "You can clock in from any device. Each device you use is recorded."
      : r.device_mode === "warn"
        ? "A clock-in from a device not registered on My Devices is accepted and sent for review."
        : "A clock-in from a device not registered on My Devices is refused. Register it first.";
  const SECTIONS: Array<[string, string, readonly string[], string[]]> = [
    ["clocking_in", "Clocking In", ["grace_minutes"], [r.grace_minutes > 0 ? `You have a grace period of ${minutes(r.grace_minutes)} after your resumption time. A clock-in after it counts as late.` : "There is no grace period. A clock-in after your resumption time counts as late."]],
    ["office", "At the Office", ["office_geofence_mode"], [office]],
    ["home", "Working From Home", ["home_geofence_mode", "home_radius_m"], home],
    ["site", "At a Temporary Site", ["site_geofence_mode"], site],
    ["location", "Your Location", ["max_accuracy_m"], [`Your phone's location must be accurate to within ${r.max_accuracy_m} m. A weaker reading cannot confirm where you are.`, ...(checked ? ["When your location cannot be confirmed, your clock-in is sent to People for review."] : [])]],
    ["devices", "Your Devices", ["device_mode"], [device]],
  ];
  return SECTIONS.map(([key, title, rules, sentences]) => ({
    key,
    title,
    sentences: sentences.map((text, i) => ({ key: `${key}.${i}`, text, changed: rules.some((x) => changed.includes(x)) })),
  }));
}

/* ------------------------------------------------------------------ *
 * The records
 * ------------------------------------------------------------------ */
type VersionStatus = "draft" | "submitted" | "published" | "withdrawn";
interface Pol {
  policy_id: string;
  number: string;
  kind: PolicyKind;
  title: string;
  status: "active" | "archived";
  updated_at: string;
}
interface Ver {
  id: string;
  policy_id: string;
  status: VersionStatus;
  version: number | null;
  effective_from: string | null;
  note: string | null;
  title: string;
  blocks: RichTextBlock[] | null;
  rules: AttendanceRules | null;
  applies_to: AppliesTo;
  needs_acknowledgement: boolean;
  acknowledge_within_days: number;
  needs_approval: boolean;
  published_at: string | null;
  published_by: string | null;
  submitted_at: string | null;
  submitted_by: string | null;
  withdrawn_at: string | null;
  withdraw_reason: string | null;
  updated_at: string;
  updated_by: string | null;
  signatures: PolicySignature[];
}
type Ack = { acknowledged_at: string | null; reminded_at: string | null; deferred_on: string | null };

const EVERYONE: AppliesTo = { everyone: true, department_ids: [], work_patterns: [], employee_ids: [] };
const deptId = (name: string) => sid(`dept:${name}`);
const signed = (key: string, daysBack: number, role: "publisher" | "approver" = "publisher"): PolicySignature => ({
  role,
  stage_name: role === "approver" ? "CEO" : null,
  signer_name: byKey(key)!.display_name,
  signer_title: byKey(key)!.job_title,
  signed_at: at(daysBack, role === "approver" ? "15:10" : "11:20"),
});

const POLICIES: Pol[] = [];
const VERSIONS: Ver[] = [];
const ACKS = new Map<string, Map<string, Ack>>();

function policy(n: number, kind: PolicyKind, title: string): Pol {
  const p: Pol = { policy_id: sid(`policy-${n}`), number: `POL-${String(n).padStart(4, "0")}`, kind, title, status: "active", updated_at: at(2, "11:20") };
  POLICIES.push(p);
  return p;
}
function version(p: Pol, n: number, daysBack: number, by: string, note: string, over: Partial<Ver>): Ver {
  const v: Ver = {
    id: sid(`${p.policy_id}-v${n}`),
    policy_id: p.policy_id,
    status: "published",
    version: n,
    effective_from: isoDaysAgo(daysBack),
    note,
    title: p.title,
    blocks: null,
    rules: null,
    applies_to: EVERYONE,
    needs_acknowledgement: true,
    acknowledge_within_days: 7,
    needs_approval: false,
    published_at: at(daysBack + 2, "11:20"),
    published_by: by,
    submitted_at: null,
    submitted_by: null,
    withdrawn_at: null,
    withdraw_reason: null,
    updated_at: at(daysBack + 2, "11:20"),
    updated_by: by,
    signatures: [signed(by, daysBack + 2)],
    ...over,
  };
  VERSIONS.push(v);
  return v;
}
/** Everyone asked acknowledged, but those left out. */
function acked(v: Ver, daysBack: number, except: string[] = []) {
  ACKS.set(v.id, new Map(asked(v).filter((p) => !except.includes(p.user_key)).map((p) => [p.user_key, { acknowledged_at: at(daysBack, "09:02"), reminded_at: null, deferred_on: null }])));
}

/* The Attendance policy: version 2 in force (10 minutes' grace, devices flagged), as the clock expects. */
const ATTENDANCE = policy(1, "attendance", "Attendance Policy");
const att1 = version(ATTENDANCE, 1, 140, "ifeoma", "First written attendance policy.", { rules: { ...DEFAULT_RULES, grace_minutes: 15, home_radius_m: 100 } });
const att2 = version(ATTENDANCE, 2, 6, "cynthia", "Grace is now 10 minutes, and unregistered devices are flagged for review.", {
  rules: { ...DEFAULT_RULES, grace_minutes: 10, device_mode: "warn", home_radius_m: 150 },
});

const HANDBOOK = policy(2, "document", "Employee Handbook");
const hb1 = version(HANDBOOK, 1, 200, "ifeoma", "The handbook every member of staff receives.", {
  blocks: [H("Welcome"), P("This handbook sets out how we work at MyCity."), H("Working Hours"), P("The working week runs Monday to Saturday. Monday to Friday is 09:00 to 17:00; Saturday is 09:00 to 15:00."), H("Leave"), L(false, "Annual leave is 20 working days.", "Ask your line manager before you book travel.")],
});

const IT = policy(3, "document", "IT Equipment");
const it1 = version(IT, 1, 60, "cynthia", "Laptops and phones issued to Engineering and Studio.", {
  applies_to: { everyone: false, department_ids: [deptId("Engineering"), deptId("Studio")], work_patterns: [], employee_ids: [] },
  blocks: [H("Company Equipment"), P("Laptops and phones issued by MyCity remain company property."), H("When You Leave", 3), L(true, "Return your laptop and charger on your last day.", "Return your access card to the front desk.")],
});

const REMOTE = policy(4, "document", "Remote and Hybrid Working");
const rw1 = version(REMOTE, 1, 90, "cynthia", "Working away from the office.", {
  applies_to: { everyone: false, department_ids: [], work_patterns: ["remote", "hybrid"], employee_ids: [] },
  needs_approval: true,
  signatures: [signed("cynthia", 92), signed("ifeoma", 92, "approver")],
  blocks: [H("Your Workplace"), P("Work from your approved home on your home days."), P("Keep your camera on for team meetings.")],
});
/* A change waiting on the CEO. */
VERSIONS.push({
  ...rw1,
  id: sid(`${REMOTE.policy_id}-submitted`),
  status: "submitted",
  version: null,
  effective_from: isoDaysAhead(3),
  note: "Home days are now agreed with your line manager each month.",
  published_at: null,
  published_by: null,
  submitted_at: at(1, "10:05"),
  submitted_by: "cynthia",
  updated_at: at(1, "10:05"),
  updated_by: "cynthia",
  signatures: [signed("cynthia", 1)],
  blocks: [H("Your Workplace"), P("Work from your approved home on your home days."), P("Agree your home days with your line manager each month."), P("Keep your camera on for team meetings.")],
});

const DATA = policy(5, "document", "Data Protection");
const dp1 = version(DATA, 1, 120, "ifeoma", "How MyCity handles personal data under the NDPA.", {
  blocks: [H("Personal Data"), P("We collect only what we need to employ you and pay you.")],
});
const dp2 = version(DATA, 2, 1, "cynthia", "Who to contact about your data, and how fast we answer.", {
  blocks: [H("Personal Data"), P("We collect only what we need to employ you and pay you."), H("Your Questions"), P("Write to people@mycityapp.io. We answer within five working days.")],
});

/* A draft People are still writing. */
const DRESS = policy(6, "document", "Dress Code");
VERSIONS.push({
  ...version(DRESS, 1, 0, "cynthia", "", {}),
  id: sid(`${DRESS.policy_id}-draft`),
  status: "draft",
  version: null,
  effective_from: null,
  note: null,
  published_at: null,
  published_by: null,
  signatures: [],
  blocks: [P("smart casual monday to thursday"), P("friday is casual")],
});
VERSIONS.splice(VERSIONS.findIndex((v) => v.policy_id === DRESS.policy_id && v.status === "published"), 1);

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */
function asked(v: Ver, today = todayIso()): MockPerson[] {
  const a = v.applies_to;
  return PEOPLE.filter(
    (p) =>
      p.status !== "suspended" &&
      p.start_date <= today &&
      (a.everyone || a.department_ids.includes(deptId(p.department)) || a.work_patterns.includes(p.work_pattern) || a.employee_ids.includes(p.employee_id)),
  );
}
acked(att1, 135);
acked(att2, 5, ["chidera", "tunde"]);
acked(hb1, 190);
acked(it1, 55);
acked(rw1, 85);
acked(dp1, 110);
acked(dp2, 0, ["chidera", "ngozi"]);

const polOf = (id: string) => POLICIES.find((p) => p.policy_id === id);
const versionsOf = (policyId: string) => VERSIONS.filter((v) => v.policy_id === policyId);
const published = (policyId: string) => versionsOf(policyId).filter((v) => v.status === "published").sort((a, b) => b.version! - a.version!);
const newest = (policyId: string) => published(policyId)[0] ?? null;
const working = (policyId: string, status: "draft" | "submitted") => versionsOf(policyId).find((v) => v.status === status) ?? null;
function inForce(policyId: string, date = todayIso()) {
  return published(policyId).filter((v) => v.effective_from! <= date).sort((a, b) => b.effective_from!.localeCompare(a.effective_from!) || b.version! - a.version!)[0] ?? null;
}
const previous = (v: Ver) => published(v.policy_id).find((x) => x.version! < (v.version ?? Infinity)) ?? null;

function stateOf(v: Ver, today = todayIso()): VersionState {
  if (v.status === "submitted") return "awaiting_approval";
  if (v.status === "withdrawn") return "withdrawn";
  if (v.effective_from! > today) return "waiting";
  return v.id === inForce(v.policy_id, today)?.id ? "in_force" : "past";
}
function policyState(p: Pol): PolicyState {
  if (p.status === "archived") return "archived";
  if (working(p.policy_id, "submitted")) return "awaiting_approval";
  if (inForce(p.policy_id)) return "in_force";
  if (newest(p.policy_id)) return "waiting";
  return "draft";
}

function appliesText(a: AppliesTo): string {
  if (a.everyone) return "Everyone";
  const PATTERN: Record<string, string> = { on_site: "On-Site staff", hybrid: "Hybrid staff", remote: "Remote staff" };
  const parts = [
    ...a.department_ids.map((id) => ["Executive", "Operations & People", "Marketing & Sales", "Content", "Finance", "Engineering", "Support", "Studio"].find((d) => deptId(d) === id) ?? "A department"),
    ...a.work_patterns.map((w) => PATTERN[w]),
  ];
  const people = a.employee_ids.map((id) => PEOPLE.find((p) => p.employee_id === id)?.display_name ?? "1 person");
  if (people.length === 1) parts.push(people[0]);
  else if (people.length > 1) parts.push(`${people.length} people`);
  if (!parts.length) return "Nobody yet";
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
const sameSet = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();
function changesOf(kind: PolicyKind, prev: Ver | null, next: Ver): { changed: string[]; change_lines: string[] } {
  if (!prev) return { changed: [], change_lines: [] };
  const changed: string[] = [];
  const lines: string[] = [];
  if (prev.title !== next.title) {
    changed.push("title");
    lines.push(`Title: ${prev.title} to ${next.title}`);
  }
  const a = prev.applies_to;
  const b = next.applies_to;
  if (a.everyone !== b.everyone || !sameSet(a.department_ids, b.department_ids) || !sameSet(a.work_patterns, b.work_patterns) || !sameSet(a.employee_ids, b.employee_ids)) {
    changed.push("applies_to");
    lines.push(`Applies To: ${appliesText(a)} to ${appliesText(b)}`);
  }
  if (kind === "attendance") {
    for (const k of changedRules(prev.rules, next.rules!)) {
      changed.push(k);
      lines.push(`${RULE_LABEL[k]}: ${ruleValue(k, prev.rules!)} to ${ruleValue(k, next.rules!)}`);
    }
  } else if (wordsOf(prev.blocks ?? []) !== wordsOf(next.blocks ?? [])) {
    changed.push("text");
    lines.push("The text changed");
  }
  return { changed, change_lines: lines.slice(0, 5) };
}

const dueOn = (v: Ver, p: MockPerson) => {
  const from = [v.published_at!.slice(0, 10), p.start_date].sort().pop()!;
  const d = new Date(`${from}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + v.acknowledge_within_days);
  return d.toISOString().slice(0, 10);
};
const ackOf = (v: Ver, key: string) => ACKS.get(v.id)?.get(key) ?? null;

function content(v: Ver, today = todayIso()) {
  const pol = polOf(v.policy_id)!;
  const change = changesOf(pol.kind, v.status === "submitted" ? newest(v.policy_id) : previous(v), v);
  const rules = pol.kind === "attendance" ? attendanceContract.AttendanceRules.parse(v.rules ?? {}) : null;
  return {
    policy_version_id: v.id,
    policy_id: v.policy_id,
    number: pol.number,
    kind: pol.kind,
    version: v.version,
    state: stateOf(v, today),
    effective_from: v.effective_from!,
    note: v.note ?? "",
    title: v.title,
    applies_to: v.applies_to,
    applies_to_text: appliesText(v.applies_to),
    needs_acknowledgement: v.needs_acknowledgement,
    acknowledge_within_days: v.acknowledge_within_days,
    body: pol.kind === "document" ? (v.blocks ?? []) : null,
    rules,
    sections: rules ? sectionsOf(rules, change.changed) : null,
    changed: change.changed,
    change_lines: change.change_lines,
    published_at: v.published_at,
    signatures: v.signatures,
  };
}
function asVersion(v: Ver): PolicyVersion {
  const people = asked(v);
  const acks = ACKS.get(v.id) ?? new Map<string, Ack>();
  const today = todayIso();
  return {
    ...content(v),
    published_by_name: v.published_by ? byKey(v.published_by)!.display_name : null,
    withdrawn_at: v.withdrawn_at,
    withdraw_reason: v.withdraw_reason,
    content_hash: `mock-${v.id.slice(0, 8)}`,
    asked: people.length,
    acknowledged: people.filter((p) => acks.get(p.user_key)?.acknowledged_at).length,
    overdue: people.filter((p) => !acks.get(p.user_key)?.acknowledged_at && dueOn(v, p) < today).length,
  };
}

const canManage = (u: string) => ["operations", "ceo"].includes(SIGN_INS[u]?.view ?? "");
const isCeo = (u: string) => SIGN_INS[u]?.view === "ceo";
const forbidden = () => fail(403, "FORBIDDEN", "You do not have access to this.");

function overview(p: Pol): Policy {
  const today = todayIso();
  const top = newest(p.policy_id);
  const now = inForce(p.policy_id, today);
  const waiting = top && top.effective_from! > today ? top : null;
  const d = working(p.policy_id, "draft");
  const s = working(p.policy_id, "submitted");
  const draft: PolicyDraft | null = d
    ? {
        policy_version_id: d.id,
        title: d.title,
        applies_to: d.applies_to,
        applies_to_people: d.applies_to.employee_ids.map((id) => ref(PEOPLE.find((x) => x.employee_id === id))!).filter(Boolean),
        needs_acknowledgement: d.needs_acknowledgement,
        acknowledge_within_days: d.acknowledge_within_days,
        needs_approval: d.needs_approval,
        body_html: p.kind === "document" ? htmlOf(d.blocks ?? []) : null,
        rules: p.kind === "attendance" ? attendanceContract.AttendanceRules.parse(d.rules ?? {}) : null,
        ...changesOf(p.kind, top, d),
        updated_at: d.updated_at,
        updated_by_name: d.updated_by ? byKey(d.updated_by)!.display_name : null,
      }
    : null;
  return {
    policy_id: p.policy_id,
    number: p.number,
    kind: p.kind,
    title: p.title,
    state: policyState(p),
    today,
    current_rules: p.kind === "attendance" ? attendanceContract.AttendanceRules.parse(now?.rules ?? {}) : null,
    suggested_rules: p.kind === "attendance" ? { ...DEFAULT_RULES, grace_minutes: 5, device_mode: "warn" } : null,
    in_force: now ? asVersion(now) : null,
    waiting: waiting ? asVersion(waiting) : null,
    draft,
    submission: s
      ? {
          policy_version_id: s.id,
          effective_from: s.effective_from!,
          note: s.note ?? "",
          submitted_at: s.submitted_at!,
          submitted_by_name: s.submitted_by ? byKey(s.submitted_by)!.display_name : null,
          stage_name: "CEO",
          workflow_instance_id: sid(`${s.id}-approval`),
        }
      : null,
    can_edit: p.status === "active",
    can_archive: p.status === "active" && p.kind === "document",
  };
}

/** The rules the clock judges a punch by today: the Attendance policy's version in force. */
export function attendanceRulesInForce(): AttendanceRules {
  return attendanceContract.AttendanceRules.parse(inForce(ATTENDANCE.policy_id)?.rules ?? {});
}

function refused(issues: Array<{ path: PropertyKey[]; message: string }>) {
  const fields: Record<string, string[]> = {};
  for (const i of issues) fields[i.path.map(String).join(".") || "_"] ??= [i.message];
  return invalid(fields);
}
const touch = (p: Pol) => (p.updated_at = new Date().toISOString());

/* ------------------------------------------------------------------ *
 * People who write policies
 * ------------------------------------------------------------------ */
route("GET /api/v1/policies", (req) => {
  if (!canManage(req.user!)) return forbidden();
  const rows: PolicyRow[] = POLICIES.map((p) => {
    const top = newest(p.policy_id);
    const shown = top ?? working(p.policy_id, "submitted") ?? working(p.policy_id, "draft");
    const v = top ? asVersion(top) : null;
    return {
      policy_id: p.policy_id,
      number: p.number,
      kind: p.kind,
      title: p.title,
      state: policyState(p),
      applies_to_text: shown ? appliesText(shown.applies_to) : "Everyone",
      version_in_force: inForce(p.policy_id)?.version ?? null,
      asked: v?.asked ?? 0,
      acknowledged: v?.acknowledged ?? 0,
      updated_at: p.updated_at,
    };
  });
  return paged(rows, req, {
    search: (r) => [r.title, r.number],
    filters: { kind: (r, x) => r.kind === x, state: (r, x) => r.state === x },
    sort: {
      title: (a, b) => a.title.localeCompare(b.title),
      number: (a, b) => a.number.localeCompare(b.number),
      updated_at: (a, b) => (a.updated_at ?? "").localeCompare(b.updated_at ?? ""),
    },
  });
});

route("POST /api/v1/policies", (req) => {
  if (!canManage(req.user!)) return forbidden();
  const body = policiesContract.PolicyCreate.safeParse(req.body);
  if (!body.success) return refused(body.error.issues);
  const p = policy(POLICIES.length + 1, "document", body.data.title);
  VERSIONS.push({
    ...version(p, 0, 0, req.user!, "", {}),
    id: sid(`${p.policy_id}-draft-${Date.now()}`),
    status: "draft",
    version: null,
    effective_from: null,
    note: null,
    published_at: null,
    published_by: null,
    signatures: [],
    blocks: [],
    ...body.data,
  });
  VERSIONS.splice(VERSIONS.findIndex((v) => v.policy_id === p.policy_id && v.status === "published"), 1);
  audit(byKey(req.user)!.display_name, "Policy created", p.title, null, p.number, null, "Knowledge Hub");
  return created(overview(p));
});

route("POST /api/v1/policies/tidy", (req) => {
  if (!canManage(req.user!)) return forbidden();
  const body = policiesContract.PolicyTidy.safeParse(req.body);
  if (!body.success) return refused(body.error.issues);
  // Layout only, as the real tidy promises: a short line with no full stop becomes a heading.
  const blocks = blocksOf(body.data.body_html).map((b): RichTextBlock => {
    if (b.kind !== "paragraph") return b;
    const text = b.spans.map((s) => s.text).join("").trim();
    if (text.length < 60 && !/[.:;]$/.test(text)) return { kind: "heading", level: 2, spans: plain(text.charAt(0).toUpperCase() + text.slice(1)) };
    return { kind: "paragraph", spans: plain(text.charAt(0).toUpperCase() + text.slice(1)) };
  });
  if (!blocks.length) return fail(422, "POLICY_EMPTY", "Write or paste the policy first", { body_html: ["Write the policy"] });
  return ok({ body_html: htmlOf(blocks) });
});

route("GET /api/v1/policies/versions/:id", (req) => {
  if (!canManage(req.user!)) return forbidden();
  const v = VERSIONS.find((x) => x.id === req.params.id && x.status !== "draft");
  return v ? ok(asVersion(v)) : notFound();
});

route("POST /api/v1/policies/versions/:id/withdraw", (req) => {
  if (!canManage(req.user!)) return forbidden();
  const body = policiesContract.PolicyReason.safeParse(req.body);
  if (!body.success) return refused(body.error.issues);
  const v = VERSIONS.find((x) => x.id === req.params.id);
  if (!v) return notFound();
  if (v.status !== "published" || stateOf(v) !== "waiting") return fail(409, "POLICY_NOT_WAITING", "Only a version waiting to start can be withdrawn");
  Object.assign(v, { status: "withdrawn", withdrawn_at: new Date().toISOString(), withdraw_reason: body.data.reason });
  if (!working(v.policy_id, "draft") && !working(v.policy_id, "submitted"))
    VERSIONS.push({ ...v, id: sid(`${v.policy_id}-draft-${Date.now()}`), status: "draft", version: null, effective_from: null, note: null, published_at: null, published_by: null, withdrawn_at: null, withdraw_reason: null, signatures: [] });
  touch(polOf(v.policy_id)!);
  return ok(overview(polOf(v.policy_id)!));
});

route("GET /api/v1/policies/versions/:id/acknowledgements", (req) => {
  if (!canManage(req.user!)) return forbidden();
  const v = VERSIONS.find((x) => x.id === req.params.id && (x.status === "published" || x.status === "withdrawn"));
  if (!v) return notFound();
  const today = todayIso();
  const rows: PolicyAck[] = asked(v).map((p) => {
    const a = ackOf(v, p.user_key);
    const due = dueOn(v, p);
    return {
      employee: refKey(p.user_key),
      status: a?.acknowledged_at ? "acknowledged" : due < today ? "overdue" : "pending",
      due_on: due,
      acknowledged_at: a?.acknowledged_at ?? null,
      reminded_at: a?.reminded_at ?? null,
    };
  });
  return paged(rows, req, {
    search: (r) => [r.employee.display_name],
    filters: { status: (r, x) => r.status === x },
    sort: {
      display_name: (a, b) => a.employee.display_name.localeCompare(b.employee.display_name),
      acknowledged_at: (a, b) => (a.acknowledged_at ?? "").localeCompare(b.acknowledged_at ?? ""),
    },
  });
});

route("POST /api/v1/policies/versions/:id/pdf", (req) => {
  if (!canManage(req.user!)) return forbidden();
  const v = VERSIONS.find((x) => x.id === req.params.id && (x.status === "published" || x.status === "withdrawn"));
  return v ? exportFile(req.user!, `${polOf(v.policy_id)!.number}-v${v.version}`, "pdf") : notFound();
});

route("GET /api/v1/policies/:id", (req) => {
  if (!canManage(req.user!)) return forbidden();
  const p = polOf(req.params.id);
  return p ? ok(overview(p)) : notFound();
});

route("PUT /api/v1/policies/:id/draft", (req) => {
  if (!canManage(req.user!)) return forbidden();
  const p = polOf(req.params.id);
  if (!p) return notFound();
  const body = policiesContract.PolicyDraftSave.safeParse(req.body);
  if (!body.success) return refused(body.error.issues);
  if (p.status !== "active") return fail(409, "POLICY_ARCHIVED", "This policy is archived");
  if (working(p.policy_id, "submitted")) return fail(409, "POLICY_SUBMITTED", "Recall the version waiting for approval first");
  if (p.kind === "attendance" && !body.data.rules) return fail(422, "RULES_REQUIRED", "Set the rules", { rules: ["Set the rules"] });
  const { body_html: html, rules, ...settings } = body.data;
  const fields = { ...settings, blocks: p.kind === "document" ? blocksOf(html ?? "") : null, rules: p.kind === "attendance" ? (rules as AttendanceRules) : null, updated_at: new Date().toISOString(), updated_by: req.user! };
  const d = working(p.policy_id, "draft");
  if (d) Object.assign(d, fields);
  else
    VERSIONS.push({
      ...(newest(p.policy_id) ?? version(p, 0, 0, req.user!, "", {})),
      ...fields,
      id: sid(`${p.policy_id}-draft-${Date.now()}`),
      status: "draft",
      version: null,
      effective_from: null,
      note: null,
      published_at: null,
      published_by: null,
      withdrawn_at: null,
      withdraw_reason: null,
      signatures: [],
    });
  const stray = VERSIONS.findIndex((v) => v.policy_id === p.policy_id && v.version === 0);
  if (stray >= 0) VERSIONS.splice(stray, 1);
  touch(p);
  return ok(overview(p));
});

route("POST /api/v1/policies/:id/draft/discard", (req) => {
  if (!canManage(req.user!)) return forbidden();
  const p = polOf(req.params.id);
  if (!p) return notFound();
  const d = working(p.policy_id, "draft");
  if (!d) return fail(409, "NO_DRAFT", "There is no draft");
  VERSIONS.splice(VERSIONS.indexOf(d), 1);
  return ok(overview(p));
});

/** The first day's checks and a ready draft, as the API makes them (guide §6.3). */
function readyToSend(p: Pol, from: string): { d: Ver } | { error: ReturnType<typeof fail> } {
  const today = todayIso();
  const d = working(p.policy_id, "draft");
  if (!d) return { error: fail(409, "NO_DRAFT", "Save the changes as a draft first") };
  if (p.kind === "document" && !wordsOf(d.blocks ?? []).trim()) return { error: fail(422, "POLICY_EMPTY", "Write the policy first", { body_html: ["Write the policy"] }) };
  const top = newest(p.policy_id);
  if (top && changesOf(p.kind, top, d).changed.length === 0) return { error: fail(409, "NO_CHANGES", "The draft changes nothing") };
  if (from < today) return { error: fail(422, "POLICY_IN_THE_PAST", "The first day is today or later.", { effective_from: ["Today or later"] }) };
  if (from > isoDaysAhead(90)) return { error: fail(422, "POLICY_TOO_FAR", "The first day is within 90 days.", { effective_from: ["Within 90 days"] }) };
  const waiting = published(p.policy_id).filter((v) => v.effective_from! > today).map((v) => v.effective_from!).sort().pop();
  if (waiting && from <= waiting) return { error: fail(422, "POLICY_BEFORE_WAITING", "Start it after the version waiting to start.", { effective_from: ["After the waiting version"] }) };
  return { d };
}

route("POST /api/v1/policies/:id/publish", (req) => {
  if (!canManage(req.user!)) return forbidden();
  const p = polOf(req.params.id);
  if (!p) return notFound();
  const body = policiesContract.PolicyPublish.safeParse(req.body);
  if (!body.success) return refused(body.error.issues);
  const ready = readyToSend(p, body.data.effective_from);
  if ("error" in ready) return ready.error;
  if (ready.d.needs_approval) return fail(409, "POLICY_NEEDS_APPROVAL", "This policy needs approval: submit it");
  const n = Math.max(0, ...versionsOf(p.policy_id).map((v) => v.version ?? 0)) + 1;
  Object.assign(ready.d, {
    status: "published",
    version: n,
    effective_from: body.data.effective_from,
    note: body.data.note,
    published_at: new Date().toISOString(),
    published_by: req.user!,
    signatures: [{ ...signed(req.user!, 0), signed_at: new Date().toISOString() }],
  });
  ACKS.set(ready.d.id, new Map());
  p.title = ready.d.title;
  touch(p);
  audit(byKey(req.user)!.display_name, "Policy published", p.title, null, `Version ${n}`, body.data.note, "Knowledge Hub");
  return ok(overview(p));
});

route("POST /api/v1/policies/:id/submit", (req) => {
  if (!canManage(req.user!)) return forbidden();
  const p = polOf(req.params.id);
  if (!p) return notFound();
  const body = policiesContract.PolicyPublish.safeParse(req.body);
  if (!body.success) return refused(body.error.issues);
  if (working(p.policy_id, "submitted")) return fail(409, "POLICY_SUBMITTED", "A version is already waiting for approval");
  const ready = readyToSend(p, body.data.effective_from);
  if ("error" in ready) return ready.error;
  if (!ready.d.needs_approval) return fail(409, "POLICY_NO_APPROVAL", "This policy needs no approval: publish it");
  Object.assign(ready.d, {
    status: "submitted",
    effective_from: body.data.effective_from,
    note: body.data.note,
    submitted_at: new Date().toISOString(),
    submitted_by: req.user!,
    signatures: [{ ...signed(req.user!, 0), signed_at: new Date().toISOString() }],
  });
  touch(p);
  return ok(overview(p));
});

route("POST /api/v1/policies/:id/recall", (req) => {
  if (!canManage(req.user!)) return forbidden();
  const p = polOf(req.params.id);
  if (!p) return notFound();
  const body = policiesContract.PolicyReason.safeParse(req.body);
  if (!body.success) return refused(body.error.issues);
  const s = working(p.policy_id, "submitted");
  if (!s) return fail(409, "NOT_SUBMITTED", "Nothing is waiting for approval");
  Object.assign(s, { status: "draft", submitted_at: null, submitted_by: null, signatures: [] });
  return ok(overview(p));
});

route("POST /api/v1/policies/:id/archive", (req) => {
  if (!canManage(req.user!)) return forbidden();
  const p = polOf(req.params.id);
  if (!p) return notFound();
  const body = policiesContract.PolicyReason.safeParse(req.body);
  if (!body.success) return refused(body.error.issues);
  if (p.kind !== "document") return fail(422, "CANNOT_ARCHIVE", "A rules policy always applies; change its rules instead");
  if (p.status === "archived") return fail(409, "POLICY_ARCHIVED", "This policy is already archived");
  p.status = "archived";
  touch(p);
  return ok(overview(p));
});

route("GET /api/v1/policies/:id/versions", (req) => {
  if (!canManage(req.user!)) return forbidden();
  const p = polOf(req.params.id);
  if (!p) return notFound();
  const rows = versionsOf(p.policy_id)
    .filter((v) => v.status === "published" || v.status === "withdrawn")
    .sort((a, b) => b.version! - a.version!)
    .map(asVersion);
  return paged(rows, req, { filters: { state: (v, x) => v.state === x } });
});

/* ------------------------------------------------------------------ *
 * The person's own
 * ------------------------------------------------------------------ */
const live = () => POLICIES.filter((p) => p.status === "active");
const waitsOn = (v: Ver, user: string) => v.status === "submitted" && isCeo(user);

function owed(user: string, today = todayIso()) {
  const me = byKey(user);
  if (!me) return [];
  return live()
    .map((p) => newest(p.policy_id))
    .filter((v): v is Ver => !!v && v.needs_acknowledgement && asked(v, today).some((x) => x.user_key === user) && !ackOf(v, user)?.acknowledged_at)
    .map((v) => ({ v, due: dueOn(v, me) }))
    .sort((a, b) => a.due.localeCompare(b.due));
}

function myRow(v: Ver, user: string): MyPolicyRow {
  const me = byKey(user)!;
  const ack = ackOf(v, user);
  const isNewest = newest(v.policy_id)?.id === v.id;
  const toAck = isNewest && v.needs_acknowledgement && !ack?.acknowledged_at && v.status === "published";
  const due = toAck ? dueOn(v, me) : null;
  return {
    policy_version_id: v.id,
    policy_id: v.policy_id,
    number: polOf(v.policy_id)!.number,
    kind: polOf(v.policy_id)!.kind,
    title: v.title,
    version: v.version,
    state: stateOf(v),
    effective_from: v.effective_from!,
    needs_acknowledgement: v.needs_acknowledgement,
    due_on: due,
    acknowledged_at: ack?.acknowledged_at ?? null,
    to_acknowledge: toAck,
    overdue: !!due && due < todayIso(),
    waiting_on_me: waitsOn(v, user),
  };
}

function mayRead(v: Ver, user: string) {
  if (v.status === "submitted") return waitsOn(v, user);
  const top = newest(v.policy_id);
  return polOf(v.policy_id)!.status === "active" && !!top && asked(top).some((p) => p.user_key === user);
}

function myVersion(v: Ver, user: string): MyPolicyVersion {
  const c = content(v);
  const me = byKey(user)!;
  const owedRow = owed(user).find((o) => o.v.id === v.id);
  return {
    ...c,
    due_on: owedRow ? owedRow.due : null,
    acknowledged_at: ackOf(v, user)?.acknowledged_at ?? null,
    can_acknowledge: !!owedRow,
    can_later: !!owedRow && dueOn(v, me) >= todayIso(),
    approval: waitsOn(v, user) ? { stage_name: "CEO", waiting_on_me: true } : null,
    earlier: published(v.policy_id)
      .filter((x) => x.id !== v.id)
      .map((x) => ({ policy_version_id: x.id, version: x.version!, effective_from: x.effective_from!, state: stateOf(x) })),
  };
}

function due(user: string): MyPolicyDue {
  const today = todayIso();
  return {
    items: owed(user)
      .filter(({ v, due: d }) => d < today || ackOf(v, user)?.deferred_on !== today)
      .map(({ v, due: d }) => ({
        policy_version_id: v.id,
        title: v.title,
        version: v.version!,
        first: v.version === 1,
        change_lines: content(v).change_lines,
        due_on: d,
        overdue: d < today,
        can_later: d >= today,
      })),
  };
}

route("GET /api/v1/policies/me", (req) => {
  const user = req.user!;
  const rows = [
    ...live().map((p) => newest(p.policy_id)).filter((v): v is Ver => !!v && asked(v).some((x) => x.user_key === user)),
    ...VERSIONS.filter((v) => waitsOn(v, user)),
  ].map((v) => myRow(v, user));
  return paged(rows, req, {
    search: (r) => [r.title, r.number],
    filters: {
      state: (r, x) => (x === "to_acknowledge" ? r.to_acknowledge : x === "waiting_on_me" ? r.waiting_on_me : true),
    },
  });
});

route("GET /api/v1/policies/me/due", (req) => ok(due(req.user!)));

route("GET /api/v1/policies/me/versions/:id", (req) => {
  const v = VERSIONS.find((x) => x.id === req.params.id && x.status !== "draft");
  return v && mayRead(v, req.user!) ? ok(myVersion(v, req.user!)) : notFound();
});

route("POST /api/v1/policies/me/versions/:id/acknowledge", (req) => {
  const user = req.user!;
  const v = VERSIONS.find((x) => x.id === req.params.id && x.status === "published");
  if (!v || !asked(v).some((p) => p.user_key === user)) return notFound();
  if (newest(v.policy_id)?.id !== v.id) return fail(409, "POLICY_NOT_LATEST", "Acknowledge the newest version of the policy");
  const acks = ACKS.get(v.id) ?? new Map<string, Ack>();
  ACKS.set(v.id, acks);
  const mine = acks.get(user);
  if (!mine?.acknowledged_at) acks.set(user, { acknowledged_at: new Date().toISOString(), reminded_at: mine?.reminded_at ?? null, deferred_on: mine?.deferred_on ?? null });
  return ok(myVersion(v, user));
});

route("POST /api/v1/policies/me/versions/:id/later", (req) => {
  const user = req.user!;
  const o = owed(user).find((x) => x.v.id === req.params.id);
  if (!o) return notFound();
  if (o.due < todayIso()) return fail(409, "ACKNOWLEDGEMENT_OVERDUE", "This policy is past its due date: acknowledge it now");
  const acks = ACKS.get(o.v.id) ?? new Map<string, Ack>();
  ACKS.set(o.v.id, acks);
  acks.set(user, { acknowledged_at: null, reminded_at: acks.get(user)?.reminded_at ?? null, deferred_on: todayIso() });
  return ok(due(user));
});

route("POST /api/v1/policies/me/versions/:id/pdf", (req) => {
  const v = VERSIONS.find((x) => x.id === req.params.id && x.status === "published");
  return v && mayRead(v, req.user!) ? exportFile(req.user!, `${polOf(v.policy_id)!.number}-v${v.version}`, "pdf") : notFound();
});

route("POST /api/v1/policies/me/versions/:id/approve", (req) => {
  const body = policiesContract.PolicyApprove.safeParse(req.body);
  if (!body.success) return refused(body.error.issues);
  const v = VERSIONS.find((x) => x.id === req.params.id && x.status === "submitted");
  if (!v) return notFound();
  if (!waitsOn(v, req.user!)) return fail(403, "PERMISSION_DENIED", "This version is not waiting on you");
  const p = polOf(v.policy_id)!;
  const today = todayIso();
  const n = Math.max(0, ...versionsOf(p.policy_id).map((x) => x.version ?? 0)) + 1;
  Object.assign(v, {
    status: "published",
    version: n,
    effective_from: v.effective_from! < today ? today : v.effective_from,
    published_at: new Date().toISOString(),
    published_by: v.submitted_by,
    signatures: [...v.signatures, { ...signed(req.user!, 0, "approver"), signed_at: new Date().toISOString() }],
  });
  ACKS.set(v.id, new Map());
  p.title = v.title;
  touch(p);
  return noContent();
});

route("POST /api/v1/policies/me/versions/:id/reject", (req) => {
  const body = policiesContract.PolicyReason.safeParse(req.body);
  if (!body.success) return refused(body.error.issues);
  const v = VERSIONS.find((x) => x.id === req.params.id && x.status === "submitted");
  if (!v) return notFound();
  if (!waitsOn(v, req.user!)) return fail(403, "PERMISSION_DENIED", "This version is not waiting on you");
  Object.assign(v, { status: "draft", submitted_at: null, submitted_by: null, signatures: [] });
  return noContent();
});
