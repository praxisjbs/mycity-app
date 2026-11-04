"use strict";
/**
 * One question's rounds with the model (docs/guides/praxis-ai.md §6.1 steps 4 to 6, §6.14): the
 * loop that offers the tools, runs each call through the adapter, counts the reads, forces the
 * answer, corrects it once and rescues it in plain words. It knows no module, no database and
 * no vendor: everything it needs arrives in `deps`.
 *
 *   const out = await runTurn({
 *     talk,                 // llm.service.converse(): round(), fail(), stub
 *     messages,             // the system turn, the history, the question
 *     tools,                // the function tools offered (reads and summaries)
 *     output,               // the answer's schema (safeParse)
 *     runTool,              // async (key, params) => { kind: "ok"|"not_available"|"invalid"|"no_result", content, fields? }
 *     parse,                // (text, schema) => { ok, value, issues }
 *     rescue,               // async (talk, deadline) => a draft, or throws
 *     limits: { maxReads, maxRounds, deadlineMs },
 *     now, toolKey, stable,
 *   });
 *   // → { draft, attempts, forcedAt }
 *
 * The rules, each a test:
 *   - at most `maxReads` reads; the next call is refused with read_limit and the answer forced;
 *   - the same tool with the same parameters twice is already_read; the answer is forced;
 *   - parameters that do not parse go back once, uncounted; a second time counts as nothing;
 *   - a reply that does not parse is sent back once with its problems; a second failure is the
 *     rescue; the rescue throwing is the caller's AI_BAD_OUTPUT;
 *   - past the deadline the model is not asked again: AI_UNAVAILABLE through talk.fail;
 *   - on a forced round the tools stay offered with none to call (Claude needs them defined).
 */
const { EngineError } = require("./errors");

/** Parameters in one order, so the same read asked twice is seen as the same. */
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

/** A tool key as a tool's name and back: providers take letters, digits, `_` and `-` only. */
const toolName = (key) => key.replace(".", "__");
const keyOf = (name) => String(name || "").replace("__", ".");

function argsOf(call) {
  try {
    const v = JSON.parse(call.function.arguments || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/**
 * @param {object} q
 * @returns {Promise<{draft: object, attempts: number}>}
 */
async function runTurn({ talk, messages, tools, output, runTool, parse, rescue, limits, now = () => Date.now() }) {
  const { maxReads, maxRounds, deadlineMs } = limits;
  const started = now();
  const deadline = started + deadlineMs;
  const seen = new Set();
  const invalidOnce = new Set();
  let attempts = 0;
  let forced = talk.stub || tools.length === 0;
  let corrected = false;
  let draft = null;

  /** One tool call: run it with the person's rights (the adapter's job) and say what came back. */
  const handle = async (call) => {
    const key = keyOf(call.function && call.function.name);
    const params = argsOf(call);
    if (attempts >= maxReads) return JSON.stringify({ error: "read_limit", message: "No more reads for this question. Answer with what you have." });
    attempts += 1;
    const sig = `${key} ${stable(params)}`;
    if (seen.has(sig)) {
      forced = true;
      return JSON.stringify({ error: "already_read", message: "You read this already; use that result." });
    }
    seen.add(sig);
    const r = await runTool(key, params);
    if (r.kind === "ok") return r.content;
    if (r.kind === "invalid" && !invalidOnce.has(key)) {
      invalidOnce.add(key);
      seen.delete(sig);
      attempts -= 1;
      return JSON.stringify({ key, error: "invalid_parameters", fields: r.fields || {} });
    }
    // The adapter may say it in its own words (naming which read of the question it was).
    if (r.content) return r.content;
    if (r.kind === "not_available") return JSON.stringify({ key, error: "not_available" });
    return JSON.stringify({ key, error: "no_result" });
  };

  for (let round = 1; !draft; round += 1) {
    if (now() - started > deadlineMs)
      throw await talk.fail("AI_UNAVAILABLE", "The AI service is not answering. Try again in a few minutes.", 503, `the question took longer than ${deadlineMs} ms`);
    if (round > maxRounds || attempts >= maxReads) forced = true;
    const r = await talk.round({
      messages,
      // The tools stay offered on a forced round, with none to call: Claude needs them defined
      // for the calls already in the conversation (llm.service ask()).
      tools: tools.length ? tools : null,
      toolChoice: forced ? "none" : "auto",
      output: forced ? output : null,
      kind: corrected && forced ? "retry" : "completion",
      deadline,
    });

    if (!forced && r.toolCalls.length) {
      messages.push(r.turn);
      for (const call of r.toolCalls) messages.push({ role: "tool", tool_call_id: call.id, content: await handle(call) });
      if (forced || attempts >= maxReads) {
        forced = true;
        messages.push({ role: "user", content: "Answer now with what you have read, as the JSON object." });
      }
      continue;
    }

    const parsed = parse(r.text, output);
    if (parsed.ok) {
      draft = parsed.value;
      break;
    }
    if (!corrected) {
      corrected = true;
      forced = true;
      messages.push(r.turn);
      messages.push({
        role: "user",
        content: `That reply could not be used:\n- ${parsed.issues.join("\n- ")}\nReply again with only the JSON object${r.finish_reason === "length" ? ", and shorter" : ""}.`,
      });
      continue;
    }
    draft = await rescue(talk, deadline);
    if (!draft) throw new EngineError("AI_BAD_OUTPUT", "The AI answer could not be used. Try asking another way.", 502);
  }
  return { draft, attempts };
}

module.exports = { runTurn, stable, toolName, keyOf, argsOf };
