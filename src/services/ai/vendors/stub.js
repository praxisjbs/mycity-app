"use strict";
/**
 * The stub vendor: what every AI call uses when no Gemini key is configured
 * (BACKEND_STRUCTURE §14.2, "the stub is honest").
 *
 * It never calls out, costs nothing and answers the same way every time, so CI, a
 * laptop and a staging server without a key run the whole path (governance, redaction,
 * prompt, structured parsing, the ledger) and the screens show a clearly marked
 * placeholder rather than an error. The run is recorded with vendor "stub".
 *
 * With an output schema, the answer is a placeholder value of that shape: required
 * keys only, strings saying "[AI placeholder]" (fitted to their length limits),
 * numbers at their minimum, the first value of an enum, empty arrays. A schema the
 * placeholder cannot satisfy (a pattern, a refinement) gets no structured value, and
 * llm.service returns `output: null` for the stub rather than failing.
 */
const { unwrap } = require("../structured");

const TEXT =
  "[AI placeholder] No AI vendor is configured, so this is not a real answer.";
const WORD = "[AI placeholder]";

const FORMAT_VALUES = {
  uuid: "00000000-0000-4000-8000-000000000000",
  email: "placeholder@mycityapp.io",
  url: "https://mycityapp.io",
  datetime: "2026-01-01T00:00:00.000Z",
  date: "2026-01-01",
};

function fit(text, def) {
  let s = text;
  for (const c of def.checks || []) {
    if (FORMAT_VALUES[c.kind]) return FORMAT_VALUES[c.kind];
  }
  const max = (def.checks || []).find(
    (c) => c.kind === "max" || c.kind === "length",
  );
  const min = (def.checks || []).find(
    (c) => c.kind === "min" || c.kind === "length",
  );
  if (min && s.length < min.value) s = s.padEnd(min.value, ".");
  if (max && s.length > max.value) s = s.slice(0, max.value);
  return s;
}

/**
 * A deterministic value of the schema's shape.
 * @param {import("zod").ZodTypeAny} schema
 */
function placeholder(schema, depth = 0) {
  if (depth > 8) return null;
  const outer = schema && schema._def && schema._def.typeName;
  if (outer === "ZodNullable") return null;
  if (outer === "ZodDefault") return schema._def.defaultValue();
  const t = unwrap(schema);
  const def = t && t._def;
  if (!def) return null;
  switch (def.typeName) {
    case "ZodObject": {
      const shape = typeof def.shape === "function" ? def.shape() : def.shape;
      const out = {};
      for (const [k, v] of Object.entries(shape)) {
        if (typeof v.isOptional === "function" && v.isOptional()) continue;
        out[k] = placeholder(v, depth + 1);
      }
      return out;
    }
    case "ZodString":
      return fit(WORD, def);
    case "ZodNumber": {
      const min = (def.checks || []).find((c) => c.kind === "min");
      return min ? (min.inclusive === false ? min.value + 1 : min.value) : 0;
    }
    case "ZodBoolean":
      return false;
    case "ZodEnum":
      return def.values[0];
    case "ZodLiteral":
      return def.value;
    case "ZodArray": {
      const n = def.minLength ? def.minLength.value : 0;
      return Array.from({ length: n }, () => placeholder(def.type, depth + 1));
    }
    case "ZodUnion":
    case "ZodDiscriminatedUnion":
      return placeholder(
        (def.options instanceof Map
          ? [...def.options.values()]
          : def.options)[0],
        depth + 1,
      );
    case "ZodRecord":
      return {};
    default:
      return null;
  }
}

/**
 * Same interface as vendors/gemini.complete.
 * @param {{schema?: import("zod").ZodTypeAny}} req
 */
async function complete({ schema = null } = {}) {
  return {
    text: schema ? JSON.stringify(placeholder(schema)) : TEXT,
    toolCalls: [],
    usage: { input_tokens: 0, output_tokens: 0 },
    model: "stub",
    finish_reason: "stop",
  };
}

/** Transcription placeholder (services/ai/transcription.js). */
async function transcribe() {
  return {
    text: "[AI placeholder] No AI vendor is configured, so this voice note was not transcribed.",
    usage: { input_tokens: 0, output_tokens: 0 },
    model: "stub",
  };
}

module.exports = { name: "stub", complete, transcribe, placeholder, TEXT };
