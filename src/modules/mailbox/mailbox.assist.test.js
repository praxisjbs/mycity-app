"use strict";
/**
 * Write With AI and Summarise Thread: the rules that need no database or model (mailbox.md §6).
 * The presses themselves are covered in tests/integration/mailbox-assist.test.js.
 */
const c = require("@mycity/contract");
const { shield } = require("../../services/ai/redact");
const { ownWords, conversationOf, placeholdersIn, held, MAX_MESSAGES } = require("./mailbox.assist");
const { routesOf } = require("../../http/route");
const { router } = require("./mailbox.routes");

describe("a message's own words", () => {
  test("cut where the quoted history starts, in English, French and Outlook's forms", () => {
    expect(ownWords("Monday works.\n\nOn Mon, 19 Oct 2026 at 09:14, Ada Obi <ada@x.test>\nwrote:\n> Can we meet?")).toBe("Monday works.");
    expect(ownWords("Lundi me va.\n\nLe lun. 19 oct. 2026 à 09:14, Ada a écrit :\n> On se voit ?")).toBe("Lundi me va.");
    expect(ownWords("Noted.\n\nFrom: Ada Obi\nSent: Monday, 19 October 2026 09:14\nTo: Bola\nSubject: Visit\n\nOld text")).toBe("Noted.");
    expect(ownWords("Noted.\n\n-----Original Message-----\nOld text")).toBe("Noted.");
    expect(ownWords("Agreed.\n\n> earlier line\n> another")).toBe("Agreed.");
  });
  test("a message that is nothing but quotation keeps all of it; a From: line in prose is not a header", () => {
    expect(ownWords("> only quoted\n> lines")).toBe("> only quoted\n> lines");
    expect(ownWords("From: the venue team, nothing yet.\nThanks")).toBe("From: the venue team, nothing yet.\nThanks");
  });
});

describe("ready to send", () => {
  test("a gap left to fill is named; a Markdown link, a figure and a known token are not", () => {
    const known = (t) => t === "KEPT001";
    expect(placeholdersIn("Dear Ada,\n\nSee [our site](https://x.test). ₦2,500,000 by KEPT001.\n\nKind regards,", known)).toEqual([]);
    const found = placeholdersIn("Dear [Recipient Name],\nOn <date> at {time}, XXX ____ DD/MM/YYYY insert the amount here\nYour Name\nKEPT007", known);
    expect(found).toHaveLength(9);
    expect(found.join("\n")).toMatch(/\[Recipient Name\]/);
    expect(found.join("\n")).toMatch(/KEPT007", which stands for nothing/);
    expect(placeholdersIn("Call [PHONE] now")).toEqual(['has "[PHONE]", a gap in square brackets: write it without the gap']);
  });

  test("the answer schema refuses a placeholder, an empty draft, questions when asking is off", () => {
    const s = shield("Call 0803 123 4567");
    const ok = { kind: "draft", subject: null, body_markdown: "Dear Ada,\n\nCall me on KEPT001.\n\nKind regards,", questions: [] };
    expect(held(c.mailbox.MailAssistOutput, s).safeParse(ok).success).toBe(true);
    const gap = held(c.mailbox.MailAssistOutput, s).safeParse({ ...ok, body_markdown: "Dear Ada,\n\nKind regards,\n[Your Name]" });
    expect(gap.success).toBe(false);
    expect(gap.error.issues[0]).toMatchObject({ path: ["body_markdown"], message: expect.stringMatching(/\[Your Name\]/) });
    expect(held(c.mailbox.MailAssistOutput, s).safeParse({ ...ok, body_markdown: " " }).success).toBe(false);
    const ask = { kind: "questions", subject: null, body_markdown: null, questions: ["Which day suits you?"] };
    expect(held(c.mailbox.MailAssistOutput, s).safeParse(ask).success).toBe(true);
    expect(held(c.mailbox.MailAssistOutput, s, { mayAsk: false }).safeParse(ask).success).toBe(false);
    expect(held(c.mailbox.MailAssistOutput, s).safeParse({ ...ask, questions: [] }).success).toBe(false);
    const summary = held(c.mailbox.MailSummaryOutput, s).safeParse({ gist: "A visit.", key_points: ["Ring KEPT002."], asked_of_you: [] });
    expect(summary.error.issues[0].path).toEqual(["key_points", 0]);
  });
});

describe("the conversation the model reads", () => {
  const msg = (i, over = {}) => ({
    from_address: i % 2 ? "bola@mycity.test" : "ada@x.test",
    from_name: i % 2 ? "Bola Ade" : null,
    to_addresses: ["someone@x.test"],
    cc_addresses: [],
    sent_at: new Date(Date.UTC(2026, 9, 19, 8, i)).toISOString(),
    body_text: `Message ${i}\n\nOn Mon, someone wrote:\n> older`,
    body_html: null,
    attachments: i === 0 ? [{ file_name: "list.xlsx" }] : [],
    ...over,
  });

  test("its last 30 messages, oldest first, each its own words, whose they were and when", () => {
    const rows = Array.from({ length: 35 }, (_, i) => msg(i));
    const out = conversationOf(rows, "BOLA@mycity.test");
    expect(out).toHaveLength(MAX_MESSAGES);
    expect(out[0].words).toBe("Message 5");
    expect(out[29]).toMatchObject({ words: "Message 34", from: "ada@x.test", yours: false, sent: "Monday 19/10/2026 09:34" });
    expect(out[28]).toMatchObject({ from: "Bola Ade <bola@mycity.test>", yours: true });
    expect(conversationOf([msg(0)], "x")[0].attachments).toEqual(["list.xlsx"]);
  });

  test("a long message is trimmed; HTML-only mail is read as text", () => {
    const long = conversationOf([msg(0, { body_text: "x".repeat(20_000) }), msg(2, { body_text: null, body_html: "<p>Hello <b>Ada</b></p><p>Thanks</p>" })], "x");
    expect(long[0].words.length).toBeLessThanOrEqual(6002);
    expect(long[1].words).toBe("Hello Ada\n\nThanks");
  });
});

test("Write With AI and Dictate need the mailbox's create grant; Summarise Thread its view", () => {
  const routes = routesOf(router);
  const at = (path) => routes.find((r) => r.method === "POST" && r.path === path);
  for (const path of ["/assist", "/dictation", "/dictation/:id/transcript"])
    expect(at(path).permission).toEqual({ key: "mailbox", action: "create" });
  expect(at("/threads/:id/summary").permission).toEqual({ key: "mailbox", action: "view" });
});
