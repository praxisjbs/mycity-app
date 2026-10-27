"use strict";
/**
 * Write With AI, Tidy Up, Dictate and Summarise Thread (docs/guides/mailbox.md §1.1, §3 steps 12
 * to 14, §6): AI on the owner's own mail, run only when they press it.
 *
 *   assist()          POST /assist. A draft from the conversation and What To Say (`mail-draft`),
 *                     or the person's own words tidied (`mail-tidy`), or first the questions the AI
 *                     needs answered (decision 4). Nothing is kept: the composer takes the draft
 *                     when the person presses Use Draft, and it saves and sends as if typed.
 *   summary()         POST /threads/:id/summary. The kept summary while the conversation's newest
 *                     message is the one it covered; else a fresh one (`mail-summary`), kept.
 *   storeDictation(), transcript()   Dictate: the recording is held in the vault only until
 *                     `mail-dictation` has read it, then removed whatever happened.
 *
 * What the model is given (§6, decision 8): this conversation only, each message's own words with
 * its quoted history cut and its length capped; the person and the company from the signature's
 * model; today in Lagos. Contact details and identifying numbers leave as tokens (redact.shield)
 * and are put back in the answer, so a draft carries the real number the model never saw. Every
 * answer is held to "ready to send" before anyone sees it: a placeholder, a redaction mark or a
 * token that stands for nothing sends it back once with the problem named (llm.service's
 * corrective retry), and a second miss fails the press with AI_BAD_OUTPUT.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { logger } = require("../../config/logger");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const vault = require("../../shared/documents/vault");
const md = require("../../shared/documents/markdown");
const lagos = require("../../shared/time/lagos");
const { formatDateTime } = require("../../shared/time/day-first");
const ai = require("../../services/ai/llm.service");
const transcription = require("../../services/ai/transcription");
const redact = require("../../services/ai/redact");
const { placeholdersIn, textsOf } = require("../../services/ai/drafts");
const repo = require("./mailbox.repo");
const mailbox = require("./mailbox.service");
const signatures = require("./signature/signature.service");
const { EVENTS } = require("./mailbox.events");
const { textOf } = require("./compose");

/** AI switched off or out of budget: the press says so and nothing changes (§6). */
const AI_OFF = new Set(["AI_DISABLED", "AI_MODULE_DISABLED", "AI_CAP_REACHED"]);

/** How much of a conversation is read (§6): its last 30 messages, each capped, and all of it. */
const MAX_MESSAGES = 30;
const MAX_EACH = 6000;
const MAX_NEWEST = 12_000;
const MAX_ALL = 60_000;
/** The person's own words for Tidy Up, and a forward's quoted mail. */
const MAX_OWN = 12_000;

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const iso = (v) => (v ? new Date(v).toISOString() : null);
const spamRefused = () => new AppError("SPAM_NOT_READ", "Spam is not read by AI", 422);
const nothingToWrite = (field, words) => new AppError("NOTHING_TO_WRITE", words, 422, { [field]: [words] });

/** "Thursday 22/10/2026 09:14", Lagos time: when a message was sent, or now. */
function whenOf(at) {
  const d = new Date(at);
  return `${DAYS[lagos.weekday(lagos.dateOf(d)) - 1]} ${formatDateTime(d)}`;
}

const sameAddress = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const clip = (s, max) => (s.length > max ? `${s.slice(0, max).trimEnd()} …` : s);

/* ------------------------------------------------------------------ *
 * A message's own words
 * ------------------------------------------------------------------ */

/** An attribution line over quoted mail, in English or French; a long one wraps once. */
const ATTRIBUTION = [/^\s*On\b.{3,300}\bwrote:\s*$/i, /^\s*Le\b.{3,300}\ba écrit\s*:\s*$/i];
/** Outlook's separator over the mail a reply quotes. */
const SEPARATOR = /^\s*(?:-{2,}\s*Original Message\s*-{2,}|_{8,})\s*$/i;

function quoteStarts(lines, i) {
  const line = lines[i];
  if (SEPARATOR.test(line)) return true;
  const wrapped = `${line} ${lines[i + 1] || ""}`.trim();
  if (ATTRIBUTION.some((re) => re.test(line) || (/^\s*(On|Le)\b/i.test(line) && re.test(wrapped)))) return true;
  if (/^\s*From:\s*\S/i.test(line)) {
    const next = lines.slice(i + 1, i + 6).join("\n");
    return /^\s*(Sent|Date):/im.test(next) && /^\s*(To|Subject):/im.test(next);
  }
  return false;
}

/**
 * A message's own words: cut where the history it quotes begins (an "On … wrote:" or "Le … a
 * écrit :" line, an Outlook header block or separator), and a trailing run of `>` lines dropped.
 * A message that is nothing but quotation (a forward) keeps all of it.
 * @param {string} text  plain text
 */
function ownWords(text) {
  const all = String(text || "").replace(/\r\n?/g, "\n");
  const lines = all.split("\n");
  let end = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    if (quoteStarts(lines, i)) {
      end = i;
      break;
    }
  }
  while (end > 0 && (/^\s*>/.test(lines[end - 1]) || !lines[end - 1].trim())) end -= 1;
  const own = lines.slice(0, end).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return own || all.replace(/\n{3,}/g, "\n\n").trim();
}

/** The plain words of a stored message: its text part, else its HTML made text. */
const wordsOf = (m) => ownWords((m.body_text && m.body_text.trim()) || textOf(m.body_html || ""));

/**
 * The conversation as the model reads it, oldest first: its last 30 messages, the newest given the
 * most room and the whole kept under MAX_ALL characters.
 * @param {object[]} rows  repo.messages(), oldest first, Spam already left out
 * @param {string} me  the mailbox's address, to mark the person's own messages
 */
function conversationOf(rows, me) {
  const recent = rows.slice(-MAX_MESSAGES);
  const out = [];
  let room = MAX_ALL;
  for (let i = recent.length - 1; i >= 0 && room > 0; i -= 1) {
    const m = recent[i];
    const words = clip(wordsOf(m), Math.min(i === recent.length - 1 ? MAX_NEWEST : MAX_EACH, room));
    room -= words.length;
    out.unshift({
      from: m.from_name ? `${m.from_name} <${m.from_address}>` : m.from_address,
      to: m.to_addresses || [],
      cc: m.cc_addresses || [],
      sent: whenOf(m.sent_at),
      yours: sameAddress(m.from_address, me),
      attachments: (m.attachments || []).map((x) => x.file_name),
      words,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Ready to send: what an answer may not hold
 * ------------------------------------------------------------------ */

/**
 * The contract's answer schema, held to "ready to send" with this call's tokens: llm.service sends
 * an answer that fails it back once with the problems listed.
 * @param {import("zod").ZodTypeAny} schema  c.mailbox.MailAssistOutput or MailSummaryOutput
 * @param {{known: (token: string) => boolean}} s  the shield the input went through
 * @param {{mayAsk?: boolean}} [opts]
 */
function held(schema, s, { mayAsk = true } = {}) {
  return schema.superRefine((v, ctx) => {
    const issue = (path, message) => ctx.addIssue({ code: "custom", path, message });
    if (v.kind === "draft" && !String(v.body_markdown || "").trim()) issue(["body_markdown"], "is empty: write the email");
    if (v.kind === "questions" && !v.questions.length) issue(["questions"], "is empty: ask what you need, or write the email");
    if (v.kind === "questions" && !mayAsk)
      issue(["kind"], 'must be "draft": may_ask is false, so write the email around what you do not know');
    for (const [path, text] of textsOf(v)) for (const p of placeholdersIn(text, s.known)) issue(path, p);
  });
}

/* ------------------------------------------------------------------ *
 * Write With AI and Tidy Up
 * ------------------------------------------------------------------ */

const OFF = Object.freeze({ available: false, kind: null, subject: null, body_html: null, questions: [], ai_run_id: null });

/** The composer's recipients, each with the name this conversation or the staff list gives it. */
async function recipientsOf(db, body, rows) {
  const names = new Map();
  for (const m of rows) if (m.from_name) names.set(String(m.from_address).toLowerCase(), m.from_name);
  const everyone = [...body.to_addresses, ...body.cc_addresses];
  for (const s of await repo.staffNames(db, everyone.filter((x) => !names.has(String(x).toLowerCase()))))
    names.set(s.address, [s.first_name, s.last_name].filter(Boolean).join(" "));
  const named = (list) => list.map((address) => ({ name: names.get(String(address).toLowerCase()) || null, address }));
  return { to: named(body.to_addresses), cc: named(body.cc_addresses) };
}

/**
 * Everything the model reads for one press (§6, decision 8). A reply's conversation is the
 * owner's own and never Spam; a reply whose conversation is gone, and a forward, are read from
 * the quoted mail under the person's words.
 */
async function contextFor(db, a, user, body) {
  let rows = [];
  if (body.in_reply_to) {
    const t = await repo.threadOfMessage(db, a.mail_account_id, body.in_reply_to);
    if (t && t.folder === "spam") throw spamRefused();
    if (t) rows = (await repo.messages(db, t.mail_thread_id, a.mail_account_id)).filter((m) => m.folder !== "spam");
  }
  const quoted = textOf(body.quoted_html).trim();
  const conversation = rows.length
    ? conversationOf(rows, a.email)
    : quoted
      ? [{ quoted: true, words: clip(quoted, MAX_OWN) }]
      : [];
  const you = (await signatures.senderOf(db, user.user_id)) || { name: null, email: a.email };
  return {
    you,
    today: whenOf(new Date()),
    compose: {
      kind: body.in_reply_to ? "reply" : quoted ? "forward" : "new",
      ...(await recipientsOf(db, body, rows)),
      subject: body.subject,
      attachments: body.attachment_names,
    },
    conversation,
  };
}

/**
 * POST /mailbox/assist (§3 step 12).
 * @param {object} body  c.mailbox.MailAssistRequest
 * @param {object} user
 */
async function assist(body, user) {
  const a = await mailbox.account(user);
  const own = textOf(body.body_html).trim();
  if (body.mode === "tidy" && !own) throw nothingToWrite("body_html", "Write the email first");
  const ctx = await contextFor(pool, a, user, body);
  if (body.mode === "write" && ctx.compose.kind === "new" && !body.instruction && !body.note)
    throw nothingToWrite("instruction", "Say what to write");

  const s = redact.shield({
    you: ctx.you,
    today: ctx.today,
    compose: ctx.compose,
    conversation: ctx.conversation,
    ...(body.mode === "tidy" ? { draft: clip(own, MAX_OWN) } : {}),
    instruction: body.instruction || null,
    note: body.note || null,
    answers: body.answers,
    may_ask: !body.write_anyway,
  });
  const output = held(c.mailbox.MailAssistOutput, s, { mayAsk: !body.write_anyway });
  let run;
  try {
    run =
      body.mode === "tidy"
        ? await ai.complete({ purpose: "mail-tidy", module: "mailbox", actor: user, input: s.value, output, egress: "external", temperature: 0.3 })
        : await ai.complete({ purpose: "mail-draft", module: "mailbox", actor: user, input: s.value, output, egress: "external", temperature: 0.6 });
  } catch (err) {
    if (err instanceof AppError && AI_OFF.has(err.code)) return OFF;
    throw err;
  }
  const v = run.output;
  // The stub cannot write a real draft: with no provider set up, Write With AI is off.
  if (!v) return OFF;
  if (v.kind === "questions")
    return { ...OFF, available: true, kind: "questions", questions: v.questions.map((q) => s.restore(q)), ai_run_id: run.run_id };
  const subject = ctx.compose.kind === "new" && !body.subject.trim() && v.subject ? s.restore(v.subject).trim() || null : null;
  return {
    ...OFF,
    available: true,
    kind: "draft",
    subject,
    body_html: md.markdownToHtml(s.restore(v.body_markdown)),
    ai_run_id: run.run_id,
  };
}

/* ------------------------------------------------------------------ *
 * Summarise Thread
 * ------------------------------------------------------------------ */

const summaryView = (row) => ({
  available: true,
  mail_thread_id: row.mail_thread_id,
  gist: row.gist,
  key_points: row.key_points || [],
  asked_of_you: row.asked_of_you || [],
  message_count: row.message_count,
  summarised_at: iso(row.summarised_at),
  ai_run_id: row.ai_run_id || null,
});

const summaryOff = (threadId) => ({
  available: false,
  mail_thread_id: threadId,
  gist: null,
  key_points: [],
  asked_of_you: [],
  message_count: 0,
  summarised_at: null,
  ai_run_id: null,
});

/**
 * POST /mailbox/threads/:id/summary (§3 step 14): the kept summary while it is current, else a
 * fresh one, kept in its place.
 */
async function summary(threadId, user) {
  const a = await mailbox.account(user);
  const t = await repo.thread(pool, a.mail_account_id, threadId);
  if (!t) throw new AppError("NOT_FOUND", "There is no such message", 404);
  if (t.folder === "spam") throw spamRefused();
  const now = await repo.newestOf(pool, threadId);
  const kept = await repo.summaryOf(pool, threadId);
  if (kept && kept.last_message_id && kept.last_message_id === now.last_message_id && kept.message_count === now.message_count)
    return summaryView(kept);

  const rows = (await repo.messages(pool, threadId, a.mail_account_id)).filter((m) => m.folder !== "spam");
  const s = redact.shield({
    you: (await signatures.senderOf(pool, user.user_id)) || { name: null, email: a.email },
    today: whenOf(new Date()),
    conversation: conversationOf(rows, a.email),
  });
  let run;
  try {
    run = await ai.complete({
      purpose: "mail-summary",
      module: "mailbox",
      actor: user,
      input: s.value,
      output: held(c.mailbox.MailSummaryOutput, s),
      egress: "external",
      temperature: 0.1,
    });
  } catch (err) {
    if (err instanceof AppError && AI_OFF.has(err.code)) return summaryOff(threadId);
    throw err;
  }
  const v = run.output;
  if (!v) return summaryOff(threadId);
  const saved = await tx(async (client) => {
    const row = await repo.saveSummary(client, {
      mail_thread_id: threadId,
      gist: s.restore(v.gist),
      key_points: v.key_points.map((x) => s.restore(x)),
      asked_of_you: v.asked_of_you.map((x) => s.restore(x)),
      message_count: now.message_count,
      last_message_id: now.last_message_id,
      ai_run_id: run.run_id,
    });
    // The audit records that a summary was made, never what it says.
    await emit(client, {
      key: EVENTS.MAIL_THREAD_SUMMARISED,
      entity: { type: "mail_thread", id: threadId },
      actor: user,
      payload: { mail_thread_id: threadId, message_count: now.message_count, ai_run_id: run.run_id },
    });
    return row;
  });
  return summaryView(saved);
}

/* ------------------------------------------------------------------ *
 * Dictate
 * ------------------------------------------------------------------ */

/** POST /mailbox/dictation: the recording, held against the caller's mailbox until it is read. */
async function storeDictation(upload, user) {
  const a = await mailbox.account(user);
  return tx(async (client) => {
    const doc = await vault.store(client, {
      file: upload,
      purpose: "voice_note",
      doc_type: "mail_dictation",
      entity: { type: "mail_account", id: a.mail_account_id },
      actor: user,
    });
    return {
      document_id: doc.document_id,
      file_name: doc.original_name || "dictation",
      size_bytes: Number(doc.bytes),
      mime_type: doc.mime,
    };
  });
}

/** The recording leaves the vault; a failure here is swept by export-cleanup within the hour. */
async function removeRecording(documentId, user) {
  try {
    const keys = await tx((client) => vault.remove(client, documentId, { actor: user, reason: "dictation read" }));
    await vault.removeFiles(keys);
  } catch (err) {
    logger.warn({ err: err.message, document_id: documentId }, "dictation recording not removed now; export-cleanup removes it");
  }
}

/** POST /mailbox/dictation/:id/transcript: the words, and the recording removed whatever happened. */
async function transcript(documentId, user) {
  const a = await mailbox.account(user);
  const doc = await vault.get(pool, documentId);
  if (
    !doc ||
    doc.doc_type !== "mail_dictation" ||
    doc.entity_type !== "mail_account" ||
    String(doc.entity_id) !== String(a.mail_account_id) ||
    doc.uploaded_by !== user.user_id
  )
    throw new AppError("NOT_FOUND", "Not found", 404);
  try {
    const t = await transcription.transcribe({ document_id: documentId, module: "mailbox", actor: user, purpose: "mail-dictation" });
    return { text: String(t.text || "").trim(), draft: Boolean(t.draft) };
  } finally {
    await removeRecording(documentId, user);
  }
}

module.exports = {
  assist,
  summary,
  storeDictation,
  transcript,
  ownWords,
  conversationOf,
  placeholdersIn,
  held,
  MAX_MESSAGES,
};
