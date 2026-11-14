"use strict";
/**
 * A stand-in for Gemini while a video is filmed (docs/runbooks/training-videos.md §6.30), for a
 * session with no Gemini key. Preloaded into the API and the worker on a filming machine only:
 *
 *   VIDEO_AI_REPLIES=/tmp/video/replies.json node -r ./scripts/video/ai-stand-in.js src/server.js
 *
 * It answers the calls the app makes to generativelanguage.googleapis.com, and nothing else: the
 * model list (so Settings · Integrations' Test passes and AI Control can name the model) and chat
 * completions, each answered with the first reply in VIDEO_AI_REPLIES whose `match` (a regular
 * expression) is found in the request's messages. The file is read again on every call, so a scene
 * writes the replies a shot needs in its setup. A reply is the model's answer as the app's schema
 * asks for it (an object is sent as JSON text), after `delay` seconds (default 2). A call no reply
 * matches is refused as a busy service and written to `<replies>.unmatched.jsonl`, so the prompt
 * can be read and its reply written. Embeddings are refused the same way: the app then searches by
 * words, as it does when the service is down.
 *
 * Every word a reply says is written by the person making the video; the app's own screens, rules,
 * redaction and checks run on it exactly as on a real answer. Refused anywhere but development.
 */
const fs = require("node:fs");

const HOST = "generativelanguage.googleapis.com";
const MODELS = Object.freeze([
  { id: "gemini-3.1-flash", name: "Gemini 3.1 Flash" },
  { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite" },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
]);

const file = process.env.VIDEO_AI_REPLIES;
if (file && process.env.APP_ENV === "development") {
  const real = globalThis.fetch;
  const json = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const busy = () => json(503, { error: { code: 503, message: "The model is overloaded. Please try again later.", status: "UNAVAILABLE" } });
  const replies = () => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return [];
    }
  };

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname !== HOST) return real(input, init);
    const method = (init.method || "GET").toUpperCase();
    if (method === "GET" && /\/openai\/models$/.test(url.pathname))
      return json(200, { object: "list", data: MODELS.map((m) => ({ id: `models/${m.id}`, object: "model", owned_by: "google" })) });
    if (method === "GET" && /\/v1beta\/models$/.test(url.pathname))
      return json(200, {
        models: MODELS.map((m) => ({ name: `models/${m.id}`, displayName: m.name, supportedGenerationMethods: ["generateContent", "countTokens"] })),
      });
    if (method === "POST" && /\/chat\/completions$/.test(url.pathname)) {
      const body = JSON.parse(String(init.body || "{}"));
      const said = JSON.stringify(body.messages || []);
      const hit = replies().find((r) => new RegExp(r.match, "s").test(said));
      if (!hit) {
        fs.appendFileSync(`${file}.unmatched.jsonl`, `${JSON.stringify({ at: new Date().toISOString(), body })}\n`);
        return busy();
      }
      await new Promise((r) => setTimeout(r, (hit.delay ?? 2) * 1000));
      const content = typeof hit.reply === "string" ? hit.reply : JSON.stringify(hit.reply);
      return json(200, {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: Math.ceil(said.length / 4), completion_tokens: Math.ceil(content.length / 4) },
      });
    }
    return busy();
  };
}
