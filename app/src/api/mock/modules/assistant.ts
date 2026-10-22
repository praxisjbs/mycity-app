import type { AiAnswer, AiCitation, AiConversation, AiHistorySummary } from "@mycity/contract/contract.gen.ts";
import { at, fail, invalid, noContent, ok, paged, route, sid } from "../core";
import { byKey, SIGN_INS } from "../data/people";
import { PARTNERS } from "../data/partners";
import { ON_UPLOAD } from "../uploads";

/* ── Praxis AI (docs/guides/praxis-ai.md): answers from the mock records, within the asker's view, in the contract's shapes. It never writes. ── */

type Kept = { owner: string; conversation: AiConversation; turns: AiAnswer[] };
const KEPT: Kept[] = [];

const nameOf = (key: string) => byKey(key)?.display_name ?? "";
const partnerCite = (p: (typeof PARTNERS)[number]): AiCitation => ({ entity_type: "partner", entity_id: p.partner_id, label: p.name, link: `/partnerships?tab=pipeline&id=${p.partner_id}`, read_key: "partners.list" });
const personCite = (key: string): AiCitation | null => {
  const p = byKey(key);
  return p ? { entity_type: "employee", entity_id: p.employee_id, label: p.display_name, link: `/people?tab=employees&id=${p.employee_id}`, read_key: "employees.list" } : null;
};

type Draft = Pick<AiAnswer, "content" | "table" | "link" | "citations" | "reads" | "declined" | "more">;
const said = (content: string, over: Partial<Draft> = {}): Draft => ({ content, table: null, link: null, citations: [], reads: [], declined: null, more: false, ...over });

function answerFor(question: string, view: string): Draft {
  const l = question.toLowerCase();
  if (/\b(create|add|delete|approve|send|update|raise|book)\b/.test(l))
    return said("I do not create or change records. Make the change on its screen.", {
      declined: "change",
      link: l.includes("task") ? { label: "Open Tasks", path: "/workspace?tab=tasks&new=1" } : l.includes("meeting") ? { label: "Open Calendar", path: "/workspace?tab=calendar&new=1" } : null,
    });
  if (l.includes("partner") || l.includes("inactive") || l.includes("quiet")) {
    if (view === "staff") return said("Partnership records are not available to you.", { declined: "not_available", reads: [{ key: "partners.list", rows: 0, total: null, page: null }] });
    const quiet = PARTNERS.filter((p) => p.quiet_days > 30).sort((x, y) => y.quiet_days - x.quiet_days);
    return said(`${quiet.length} partnerships have had no recorded contact in over 30 days. Each has an inactivity alert open on its owner.`, {
      table: { columns: ["Partner", "Owner", "Days Quiet"], rows: quiet.map((p) => [p.name, byKey(p.owner)?.display_name ?? "", String(p.quiet_days)]), numeric: [2] },
      citations: quiet.map(partnerCite),
      reads: [{ key: "partners.list", rows: quiet.length, total: quiet.length }],
    });
  }
  if (l.includes("happened") || l.includes("done today"))
    return said("Four things happened today: a leave approval, a new joiner, a recognition and a celebration.", {
      table: {
        columns: ["When", "What", "By", "About"],
        rows: [
          ["11:20", "Recognition posted", nameOf("ngozi"), nameOf("adedotun")],
          ["10:05", "Employee added", nameOf("cynthia"), nameOf("samuel")],
          ["09:12", "Leave approved", nameOf("cynthia"), nameOf("tobi")],
          ["00:01", "Celebration posted", "", nameOf("hauwa")],
        ],
        numeric: [],
      },
      reads: [{ key: "activity.list", rows: 4, total: 4, page: 1 }],
      link: { label: "Open Home", path: "/home?tab=overview" },
    });
  if (l.includes("late"))
    return said("Seven late arrivals this month, from four people. One person has reached the query threshold.", {
      table: { columns: ["Employee", "Late Arrivals"], rows: [["Bashir Lawal", "3"], ["Tobi Ojo", "2"], ["Emeka Obi", "1"], ["Cynthia Osakunih", "1"]], numeric: [1] },
      reads: [{ key: "attendance.exceptions", rows: 7, total: 7, page: 1 }],
      link: { label: "Open Attendance", path: "/people?tab=attendance" },
    });
  if (l.includes("confirm") || l.includes("probation"))
    return said("Two people are on probation; Chidera Nwosu's decision is due first.", {
      table: { columns: ["Employee", "Started", "Decision Due"], rows: [["Chidera Nwosu", "24/07/2026", "24/10/2026"], ["Samuel Akpan", "13/04/2026", "Overdue"]], numeric: [] },
      reads: [{ key: "employees.list", rows: 2, total: 2, page: 1 }],
    });
  if (l.includes("leave"))
    return said("You have 14 of 20 annual leave days left this year.", { reads: [{ key: "my_leave.balances", rows: 1, total: 1, page: null }] });
  if (l.includes("next 25"))
    return said("Here are the next people on the list.", {
      table: { columns: ["Name"], rows: [["Bashir Lawal"], ["Tobi Ojo"], ["Emeka Obi"]], numeric: [] },
      reads: [{ key: "employees.list", rows: 3, total: 312, page: 2 }],
      more: true,
    });
  if (l.includes("who") || l.includes("staff") || l.includes("people")) {
    const cites = ["cynthia", "ifeoma", "ngozi"].map(personCite).filter((c): c is AiCitation => c !== null);
    return said(`There are 312 people in all; here are the first ${cites.length}.`, {
      table: { columns: ["Name"], rows: cites.map((c) => [c.label]), numeric: [] },
      citations: cites,
      reads: [{ key: "employees.list", rows: cites.length, total: 312, page: 1 }],
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
  const answer: AiAnswer = { ...d, ai_message_id: sid(`answer:${now}:${k.turns.length}`), ai_conversation_id: k.conversation.ai_conversation_id, question, citations_total: d.citations.length, feedback: null, created_at: now, provisional: true };
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

route("GET /api/v1/ai/history/summary", (req) => {
  const mine = KEPT.filter((k) => k.owner === req.user);
  const turns = mine.flatMap((k) => k.turns);
  const summary: AiHistorySummary = {
    month: at(0, "09:00").slice(0, 7),
    questions_this_month: turns.length,
    conversations: mine.length,
    rows_read_this_month: turns.reduce((n, t) => n + t.reads.reduce((m, r) => m + r.rows, 0), 0),
    by_module: turns.length ? [{ module_key: "people", label: "People", questions: turns.length }] : [],
  };
  return ok(summary);
});

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
