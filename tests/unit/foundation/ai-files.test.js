"use strict";
/**
 * complete() with files (docs/guides/ai-control.md §6.2, Image Reading): a picture or a scan goes
 * beside the input as a data URL, only to an Image Reading action, only of a kind a model reads;
 * Claude gets its own image and document blocks. No network, no database.
 */
const ai = require("../../../src/services/ai/llm.service");
const jobs = require("../../../src/services/ai/jobs");
const prices = require("../../../src/services/ai/prices");
const governance = require("../../../src/services/ai/governance");
const ledger = require("../../../src/services/ai/ledger");
const integrations = require("../../../src/shared/integrations/settings");
const anthropic = require("../../../src/services/ai/vendors/anthropic");
const c = require("@mycity/contract");

const db = { query: async () => ({ rows: [] }) };
const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");

beforeEach(() => {
  jest.spyOn(governance, "check").mockResolvedValue({ settings: {} });
  jest.spyOn(ledger, "startRun").mockResolvedValue("run-1");
  jest.spyOn(ledger, "recordStep").mockResolvedValue("0.00");
  jest.spyOn(ledger, "finishRun").mockResolvedValue();
  jest.spyOn(jobs, "resolve").mockResolvedValue({ links: [{ provider: "gemini", model: "gemini-flash", position: 1, state: "ready" }] });
  jest.spyOn(prices, "forStep").mockResolvedValue(prices.zero());
  jest.spyOn(integrations, "secret").mockResolvedValue("key");
});
afterEach(() => jest.restoreAllMocks());

const answer = {
  payee_name: "Chuks Stores",
  category: null,
  lines: [],
  subject: null,
  invoice_number: null,
  issued_on: null,
  currency: null,
  total: null,
  paid_to_date: null,
  balance_due: null,
  bank_name: null,
  account_name: null,
  account_number: null,
};

test("an Image Reading action sends its file beside the input as a data URL", async () => {
  const complete = jest.fn(async () => ({ text: JSON.stringify(answer), usage: { input_tokens: 1, output_tokens: 1 }, model: "gemini-flash" }));
  const r = await ai.complete({ purpose: "expense-invoice-read", module: "expenses", input: { categories: ["Travel"] }, output: c.expenses.ExpenseInvoiceRead, files: [{ mime_type: "application/pdf", data: pdf }], db, vendors: { gemini: { complete }, stub: require("../../../src/services/ai/vendors/stub") } });
  expect(r.output).toEqual(answer);
  const user = complete.mock.calls[0][0].messages.find((m) => m.role === "user");
  expect(user.content[0]).toMatchObject({ type: "text" });
  expect(user.content[0].text).toContain("Travel");
  expect(user.content[1]).toEqual({ type: "image_url", image_url: { url: `data:application/pdf;base64,${pdf.toString("base64")}` } });
});

test("files go to no other job, and only as pictures or PDFs", async () => {
  await expect(ai.complete({ purpose: "expense-category-suggest", module: "expenses", input: {}, files: [{ mime_type: "image/png", data: pdf }], db })).rejects.toThrow(/not an Image Reading action/);
  await expect(ai.complete({ purpose: "expense-invoice-read", module: "expenses", input: {}, files: [{ mime_type: "text/html", data: pdf }], db })).rejects.toThrow(/a file is a Buffer/);
});

test("Claude reads a picture as an image block and a PDF as a document block", () => {
  const sent = anthropic.toAnthropic([{ role: "user", content: [{ type: "text", text: "read it" }, { type: "image_url", image_url: { url: "data:application/pdf;base64,QUJD" } }, { type: "image_url", image_url: { url: "data:image/png;base64,REVG" } }] }]);
  expect(sent[0].content).toEqual([
    { type: "text", text: "read it" },
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: "QUJD" } },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "REVG" } },
  ]);
});

test("an Image Reading action that does not declare personal data takes no files (audit F19)", async () => {
  const actions = require("../../../src/services/ai/actions");
  const real = actions.of;
  jest.spyOn(actions, "of").mockImplementation((key) => (key === "expense-invoice-read" ? { ...real(key), personal_data: false } : real(key)));
  await expect(ai.complete({ purpose: "expense-invoice-read", module: "expenses", input: {}, files: [{ mime_type: "application/pdf", data: pdf }], db })).rejects.toThrow(/must declare personal_data/);
});

test("Gemini reads a turn with files through generateContent, each file as inline data (audit F9)", async () => {
  const gemini = require("../../../src/services/ai/vendors/gemini");
  const sent = [];
  const fetchImpl = jest.fn(async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 }, modelVersion: "gemini-flash" }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  const r = await gemini.complete({
    apiKey: "key",
    model: "gemini-flash",
    json: true,
    fetchImpl,
    messages: [
      { role: "system", content: "Read the invoice." },
      { role: "user", content: [{ type: "text", text: "categories: Travel" }, { type: "image_url", image_url: { url: "data:application/pdf;base64,QUJD" } }] },
    ],
  });
  expect(sent[0].url).toMatch(/\/models\/gemini-flash:generateContent$/);
  expect(sent[0].headers["x-goog-api-key"]).toBe("key");
  expect(sent[0].body).toMatchObject({
    systemInstruction: { parts: [{ text: "Read the invoice." }] },
    contents: [{ role: "user", parts: [{ text: "categories: Travel" }, { inline_data: { mime_type: "application/pdf", data: "QUJD" } }] }],
    generationConfig: { responseMimeType: "application/json" },
  });
  expect(r).toMatchObject({ text: '{"ok":true}', usage: { input_tokens: 7, output_tokens: 3 }, toolCalls: [] });
});

test("a turn without files stays on the OpenAI-compatible endpoint", async () => {
  const gemini = require("../../../src/services/ai/vendors/gemini");
  const fetchImpl = jest.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200, headers: { "Content-Type": "application/json" } }));
  await gemini.complete({ apiKey: "key", model: "gemini-flash", fetchImpl, messages: [{ role: "user", content: "hello" }] });
  expect(fetchImpl.mock.calls[0][0]).toMatch(/chat\/completions$/);
});
