import type { AiActionCard, AiActionResult, AiAnswer, AiCitation, AiConversation, AiHistorySummary, AiQuestion, AiReadRows, AiSource } from "@mycity/contract/contract.gen.ts";
import { at, fail, invalid, noContent, ok, paged, route, sid } from "../core";
import { byKey, grantsFor, SIGN_INS } from "../data/people";
import { PARTNERS } from "../data/partners";
import { ON_UPLOAD, UPLOADS } from "../uploads";
import { exportFile } from "./shared";
import { stale } from "./security";

/* ── Praxis AI (docs/guides/praxis-ai.md): answers from the mock records, within the asker's view, in the contract's shapes. A change is a card the person confirms (§6.11); nothing else writes. ── */

type Kept = { owner: string; conversation: AiConversation; turns: AiAnswer[] };
const KEPT: Kept[] = [];
/** What each answer's run cost, as AI Control prices it: tokens in and out, and naira. */
const COSTS = new Map<string, { tokens: number; cost_ngn: string }>();

const nameOf = (key: string) => byKey(key)?.display_name ?? "";
const partnerCite = (p: (typeof PARTNERS)[number]): AiCitation => ({ entity_type: "partner", entity_id: p.partner_id, label: p.name, link: `/partnerships?tab=pipeline&id=${p.partner_id}`, read_key: "partners.list" });
const personCite = (key: string): AiCitation | null => {
  const p = byKey(key);
  return p ? { entity_type: "employee", entity_id: p.employee_id, label: p.display_name, link: `/people?tab=employees&id=${p.employee_id}`, read_key: "employees.list" } : null;
};

type Draft = Pick<AiAnswer, "content" | "table" | "link" | "citations" | "reads" | "declined" | "more" | "card" | "overview" | "context" | "choices">;
const said = (content: string, over: Partial<Draft> = {}): Draft => ({ content, table: null, link: null, citations: [], reads: [], declined: null, more: false, card: null, overview: null, context: null, choices: [], ...over });
/** A read as the server records it (AiReadMade): which of the question's reads, with the parameters it ran with. */
const read = (key: string, rows: number, total: number | null, first: number | null, n = 1): AiAnswer["reads"][number] => ({
  n,
  key,
  kind: "read",
  module_key: key.split(".")[0],
  params: first && first > 1 ? { page: Math.floor((first - 1) / 25) + 1 } : {},
  outcome: total === null ? "refused" : "read",
  rows,
  total,
  first,
  masked: [],
});
/** A table as the server sends it: each row's record link, or null where a row has none. */
const tbl = (columns: string[], rows: string[][], numeric: number[], links: Array<string | null> = rows.map(() => null)) => ({ columns, rows, numeric, links, read: 1 });

/** A record type as From names it (shared/ai/cite.js typeLabel). */
const typeLabel = (type: string) => ({ home_alert: "alert", policy_version: "policy" })[type] ?? type.replace(/_/g, " ");

/** From (§1.1 decision 9): kinds of record with how many, or the one record an answer rests on. */
function sourcesOf(citations: AiCitation[]): AiSource[] {
  if (citations.length === 1) {
    const c = citations[0];
    return [{ kind: "record", entity_type: c.entity_type, label: c.label, count: 1, link: c.link }];
  }
  const groups = new Map<string, number>();
  for (const c of citations) groups.set(c.entity_type, (groups.get(c.entity_type) ?? 0) + 1);
  return [...groups].map(([type, count]) => ({ kind: "type", entity_type: type, label: typeLabel(type), count, link: null }));
}

/** A day from today as YYYY-MM-DD, for the filled forms the change answers open. */
const dayFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** The screen a change opens, filled with what the question gave, as the server's route links are. */
function changeLink(l: string): Draft["link"] {
  if (l.includes("task")) return { label: "Open Tasks", path: `/workspace?tab=tasks&new=1&title=Send+the+weekly+report&priority=high&due_on=${dayFromNow(2)}` };
  if (l.includes("meeting")) return { label: "Open Calendar", path: `/workspace?tab=calendar&new=1&title=Team+meeting&starts_at=${dayFromNow(1)}T09:00:00.000Z` };
  if (l.includes("leave")) return { label: "Open My Leave", path: `/ess?tab=my-leave&new=1&starts_on=${dayFromNow(7)}&ends_on=${dayFromNow(8)}` };
  return null;
}

/* ── Cards (§6.11): the change asked for, drawn as a card from the action's own fields; pressed, the mock records the result. ── */

type KeptCard = { owner: string; card: AiActionCard };
const CARDS: KeptCard[] = [];
const cardOf = (user: string, id: string) => CARDS.find((k) => k.owner === user && k.card.ai_action_draft_id === id);
const nowIso = () => new Date().toISOString();
const inHalfAnHour = () => new Date(Date.now() + 30 * 60_000).toISOString();
const field = (name: string, label: string, kind: AiActionCard["fields"][number]["kind"], over: Partial<AiActionCard["fields"][number]> = {}): AiActionCard["fields"][number] => ({ name, label, kind, required: false, options: null, long: false, picks: null, ...over });

/** New Task's own fields, as the server's tasks.create carries them (decision 31), each id field with its picker. */
const TASK_FIELDS: AiActionCard["fields"] = [
  field("title", "Title", "text", { required: true }),
  field("description", "Notes", "text", { long: true }),
  field("primary_assignee_id", "For", "id", { picks: "task_assignee" }),
  field("member_ids", "Shared With", "list", { picks: "task_member" }),
  field("department_id", "Department", "id", { picks: "department" }),
  field("watcher_ids", "Watchers", "list", { picks: "colleague" }),
  field("watcher_department_id", "Watching Department", "id", { picks: "department" }),
  field("due_on", "Due Day", "date"),
  field("priority", "Priority", "choice", { options: ["low", "normal", "high", "urgent"] }),
  field("cadence", "Cadence", "choice", { options: ["daily", "weekly"] }),
  field("project_id", "Project", "id", { picks: "project" }),
];

/** The answers to the questions a task is gathered with (decisions 28 and 29), in the server's words. */
const DUE_CHOICES = ["Today", "Tomorrow", "Friday", "No Due Day"];
const PRIORITY_CHOICES = ["Low", "Normal", "High", "Urgent"];

/** The card a change question draws, for a screen that draws cards; null when the question asks for no change the mock offers. */
function cardFor(question: string, messageId: string): AiActionCard | null {
  const l = question.toLowerCase();
  const base = { ai_action_draft_id: sid(`card:${messageId}`), ai_message_id: messageId, problems: {}, names: [], suggested: false, status: "shown" as const, expires_at: inHalfAnHour(), result: null, created_at: nowIso() };
  // The last answer of a task gathered by questions (its priority): the task for a colleague, with two watchers, every id by name.
  if (PRIORITY_CHOICES.some((w) => w.toLowerCase() === l.trim())) {
    const [lead, w1, w2] = ["cynthia", "tobi", "bashir"].map(byKey);
    const people = [lead, w1, w2].filter((p): p is NonNullable<typeof p> => Boolean(p));
    return {
      ...base,
      action_key: "tasks.create",
      module_key: "workspace",
      label: "Create Task",
      description: "Set a task: title, notes, due day, priority, lead; share it with people or a department, never both; watchers see it and hear when it moves",
      schema: "tasks.TaskCreate",
      risk: "standard",
      confirm: "press",
      bulk: 1,
      values: { title: "Send the weekly report", priority: l.trim(), due_on: dayFromNow(4), is_commitment: false, ...(lead && { primary_assignee_id: lead.employee_id }), watcher_ids: [w1, w2].filter(Boolean).map((p) => p!.employee_id) },
      records: [],
      names: people.map((p) => ({ type: "employee", id: p.employee_id, label: p.display_name, link: null })),
      fields: TASK_FIELDS,
    };
  }
  if (/\bapprove\b/.test(l) && /\bleave\b/.test(l)) {
    const people = ["tobi", "bashir", "emeka", "hauwa"].map(byKey).filter((p): p is NonNullable<typeof p> => Boolean(p));
    return {
      ...base,
      action_key: "leave.approve",
      module_key: "people",
      label: "Approve Leave",
      description: "Approve leave requests waiting on me, with a note for the person if I like",
      schema: "leave.LeaveApprove",
      risk: "approval",
      confirm: "fresh_sign_in",
      bulk: 25,
      values: { leave_request_ids: people.map((p) => sid(`leave:${p.employee_id}`)) },
      records: people.map((p) => ({ type: "leave_request", id: sid(`leave:${p.employee_id}`), label: `${p.display_name}, Annual, 2 days`, link: `/people?tab=leave&id=${sid(`leave:${p.employee_id}`)}` })),
      fields: [field("leave_request_ids", "Requests", "list", { required: true }), field("reason", "Reason", "text", { long: true })],
    };
  }
  if (/\b(tell|message)\b/.test(l)) {
    const to = byKey("cynthia")!;
    return {
      ...base,
      action_key: "community.message",
      module_key: "community",
      label: "Send Message",
      description: "Send a direct message to a colleague, written from what I said and the records read",
      schema: "community.DirectMessageSend",
      risk: "standard",
      confirm: "press",
      bulk: 1,
      values: { employee_id: to.employee_id, body: "The weekly report is ready for you." },
      records: [{ type: "employee", id: to.employee_id, label: to.display_name, link: `/people?tab=employees&id=${to.employee_id}` }],
      fields: [field("employee_id", "To", "id", { required: true }), field("body", "Message", "text", { required: true, long: true })],
    };
  }
  if (/\b(email|mail)\b/.test(l)) {
    return {
      ...base,
      action_key: "mail.send",
      module_key: "mailbox",
      label: "Send Mail",
      description: "Send an email from my mailbox: to, cc, subject and the words, written from what I said",
      schema: "mailbox.MailCompose",
      risk: "standard",
      confirm: "press",
      bulk: 1,
      values: { to_addresses: ["ada@partner.test"], cc_addresses: [], subject: "Venue visit on Thursday", body: "Dear Ada,\n\nThis confirms our visit to the venue on Thursday at 10:00.\n\nWe look forward to seeing you." },
      records: [],
      fields: [field("to_addresses", "To", "list", { required: true }), field("cc_addresses", "Cc", "list"), field("subject", "Subject", "text", { required: true }), field("body", "Message", "text", { required: true, long: true })],
    };
  }
  if (/\b(task|todo)\b/.test(l)) {
    return {
      ...base,
      action_key: "tasks.create",
      module_key: "workspace",
      label: "Create Task",
      description: "Set a task: a title, notes, priority, cadence, due day, and for a manager who it is for",
      schema: "tasks.TaskCreate",
      risk: "standard",
      confirm: "press",
      bulk: 1,
      values: { title: "Send the weekly report", priority: "high", due_on: dayFromNow(2), is_commitment: false },
      records: [],
      fields: TASK_FIELDS,
    };
  }
  return null;
}

/** What a press comes back with: one line per record, or the one record the action made. */
function resultFor(card: AiActionCard): AiActionResult {
  const lines = card.records.length
    ? card.records.map((r) => ({ type: r.type, id: r.id, label: r.label, ok: true, message: card.action_key === "leave.approve" ? "approved" : "done", link: r.link }))
    : card.action_key === "tasks.create"
      ? [{ type: "task", id: sid(`task:${card.ai_action_draft_id}`), label: `T-118 ${String(card.values.title ?? "")}`, ok: true, message: "created", link: `/workspace?tab=tasks&id=${sid(`task:${card.ai_action_draft_id}`)}` }]
      : [{ type: card.action_key === "mail.send" ? "mail_send_queue" : "record", id: sid(`made:${card.ai_action_draft_id}`), label: card.action_key === "mail.send" ? "Mail queued" : "Done", ok: true, message: card.action_key === "mail.send" ? "queued" : "done", link: card.action_key === "mail.send" ? "/mailbox?tab=sent" : null }];
  return { ai_action_run_id: sid(`run:${card.ai_action_draft_id}`), status: "done", lines, error_code: null, message: null, next: [], finished_at: nowIso() };
}

route("GET /api/v1/ai/cards/:id", (req) => {
  const k = cardOf(req.user!, req.params.id);
  return k ? ok(k.card) : fail(404, "NOT_FOUND", "Not found");
});

route("PUT /api/v1/ai/cards/:id", (req) => {
  const k = cardOf(req.user!, req.params.id);
  if (!k) return fail(404, "NOT_FOUND", "Not found");
  if (k.card.status !== "shown") return fail(409, "CARD_NOT_OPEN", "This card is no longer open.");
  const values = { ...k.card.values, ...((req.body as { values?: Record<string, unknown> }).values ?? {}) };
  const problems: Record<string, string[]> = {};
  for (const f of k.card.fields) if (f.required && (values[f.name] === "" || values[f.name] == null || (Array.isArray(values[f.name]) && !(values[f.name] as unknown[]).length))) problems[f.name] = ["Required"];
  k.card = { ...k.card, values, problems };
  return ok(k.card);
});

route("POST /api/v1/ai/cards/:id/confirm", (req) => {
  const k = cardOf(req.user!, req.params.id);
  if (!k) return fail(404, "NOT_FOUND", "Not found");
  if (k.card.status === "done" || k.card.status === "failed") return fail(409, "CARD_DONE", "This was already done.");
  if (k.card.status === "cancelled") return fail(409, "CARD_CANCELLED", "This card was cancelled.");
  if (k.card.status !== "shown" || Date.parse(k.card.expires_at) <= Date.now()) return fail(409, "CARD_EXPIRED", "This card has expired. Ask again to draw it afresh.");
  if (k.card.confirm === "fresh_sign_in") {
    const refused = stale(req.user!);
    if (refused) return refused;
  }
  if (Object.keys(k.card.problems).length) return fail(422, "VALIDATION", "Check the card's fields", k.card.problems);
  const result = resultFor(k.card);
  k.card = { ...k.card, status: "done", result };
  return ok(result);
});

route("POST /api/v1/ai/cards/:id/cancel", (req) => {
  const k = cardOf(req.user!, req.params.id);
  if (!k) return fail(404, "NOT_FOUND", "Not found");
  if (k.card.status !== "shown") return fail(409, "CARD_NOT_OPEN", "This card is no longer open.");
  k.card = { ...k.card, status: "cancelled" };
  return ok(k.card);
});

function answerFor(question: string, view: string): Draft {
  const l = question.toLowerCase();
  // A task asked for without its due day is gathered one question at a time, with answers to tap (decisions 28, 29).
  if (/\bassign\b.*\btask\b|\btask\b.*\bto\s+\w+$/.test(l) && !/\b(today|tomorrow|friday|due|by)\b/.test(l)) return said("When is it due?", { choices: DUE_CHOICES });
  if (DUE_CHOICES.some((w) => w.toLowerCase() === l.trim())) return said("How urgent is it?", { choices: PRIORITY_CHOICES });
  if (PRIORITY_CHOICES.some((w) => w.toLowerCase() === l.trim())) return said("Here is the task to create for Cynthia, with Tobi and Bashir watching.", { declined: "change", link: changeLink("task") });
  if (/\b(create|add|delete|approve|send|update|raise|book|tell|message|email|mail)\b/.test(l))
    return said("Here it is as a card. Check the fields and press it, or make the change on its screen.", { declined: "change", link: changeLink(l) });
  if (l.includes("partner") || l.includes("inactive") || l.includes("quiet")) {
    if (view === "staff") return said("Partnership records are not available to you.", { declined: "not_available", reads: [read("partners.list", 0, null, null)] });
    const quiet = PARTNERS.filter((p) => p.quiet_days > 30).sort((x, y) => y.quiet_days - x.quiet_days);
    const owners = [...new Set(quiet.map((p) => p.owner))].map(personCite).filter((c): c is AiCitation => c !== null);
    return said(`${quiet.length} partnerships have had no recorded contact in over 30 days. Each has an inactivity alert open on its owner.`, {
      table: tbl(["Partner", "Owner", "Days Quiet"], quiet.map((p) => [p.name, byKey(p.owner)?.display_name ?? "", String(p.quiet_days)]), [2], quiet.map((p) => partnerCite(p).link)),
      citations: [...quiet.map(partnerCite), ...owners],
      reads: [read("partners.list", quiet.length, quiet.length, 1), read("employees.list", owners.length, owners.length, 1, 2)],
    });
  }
  if (l.includes("happened") || l.includes("done today"))
    return said("Four things happened today: a leave approval, a new joiner, a recognition and a celebration.", {
      table: tbl(
        ["When", "What", "By", "About"],
        [
          ["11:20", "Recognition posted", nameOf("ngozi"), nameOf("adedotun")],
          ["10:05", "Employee added", nameOf("cynthia"), nameOf("samuel")],
          ["09:12", "Leave approved", nameOf("cynthia"), nameOf("tobi")],
          ["00:01", "Celebration posted", "", nameOf("hauwa")],
        ],
        [],
      ),
      reads: [read("activity.list", 4, 4, 1)],
      link: { label: "Open Home", path: "/home?tab=overview" },
    });
  if (l.includes("late"))
    return said("Seven late arrivals this month, from four people. One person has reached the query threshold.", {
      table: tbl(["Employee", "Late Arrivals"], [["Bashir Lawal", "3"], ["Tobi Ojo", "2"], ["Emeka Obi", "1"], ["Cynthia Osakunih", "1"]], [1]),
      reads: [read("attendance.exceptions", 7, 7, 1)],
      link: { label: "Open Attendance", path: "/people?tab=attendance" },
    });
  if (l.includes("confirm") || l.includes("probation"))
    return said("Two people are on probation; Chidera Nwosu's decision is due first.", {
      table: tbl(["Employee", "Started", "Decision Due"], [["Chidera Nwosu", "24/07/2026", "24/10/2026"], ["Samuel Akpan", "13/04/2026", "Overdue"]], []),
      reads: [read("employees.list", 2, 2, 1)],
    });
  if (l.includes("leave"))
    return said("You have 14 of 20 annual leave days left this year.", { reads: [read("my_leave.balances", 1, 1, null)] });
  if (l.includes("next 25"))
    return said("Here are the next people on the list.", {
      table: tbl(["Name"], [["Bashir Lawal"], ["Tobi Ojo"], ["Emeka Obi"]], []),
      reads: [read("employees.list", 3, 312, 26)],
      more: true,
    });
  if (l.includes("who") || l.includes("staff") || l.includes("people")) {
    const cites = ["cynthia", "ifeoma", "ngozi"].map(personCite).filter((c): c is AiCitation => c !== null);
    return said(`There are 312 people in all; here are the first ${cites.length}.`, {
      table: tbl(["Name"], cites.map((c) => [c.label]), [], cites.map((c) => c.link)),
      citations: cites,
      reads: [read("employees.list", cites.length, 312, 1)],
      more: true,
    });
  }
  return said("I could not find that in the records you can read. Try asking about attendance, leave, people or partnerships.");
}

const kept = (user: string, id: string) => KEPT.find((k) => k.owner === user && k.conversation.ai_conversation_id === id);

route("GET /api/v1/ai/suggestions", (req) => {
  const view = SIGN_INS[req.user!]?.view ?? "staff";
  const all = ["Who is in today, and who is late?", "What happened today?", "What is waiting on my approval?", "Which leave requests are waiting?", "Who came in late this week?", "How many leave days do I have left?"];
  return ok({ questions: view === "staff" ? ["What happened today?", "How many leave days do I have left?", "Which of my tasks are overdue?", "Was I late at all this month?", "When is the next public holiday?"] : all });
});

/** The kinds of document a person may attach (praxis-ai.md decision 41): Payment Receipt for a holder of expenses.finance, Contract or MoU for everyone who sees Partnerships. */
const KIND_LABEL = { invoice: "Invoice", payment_receipt: "Payment Receipt", contract: "Contract or MoU" } as const;
const KIND_QUESTION = { invoice: "Raise an expense request from this invoice", payment_receipt: "Record the payment on this receipt", contract: "Summarise this contract and file it" } as const;
type Kind = keyof typeof KIND_LABEL;
const kindsFor = (user: string): Kind[] => ((SIGN_INS[user]?.view ?? "staff") === "staff" ? ["invoice", "contract"] : ["invoice", "payment_receipt", "contract"]);
route("GET /api/v1/ai/attachment-kinds", (req) => ok({ kinds: kindsFor(req.user!).map((kind) => ({ kind, label: KIND_LABEL[kind], question: KIND_QUESTION[kind] })), available: true }));

/** New Request from an attached invoice (§6.18), as the server draws it: every line, the discount and the payment already made as minus lines. */
function invoiceCard(messageId: string, document: { document_id: string; file_name: string }): AiActionCard {
  return {
    ai_action_draft_id: sid(`card:${messageId}`),
    ai_message_id: messageId,
    problems: {},
    suggested: false,
    status: "shown",
    expires_at: inHalfAnHour(),
    result: null,
    created_at: nowIso(),
    action_key: "my_expenses.from_invoice",
    module_key: "expenses",
    label: "New Request",
    description: "Raise an expense request of my own from the invoice I attached",
    schema: "expenses.ExpenseRequestFromInvoice",
    risk: "standard",
    confirm: "press",
    bulk: 1,
    values: {
      purpose: "Website ticket payments, INV-202611-9525",
      lines: [
        { description: "Payment gateway integration", quantity: "1", unit_price: "250000.00" },
        { description: "Ticket checkout pages", quantity: "1", unit_price: "150000.00" },
        { description: "Refunds and reconciliation", quantity: "1", unit_price: "100000.00" },
        { description: "Testing and go-live support", quantity: "1", unit_price: "50000.00" },
        { description: "Discount", quantity: "1", unit_price: "-100000.00" },
        { description: "Paid to date on INV-202611-9525", quantity: "1", unit_price: "-300000.00" },
      ],
      payee_type: "vendor",
      payee_name: "Sample Studio Ltd",
      bank_name: "Sample MFB",
      account_name: "Sample Studio Ltd",
      account_number: "0000012345",
      invoice_document_id: document.document_id,
      submit: true,
    },
    records: [],
    names: [{ type: "document", id: document.document_id, label: document.file_name, link: null }],
    fields: [
      field("purpose", "Purpose", "text", { required: true }),
      field("lines", "Lines", "lines", { required: true }),
      field("payee_type", "Payee Type", "choice", { required: true, options: ["staff", "vendor", "partner", "task_team"] }),
      field("payee_name", "Payee", "text"),
      field("bank_name", "Bank", "text"),
      field("account_name", "Account Name", "text"),
      field("account_number", "Account Number", "number"),
      field("invoice_document_id", "Invoice", "id", { required: true }),
      field("submit", "Send Now", "boolean"),
    ],
  };
}

/** A made-up signed MoU as the server reads it (§6.18): its terms for the Record tab, a person's words throughout. */
const MOU_TERMS: NonNullable<AiAnswer["attachment"]>["record"] = {
  title: "Memorandum of Understanding",
  items: [
    { label: "Kind", value: "MOU" },
    { label: "Parties", value: "MyCity App Ltd (MyCity); Lagoon Youth Fest Limited (Partner)" },
    { label: "Signed On", value: "12/11/2026" },
    { label: "Starts On", value: "01/12/2026" },
    { label: "Ends On", value: "30/11/2027" },
    { label: "Notice", value: "30 days" },
    { label: "Value", value: "₦2,500,000.00" },
    { label: "Renewal", value: "Renews each year unless either party gives 30 days' notice." },
    { label: "Lagoon Youth Fest Limited", value: "List every ticketed event on MyCityApp." },
    { label: "MyCity App Ltd", value: "Promote the festival to its users for six weeks." },
    { label: "Signed By", value: "Ngozi Adebayo, Founder; Ada Okafor, Chief Executive Officer" },
  ],
};

/** Record Signed Copy from an attached MoU (§6.18): the agreement waiting for its signature, the day, who signed. */
function signedCopyCard(messageId: string, document: { document_id: string; file_name: string }): AiActionCard {
  const agreement = sid("agreement:lagoon");
  return {
    ai_action_draft_id: sid(`card:${messageId}`),
    ai_message_id: messageId,
    problems: {},
    suggested: false,
    status: "shown",
    expires_at: inHalfAnHour(),
    result: null,
    created_at: nowIso(),
    action_key: "agreements.record_signed_copy",
    module_key: "partnerships",
    label: "Record Signed Copy",
    description: "File an attached contract or MoU as the signed copy of the agreement waiting for its signature",
    schema: "agreements.AgreementSignedCopyAdd",
    risk: "approval",
    confirm: "fresh_sign_in",
    bulk: 1,
    values: { partnership_agreement_id: agreement, document_id: document.document_id, signed_on: "2026-11-12", signed_by_name: "Ngozi Adebayo", signed_by_title: "Founder" },
    records: [{ type: "agreement", id: agreement, label: "AGR-2026-0004 Lagoon Youth Fest MOU", link: `/partnerships?tab=contracts-and-mous&id=${agreement}` }],
    names: [{ type: "document", id: document.document_id, label: document.file_name, link: null }],
    fields: [
      field("partnership_agreement_id", "Agreement", "id", { required: true }),
      field("document_id", "Document", "id", { required: true }),
      field("signed_on", "Signed On", "date", { required: true }),
      field("signed_by_name", "Signed By", "text", { required: true }),
      field("signed_by_title", "Title", "text"),
    ],
  };
}

route("POST /api/v1/ai/ask", async (req) => {
  const attached = req.body.attachment as { document_id?: string; kind?: Kind } | undefined;
  if (attached && (!attached.kind || !kindsFor(req.user!).includes(attached.kind))) return fail(403, "ATTACHMENT_FORBIDDEN", "You cannot attach that kind of document");
  const document = attached ? (UPLOADS.get(String(attached.document_id)) ?? null) : null;
  if (attached && !document) return fail(404, "NOT_FOUND", "Upload the file again");
  const question = String(req.body.question ?? "").trim() || (attached?.kind ? KIND_QUESTION[attached.kind] : "");
  if (!question) return invalid({ question: ["Ask a question"] });
  const user = req.user!;
  let k: Kept | undefined;
  if (req.body.ai_conversation_id) {
    k = kept(user, String(req.body.ai_conversation_id));
    if (!k) return fail(404, "NOT_FOUND", "Not found");
  }
  await new Promise((r) => setTimeout(r, 600));
  const now = new Date().toISOString();
  if (!k) {
    k = { owner: user, conversation: { ai_conversation_id: sid(`conv:${user}:${KEPT.length}:${now}`), title: question.slice(0, 120), last_asked_at: now, questions: 0, rows_read: 0 }, turns: [] };
    KEPT.unshift(k);
  }
  const d =
    attached?.kind === "invoice"
      ? said("This invoice from Sample Studio Ltd asks for the balance of ₦150,000.00.")
      : attached?.kind === "contract" && document
        ? said(
            "A memorandum of understanding between MyCity App Ltd and Lagoon Youth Fest Limited, signed on 12/11/2026 and running from 01/12/2026 to 30/11/2027 with 30 days' notice. It is worth ₦2,500,000.00 and renews each year. The festival lists every ticketed event on MyCityApp; MyCity promotes it for six weeks.",
            { reads: [{ ...read("file.contract", 1, 1, 1), module_key: "partnerships", params: { document_id: document.document_id } }], citations: [{ entity_type: "document", entity_id: document.document_id, label: document.file_name, read_key: "file.contract", link: null }] },
          )
        : attached
          ? said("This transfer of ₦150,000.00 matches no request waiting to be paid. Which request was paid?")
          : answerFor(question, SIGN_INS[user]?.view ?? "staff");
  // The screen the question was asked from travels back with the answer (decision 12).
  const context = (req.body.context as AiAnswer["context"] | undefined) ?? null;
  const messageId = sid(`answer:${now}:${k.turns.length}`);
  // A card only for a screen that draws one (§6.11), and only for a change the mock offers; otherwise the screen button stands.
  const shows = Array.isArray(req.body.shows) ? (req.body.shows as string[]) : [];
  const fromFile = document && shows.includes("cards") ? (attached?.kind === "invoice" ? invoiceCard(messageId, document) : attached?.kind === "contract" ? signedCopyCard(messageId, document) : null) : null;
  const card = fromFile ?? (d.declined === "change" && shows.includes("cards") ? cardFor(question, messageId) : null);
  if (card) CARDS.push({ owner: user, card });
  const answer: AiAnswer = { ...d, card, link: card ? null : d.link, declined: card ? null : d.declined, context, sources: sourcesOf(d.citations), ai_message_id: messageId, ai_conversation_id: k.conversation.ai_conversation_id, question, citations_total: d.citations.length, attachment: document && attached?.kind ? { document, kind: attached.kind, record: attached.kind === "contract" ? MOU_TERMS : null } : null, feedback: null, created_at: now, provisional: true };
  const tokens = 900 + question.length * 7 + d.reads.length * 600;
  COSTS.set(answer.ai_message_id, { tokens, cost_ngn: (tokens * 0.0076).toFixed(2) });
  k.turns.unshift(answer);
  k.conversation.questions += 1;
  k.conversation.last_asked_at = now;
  k.conversation.rows_read += d.reads.reduce((n, r) => n + r.rows, 0);
  return ok(answer);
});

route("GET /api/v1/ai/conversations", (req) => {
  const mine = KEPT.filter((k) => k.owner === req.user).map((k) => k.conversation);
  return paged(mine, req, { search: (c) => [c.title ?? ""] });
});

route("GET /api/v1/ai/conversations/:id/turns", (req) => {
  const k = kept(req.user!, req.params.id);
  return k ? paged(k.turns, req) : fail(404, "NOT_FOUND", "Not found");
});

/**
 * A read of an answer run again, 25 a page (§6.12), as the Table pane shows it: the answer's own
 * table on its first page, invented rows after it up to the read's total.
 */
route("GET /api/v1/ai/answers/:id/reads/:n", (req) => {
  const t = KEPT.filter((k) => k.owner === req.user)
    .flatMap((k) => k.turns)
    .find((x) => x.ai_message_id === req.params.id);
  const n = Number(req.params.n);
  const r = t?.reads.find((x) => x.n === n);
  if (!t || !r || r.kind !== "read" || r.outcome !== "read") return fail(404, "NOT_FOUND", "Not found");
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const total = r.total ?? r.rows;
  const table = t.table && t.table.read === n ? t.table : null;
  const columns = table ? table.columns : ["Name"];
  const pages = Math.max(1, Math.ceil(total / 25));
  const start = (page - 1) * 25;
  const count = Math.max(0, Math.min(25, total - start));
  const rows = Array.from({ length: count }, (_, i) => (table && start + i < table.rows.length ? table.rows[start + i]! : columns.map((_, j) => (j === 0 ? `Person ${start + i + 1}` : ""))));
  const links = rows.map((_, i) => (table && start + i < table.links.length ? (table.links[start + i] ?? null) : null));
  const body: AiReadRows = { n, key: r.key, label: r.key, columns, rows, numeric: table ? table.numeric : [], links, page: { number: page, size: 25, total, pages, has_next: page < pages } };
  return ok(body);
});

/** Download Excel on a read (§6.16): the file pending, done at once, as every mock export is. */
route("POST /api/v1/ai/answers/:id/reads/:n/export", (req) => {
  const t = KEPT.filter((k) => k.owner === req.user)
    .flatMap((k) => k.turns)
    .find((x) => x.ai_message_id === req.params.id);
  const r = t?.reads.find((x) => x.n === Number(req.params.n));
  if (!t || !r || r.kind !== "read" || r.outcome !== "read") return fail(404, "NOT_FOUND", "Not found");
  return exportFile(req.user!, `praxis-ai-${r.key.replace(/\./g, "-")}`);
});

route("DELETE /api/v1/ai/conversations/:id", (req) => {
  const i = KEPT.findIndex((k) => k.owner === req.user && k.conversation.ai_conversation_id === req.params.id);
  if (i < 0) return fail(404, "NOT_FOUND", "Not found");
  KEPT.splice(i, 1);
  return noContent();
});

route("DELETE /api/v1/ai/history", (req) => {
  for (let i = KEPT.length - 1; i >= 0; i -= 1) if (KEPT[i].owner === req.user) KEPT.splice(i, 1);
  return noContent();
});

/** A person who holds AI Control sees the company's figures on History (§1.1 decision 7 as amended). */
const companyView = (user: string) => (grantsFor(user).ai_control ?? []).includes("view");
const costOf = (id: string) => COSTS.get(id) ?? { tokens: 0, cost_ngn: "0.00" };
const sum = (amounts: string[]) => amounts.reduce((n, a) => n + Number(a), 0);

route("GET /api/v1/ai/history/summary", (req) => {
  const company = companyView(req.user!);
  const month = at(0, "09:00").slice(0, 7);
  const mine = KEPT.filter((k) => k.owner === req.user).flatMap((k) => k.turns);
  const everyone = KEPT.flatMap((k) => k.turns);
  const counted = company ? everyone : mine;
  // Earlier months as a staging ledger would show them; this month is what was asked here.
  const before = company ? [420, 780, 1240, 1610, 1690] : [0, 0, 40, 85, 110];
  const now = sum(counted.map((t) => costOf(t.ai_message_id).cost_ngn)) + (company ? 1720 : 95);
  const [y, m] = month.split("-").map(Number);
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (5 - i), 1));
    return d.toISOString().slice(0, 7);
  });
  const byModule = new Map<string, number>();
  for (const t of counted) byModule.set(t.reads[0]?.key.split(".")[0] ?? "", (byModule.get(t.reads[0]?.key.split(".")[0] ?? "") ?? 0) + 1);
  const LABEL: Record<string, [string | null, string]> = { partners: ["partnerships", "Partnerships"], employees: ["people", "People"], attendance: ["attendance", "Attendance"], activity: ["home", "Home"], my_leave: ["ess", "Self-Service"], "": [null, "Other"] };
  const summary: AiHistorySummary = {
    month,
    view: company ? "company" : "own",
    questions_this_month: company ? everyone.length : mine.length,
    your_questions: mine.length,
    spend_ngn: now.toFixed(2),
    cap_ngn: company ? "25000.00" : null,
    spend_by_month: months.map((mo, i) => ({ month: mo, spend_ngn: (i === 5 ? now : before[i]).toFixed(2) })),
    by_module: [...byModule].map(([k, n]) => ({ module_key: (LABEL[k] ?? [k, k])[0], label: (LABEL[k] ?? [k, k])[1], questions: n })).sort((a, b) => b.questions - a.questions),
  };
  return ok(summary);
});

route("GET /api/v1/ai/history/questions", (req) => {
  const rows: AiQuestion[] = KEPT.filter((k) => k.owner === req.user)
    .flatMap((k) => k.turns)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((t) => ({
      ai_message_id: t.ai_message_id,
      ai_conversation_id: t.ai_conversation_id,
      question: t.question,
      asked_at: t.created_at,
      sources: t.sources.map((s) => (s.kind === "record" ? typeLabel(s.entity_type) : s.label)),
      ...costOf(t.ai_message_id),
    }));
  return paged(rows, req, { search: (q) => [q.question] });
});

route("POST /api/v1/ai/history/export", (req) => exportFile(req.user!, "praxis-ai-questions"));

route("POST /api/v1/ai/answers/:id/feedback", (req) => {
  const t = KEPT.filter((k) => k.owner === req.user).flatMap((k) => k.turns).find((x) => x.ai_message_id === req.params.id);
  if (!t) return fail(404, "NOT_FOUND", "Not found");
  const f = req.body.feedback;
  t.feedback = f === "up" || f === "down" ? f : null;
  return noContent();
});

/* A spoken question travels through the upload engine, which the mock answers itself: the words ride on the "stored" recording, as the route's AiTranscript does. */
ON_UPLOAD.push((endpoint, doc) => {
  if (endpoint === "/api/v1/ai/transcribe") Object.assign(doc, { text: "Who came in late this week?", draft: false });
});
