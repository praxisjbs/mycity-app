import type { Article, Block, Faq, Overdue, Resource } from "@/api/types/knowledge";
import type { Status } from "@/api/types/performance";
import { created, invalid, isoDaysAgo, isoDaysAhead, notFound, ok, paged, route, sid, fail } from "../core";
import { refKey, SIGN_INS } from "../data/people";

const S = (tone: Status["tone"], text: string): Status => ({ tone, text });
const P = (text: string): Block => ({ type: "p", text });
const H = (text: string): Block => ({ type: "h", text });
const L = (...items: string[]): Block => ({ type: "ul", items });
const Qt = (text: string): Block => ({ type: "quote", text });
const canWrite = (u: string) => ["operations", "ceo"].includes(SIGN_INS[u]?.view ?? "");

const ATTENDANCE: Block[] = [
  H("Working hours"), P("The working week runs Monday to Saturday. Monday to Friday is 09:00 to 17:00. Saturday is 09:00 to 15:00. Sunday is not a working day."), P("Each day is configured separately in the system, so a change to Saturday hours does not require a change to any other day."),
  H("The grace window"), P("A clock-in shortly after the start of the day is on time. The window is set in the attendance policy, and the system records by how much a late arrival was late."), Qt("The grace window is a setting. If MyCity changes it, nothing is rebuilt and nothing is deployed."),
  H("Where you clock in"), P("Office days are at your assigned office, within 100 metres. Remote days are at your registered or approved temporary home, within a fixed 100 metres. Field days are at approved assignment sites."), P("Location is read only when you clock in or out, never tracked."),
  H("Lateness, and what follows"), L("A single late arrival is recorded and nothing else happens.", "Three late arrivals in a rolling thirty days raises a query automatically.", "The query is a question, not a punishment. You have forty-eight hours to answer it.", "Your answer is read before any decision, and stays on the record alongside it."),
  H("Deductions"), P("Where a decision results in a deduction, the tiers are ten percent of the day up to one hour, twenty percent up to two hours, and thirty percent up to three hours. Beyond three hours is treated as absence by decision, not automatically."), P("No deduction ever enters a payroll run by itself. Finance or Operations has to accept it."),
];
const EXPENSE: Block[] = [
  P("An expense request is a claim for money the company will pay out, either to a vendor or back to you."),
  H("Before you start"), L("The vendor invoice, as a file. The upload engine compresses it on the way up, so a phone photograph is fine.", "The beneficiary bank and account number.", "Which category it belongs to."),
  H("The steps"), L("Open **Expenses**, then **My Requests**, then **New Request**.", "Describe it in a sentence. “Partner dinner, ProvidusBank” is enough. “Misc” is not.", "Enter the amount in Naira. There is no other currency anywhere in this system.", "Pick the category, attach the invoice and enter the account details.", "Submit. It goes to your line manager first."),
  H("What happens next"), P("Your line manager approves, then Operations. Operations groups approved requests into a requisition, so the CEO approves one number rather than five."), Qt("You can see exactly where your request is at any time, and how long it has been sitting there. So can the approver."),
  H("If it is rejected"), P("You are told, with the reason. A rejected request can be corrected and resubmitted, and keeps its history."),
];
const stub = (title: string): Block[] => [P(`${title}. The full text is kept here and versioned; staff are notified when it changes.`), H("Who it applies to"), P("Every member of staff, from their first day."), H("Who owns it"), P("Operations and People. Questions go to Cynthia Osakunih.")];

type A = Article;
const ART: A[] = [
  ["policy", "Current", "Employee handbook", 3, 40, stub("The employee handbook"), "ok"],
  ["policy", "Current", "Attendance and punctuality", 4, 14, ATTENDANCE, "ok"],
  ["policy", "Current", "Data protection, NDPA", 2, 60, stub("How MyCity handles personal data under the NDPA"), "ok"],
  ["policy", "Current", "Expense and procurement", 2, 25, stub("How MyCity spends money"), "ok"],
  ["policy", "Current", "Disciplinary procedure", 1, 90, stub("The disciplinary procedure"), "ok"],
  ["policy", "Current", "Remote and hybrid working", 2, 30, stub("Working away from the office"), "ok"],
  ["policy", "Archived", "Attendance policy v2", 2, 300, stub("The earlier attendance policy"), "neutral"],
  ["policy", "Archived", "Handbook v2", 2, 400, stub("The earlier handbook"), "neutral"],
  ["sop", "Attendance", "How do I clock in from home?", 1, 20, stub("Clocking in from an approved home"), "ok"],
  ["sop", "Attendance", "How do I fix a missing clock-out?", 1, 18, stub("Fixing a missing clock-out"), "ok"],
  ["sop", "Money", "How do I raise an expense?", 2, 9, EXPENSE, "ok"],
  ["sop", "Money", "How do I log a disbursement?", 1, 22, stub("Logging a disbursement with its bank reference"), "ok"],
  ["sop", "People", "How do I respond to a query?", 1, 33, stub("Responding to a query within 24 hours"), "ok"],
  ["sop", "People", "How do I set my team’s KPIs?", 1, 27, stub("Setting KPIs that total 100%"), "ok"],
  ["sop", "Recruitment", "How do I publish a vacancy?", 1, 40, stub("Publishing a vacancy to the careers page"), "ok"],
  ["sop", "Data", "How do I import a tracker?", 1, 50, stub("Importing a spreadsheet tracker"), "ok"],
].map((a, i) => ({ article_id: sid(`art:${i}`), kind: a[0] as A["kind"], group: a[1] as string, title: a[2] as string, version: a[3] as number, updated_on: isoDaysAgo(a[4] as number), blocks: a[5] as Block[], status: a[6] === "ok" ? S("ok", "Current") : S("neutral", "Archived"), owner: "Operations", read_minutes: Math.max(1, Math.round((a[5] as Block[]).reduce((n, b) => n + ("text" in b ? b.text.length : b.items.join(" ").length), 0) / 900)) }));

route("GET /api/v1/knowledge/articles/summary", (req) => {
  const list = ART.filter((a) => a.kind === req.query.kind);
  const cur = list.filter((a) => a.status.text === "Current");
  return ok({ current: cur.length, archived: list.length - cur.length, groups: new Set(list.map((a) => a.group)).size, read_this_month: req.query.kind === "sop" ? 142 : 88, average_minutes: Math.round(cur.reduce((s, a) => s + a.read_minutes, 0) / Math.max(1, cur.length)), owner: "Operations", last_updated: cur.map((a) => a.updated_on).sort().reverse()[0] ?? null, first_id: (req.query.kind === "policy" ? cur.find((a) => a.title.startsWith("Attendance")) : cur.find((a) => a.title.includes("expense")))?.article_id ?? cur[0]?.article_id ?? null });
});
route("GET /api/v1/knowledge/articles", (req) => paged(ART.map(({ blocks, ...a }) => (void blocks, a)), req, { search: (a) => [a.title, a.group], filters: { kind: (a, v) => a.kind === v } }));
route("GET /api/v1/knowledge/articles/:id", (req) => {
  const a = ART.find((x) => x.article_id === req.params.id);
  return a ? ok(a) : notFound();
});
route("POST /api/v1/knowledge/articles", (req) => {
  if (!canWrite(req.user!)) return fail(403, "FORBIDDEN", "People and Operations publish to the Knowledge Hub.");
  const b = req.body as { kind?: string; title?: string; group?: string; blocks?: Block[] };
  const f: Record<string, string[]> = {};
  if (!b.title || b.title.trim().length < 4) f.title = ["Give it a title"];
  if (!b.group?.trim()) f.group = ["Which section it sits in"];
  if (!b.blocks?.length) f.blocks = ["Write the text"];
  if (Object.keys(f).length) return invalid(f);
  const a: A = { article_id: sid(`art:new:${ART.length}`), kind: (b.kind as A["kind"]) ?? "policy", group: b.group!.trim(), title: b.title!.trim(), version: 1, updated_on: isoDaysAgo(0), blocks: b.blocks!, status: S("ok", "Current"), owner: "Operations", read_minutes: 1 };
  ART.push(a);
  return created(a);
});

const FAQS: Faq[] = [
  ["Why was I marked late when I clocked in a few minutes after nine?", "Check the grace window in the attendance policy, and which worksite you were inside. Raise it with Operations and it can be waived.", "Attendance"],
  ["Do Saturdays count towards lateness?", "Yes. Saturday hours are 09:00 to 15:00 and the same grace window applies.", "Attendance"],
  ["When do I get my payslip?", "Payslips appear in Employee Self-Service once the run is approved and locked, normally on the 27th.", "Payroll"],
  ["Who can see a query raised against me?", "You, whoever raised it, People, and the CEO. Other managers cannot see it.", "Queries"],
  ["Can I change my bank details myself?", "Yes, in My Profile. Changes are logged and People are notified.", "Payroll"],
  ["What happens to my tasks when I go on leave?", "They stay with you. Your line manager can reassign them from the team board.", "Tasks"],
  ["Why is there no tax on my payslip?", "Advanced payroll is switched off. MyCity runs simple payroll: gross, deductions, net.", "Payroll"],
  ["Can I clock in from a new phone?", "Yes. The punch is accepted and the device is flagged for review, not blocked.", "Attendance"],
  ["Who approves my leave?", "Your line manager, in one step. The calendar shows clashes before you submit.", "Leave"],
  ["Can I carry leave into next year?", null, "Leave"],
  ["Can a query be withdrawn?", null, "Queries"],
  ["What is Praxis AI allowed to do?", "Read, within your permissions. It never writes a record.", "Attendance"],
].map((q, i) => ({ faq_id: sid(`faq:${i}`), question: q[0] as string, answer: q[1] as string | null, topic: q[2] as string }));
route("GET /api/v1/knowledge/faqs/summary", () => {
  const topics = [...new Set(FAQS.map((f) => f.topic))].map((topic) => ({ topic, count: FAQS.filter((f) => f.topic === topic).length })).sort((a, b) => b.count - a.count);
  return ok({ questions: FAQS.length, asked_this_month: 84, most_asked: "Lateness", unanswered: FAQS.filter((f) => !f.answer).length, from_ai: 31, topics });
});
route("GET /api/v1/knowledge/faqs", (req) => paged(FAQS, req, { search: (f) => [f.question, f.answer], filters: { topic: (f, v) => f.topic === v } }));
route("POST /api/v1/knowledge/faqs", (req) => {
  if (!canWrite(req.user!)) return fail(403, "FORBIDDEN", "People and Operations write FAQs.");
  const b = req.body as Record<string, string>;
  const f: Record<string, string[]> = {};
  if (!b.question || b.question.trim().length < 8) f.question = ["Write the question as staff ask it"];
  if (!b.answer || b.answer.trim().length < 8) f.answer = ["A sentence or two"];
  else if (b.answer.length > 400) f.answer = ["Longer than two sentences. Make it a policy or an SOP"];
  if (!b.topic) f.topic = ["Pick the topic"];
  if (Object.keys(f).length) return invalid(f);
  const x: Faq = { faq_id: sid(`faq:new:${FAQS.length}`), question: b.question.trim(), answer: b.answer.trim(), topic: b.topic };
  FAQS.unshift(x);
  return created(x);
});

const RES: Resource[] = [
  ["Platform walkthrough", "A 12 minute tour of the modules you will use every day.", "Video", null, 25, 23],
  ["NDPA data protection", "Annual refresher. Certificate issued on completion.", "Course", isoDaysAhead(46), 25, 19],
  ["Partnership pipeline training", "For Marketing and Sales. How stages and lead owners work.", "Document", null, 6, 4],
  ["Expense requests", "How to raise, what to attach, and how the chain works.", "Document", isoDaysAhead(16), 25, 9],
].map((r, i) => ({ resource_id: sid(`res:${i}`), title: r[0] as string, description: r[1] as string, kind: r[2] as Resource["kind"], due: r[3] as string | null, assigned: r[4] as number, completed: r[5] as number }));
const OVERDUE: Overdue[] = [["bashir", 1], ["emeka", 1], ["chidera", 1], ["tolu", 3], ["seyi", 3], ["ngozi", 3]].map(([u, r], i) => ({ key: `od:${i}`, person: refKey(u as string), resource: RES[r as number].title, due: RES[r as number].due! }));
route("GET /api/v1/knowledge/training/summary", () => {
  const a = RES.reduce((s, r) => s + r.assigned, 0);
  const c = RES.reduce((s, r) => s + r.completed, 0);
  return ok({ resources: RES.length, completion_pct: Math.round((c * 100) / Math.max(1, a)), overdue: OVERDUE.length, certificates: 19 });
});
route("GET /api/v1/knowledge/training", (req) => paged(RES, req, { search: (r) => [r.title, r.description] }));
route("GET /api/v1/knowledge/training/overdue", (req) => paged(OVERDUE, req, { search: (o) => [o.person.display_name, o.resource] }));
route("POST /api/v1/knowledge/training/overdue/remind", () => ok({ reminded: OVERDUE.length }));
route("POST /api/v1/knowledge/training", (req) => {
  if (!canWrite(req.user!)) return fail(403, "FORBIDDEN", "People and Operations assign training.");
  const b = req.body as Record<string, string>;
  const f: Record<string, string[]> = {};
  if (!b.title?.trim()) f.title = ["Name the resource"];
  if (!b.description || b.description.trim().length < 10) f.description = ["What it covers, in a sentence"];
  if (b.audience === "department" && !b.department) f.department = ["Pick the department"];
  if (Object.keys(f).length) return invalid(f);
  const r: Resource = { resource_id: sid(`res:new:${RES.length}`), title: b.title.trim(), description: b.description.trim(), kind: (b.kind as Resource["kind"]) ?? "Document", due: b.due || null, assigned: b.audience === "department" ? 6 : 25, completed: 0 };
  RES.push(r);
  return created(r);
});

