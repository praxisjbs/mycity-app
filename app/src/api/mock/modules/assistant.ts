import type { AiAnswer, AiCitation, AiConversation, AiHistorySummary, AiQuestion, AiSource } from "@mycity/contract/contract.gen.ts";
import { at, fail, invalid, noContent, ok, paged, route, sid } from "../core";
import { byKey, grantsFor, SIGN_INS } from "../data/people";
import { PARTNERS } from "../data/partners";
import { ON_UPLOAD } from "../uploads";
import { exportFile } from "./shared";

/* ── Praxis AI (docs/guides/praxis-ai.md): answers from the mock records, within the asker's view, in the contract's shapes. It never writes. ── */

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

type Draft = Pick<AiAnswer, "content" | "table" | "link" | "citations" | "reads" | "declined" | "more" | "card" | "overview" | "context">;
const said = (content: string, over: Partial<Draft> = {}): Draft => ({ content, table: null, link: null, citations: [], reads: [], declined: null, more: false, card: null, overview: null, context: null, ...over });
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
});
/** A table as the server sends it: each row's record link, or null where a row has none. */
const tbl = (columns: string[], rows: string[][], numeric: number[], links: Array<string | null> = rows.map(() => null)) => ({ columns, rows, numeric, links });

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

function answerFor(question: string, view: string): Draft {
  const l = question.toLowerCase();
  if (/\b(create|add|delete|approve|send|update|raise|book)\b/.test(l))
    return said("I do not create or change records. Make the change on its screen.", { declined: "change", link: changeLink(l) });
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

route("POST /api/v1/ai/ask", async (req) => {
  const question = String(req.body.question ?? "").trim();
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
  const d = answerFor(question, SIGN_INS[user]?.view ?? "staff");
  const answer: AiAnswer = { ...d, sources: sourcesOf(d.citations), ai_message_id: sid(`answer:${now}:${k.turns.length}`), ai_conversation_id: k.conversation.ai_conversation_id, question, citations_total: d.citations.length, feedback: null, created_at: now, provisional: true };
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
