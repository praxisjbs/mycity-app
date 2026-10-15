"use strict";
/**
 * Structured output: what the model is asked to return, and how its answer is
 * checked (BACKEND_STRUCTURE §14.2).
 *
 *   jsonSchemaOf(c.recruitment.JdDraft)   the shape, told to the model (and to the
 *                                         assistant's tool list, shared/ai/registry)
 *   parseStructured(text, schema)         { ok, value } or { ok: false, issues }
 *
 * The answer is parsed with the Zod schema from packages/contract, the same one the
 * module's own form validates with. A malformed answer is never half-applied:
 * llm.service retries once with the problems spelled out, then fails.
 *
 * jsonSchemaOf carries the constraints, not only the types: a uuid is
 * `format: "uuid"`, a bounded string has its lengths, an enum its values. A model told
 * only "string" guesses, and the guess is refused later in terms it was never shown.
 * Refinements (`.refine()`) are arbitrary code and are not approximated: a
 * half-expressed rule would mislead the model in the other direction.
 */

function unwrap(t) {
  let z = t;
  while (
    z &&
    z._def &&
    [
      "ZodOptional",
      "ZodNullable",
      "ZodDefault",
      "ZodCatch",
      "ZodReadonly",
      "ZodBranded",
    ].includes(z._def.typeName)
  ) {
    z = z._def.innerType || z._def.type;
  }
  if (z && z._def && z._def.typeName === "ZodEffects")
    return unwrap(z._def.schema);
  if (z && z._def && z._def.typeName === "ZodPipeline")
    return unwrap(z._def.in);
  return z;
}

const STRING_FORMAT = {
  uuid: "uuid",
  email: "email",
  url: "uri",
  datetime: "date-time",
  date: "date",
  time: "time",
};

function stringNode(def) {
  const node = { type: "string" };
  const notes = [];
  for (const c of def.checks || []) {
    if (c.kind === "min") node.minLength = c.value;
    else if (c.kind === "max") node.maxLength = c.value;
    else if (c.kind === "length") node.minLength = node.maxLength = c.value;
    else if (c.kind === "regex" && c.regex) node.pattern = c.regex.source;
    else if (STRING_FORMAT[c.kind]) node.format = STRING_FORMAT[c.kind];
    else if (c.kind === "startsWith") notes.push(`starts with "${c.value}"`);
  }
  if (notes.length) node.description = notes.join("; ");
  return node;
}

function numberNode(def) {
  const node = { type: "number" };
  for (const c of def.checks || []) {
    if (c.kind === "int") node.type = "integer";
    else if (c.kind === "min")
      node[c.inclusive === false ? "exclusiveMinimum" : "minimum"] = c.value;
    else if (c.kind === "max")
      node[c.inclusive === false ? "exclusiveMaximum" : "maximum"] = c.value;
  }
  return node;
}

const isOptional = (t) => typeof t.isOptional === "function" && t.isOptional();

/**
 * A JSON Schema for a Zod schema, for the model's instructions and the catalogue.
 * @param {import("zod").ZodTypeAny} schema
 * @returns {object}
 */
function jsonSchemaOf(schema) {
  const t = unwrap(schema);
  const def = t && t._def;
  if (!def) return {};
  const nullable =
    schema && schema._def && schema._def.typeName === "ZodNullable";
  let node;
  switch (def.typeName) {
    case "ZodObject": {
      const shape = typeof def.shape === "function" ? def.shape() : def.shape;
      const properties = {};
      const required = [];
      for (const [k, v] of Object.entries(shape)) {
        properties[k] = jsonSchemaOf(v);
        if (!isOptional(v)) required.push(k);
      }
      node = {
        type: "object",
        properties,
        ...(required.length ? { required } : {}),
        additionalProperties: def.unknownKeys !== "strict" ? undefined : false,
      };
      if (node.additionalProperties === undefined)
        delete node.additionalProperties;
      break;
    }
    case "ZodArray":
      node = { type: "array", items: jsonSchemaOf(def.type) };
      if (def.minLength) node.minItems = def.minLength.value;
      if (def.maxLength) node.maxItems = def.maxLength.value;
      break;
    case "ZodString":
      node = stringNode(def);
      break;
    case "ZodNumber":
      node = numberNode(def);
      break;
    case "ZodBoolean":
      node = { type: "boolean" };
      break;
    case "ZodEnum":
      node = { type: "string", enum: [...def.values] };
      break;
    case "ZodLiteral":
      node = { const: def.value };
      break;
    case "ZodUnion":
    case "ZodDiscriminatedUnion":
      node = {
        anyOf: (def.options instanceof Map
          ? [...def.options.values()]
          : def.options
        ).map(jsonSchemaOf),
      };
      break;
    case "ZodRecord":
      node = {
        type: "object",
        additionalProperties: jsonSchemaOf(def.valueType),
      };
      break;
    default:
      node = {};
  }
  return nullable ? { anyOf: [node, { type: "null" }] } : node;
}

/** The JSON value in a model's reply: fences and leading prose tolerated. */
function extractJson(text) {
  const s = String(text || "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const body = fenced ? fenced[1].trim() : s;
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    const start = body.search(/[[{]/);
    const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      try {
        return { ok: true, value: JSON.parse(body.slice(start, end + 1)) };
      } catch {
        /* falls through to the failure below */
      }
    }
    return { ok: false, issues: ["the reply is not JSON"] };
  }
}

/**
 * Parse a model reply against a schema.
 * @returns {{ok: true, value: *}|{ok: false, issues: string[]}}
 */
function parseStructured(text, schema) {
  const json = extractJson(text);
  if (!json.ok) return json;
  const parsed = schema.safeParse(json.value);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues
      .slice(0, 20)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}

module.exports = { jsonSchemaOf, parseStructured, extractJson, unwrap };
