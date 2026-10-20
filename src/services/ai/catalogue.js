"use strict";
/**
 * An AI connection's model list as its provider gives it (docs/guides/integrations.md §1.2
 * decision 2): asked with a key, free, and each model sorted into what the ERP uses it for.
 *
 *   const models = await catalogue.fetch("gemini", apiKey);
 *   // → [{ model: "gemini-3.8-flash", display_name: "Gemini 3.8 Flash", capabilities: ["text", "image", "audio"] }, ...]
 *
 * A model the ERP has no use for (speech out, image or video generation, live sessions,
 * moderation) is left off. Anthropic's list is Sonnet and Haiku only (decision 3). Nothing is
 * stored here: the integrations module keeps the list (ai_model) when a key is saved or tested.
 * Throws the vendor's VendorError; callCode() names it.
 */
const VENDORS = Object.freeze({
  gemini: require("./vendors/gemini"),
  groq: require("./vendors/groq"),
  openai: require("./vendors/openai"),
  anthropic: require("./vendors/anthropic"),
  deepseek: require("./vendors/deepseek"),
});

const MULTIMODAL = ["text", "image", "audio"];

/** Gemini models whose output is not text, or that only work in a live session. */
const GEMINI_SKIP = /(tts|image-generation|-image|imagen|veo|live|native-audio|robotics|computer-use|aqa)/i;

function gemini(m) {
  if (m.methods.includes("embedContent")) return ["embeddings"];
  if (!m.methods.includes("generateContent") || GEMINI_SKIP.test(m.id)) return null;
  if (/^gemini-/i.test(m.id)) return MULTIMODAL;
  return ["text"];
}

function groq(m) {
  if (/whisper|transcribe/i.test(m.id)) return ["audio"];
  if (/tts|guard|playai/i.test(m.id)) return null;
  return ["text"];
}

function openai(m) {
  if (/embedding/i.test(m.id)) return ["embeddings"];
  if (/whisper|transcribe/i.test(m.id)) return ["audio"];
  if (/tts|audio|realtime|image|dall-e|sora|moderation|search|babbage|davinci|instruct|codex/i.test(m.id)) return null;
  if (/^(gpt-|o\d|chatgpt-)/i.test(m.id)) return ["text", "image"];
  return null;
}

const anthropic = (m) => (m.image ? ["text", "image"] : ["text"]);
const deepseek = () => ["text"];

const SORT = { gemini, groq, openai, anthropic, deepseek };

/**
 * What a provider's model is used for, or null when the ERP has no use for it.
 * @param {string} provider
 * @param {{id: string, methods?: string[], image?: boolean}} m
 */
function capabilitiesOf(provider, m) {
  return SORT[provider]({ methods: [], ...m });
}

/**
 * The provider's own list, asked with this key.
 * @param {string} provider  an AI connection's code
 * @param {string} apiKey
 * @param {{vendors?: object, timeoutMs?: number}} [opts]  vendors: tests
 * @returns {Promise<Array<{model: string, display_name: string, capabilities: string[]}>>}
 */
async function fetch(provider, apiKey, { vendors = VENDORS, timeoutMs = 20_000 } = {}) {
  const vendor = vendors[provider];
  if (!vendor) throw new Error(`ai catalogue: no vendor "${provider}"`);
  const list =
    provider === "gemini" ? await vendor.listModelsDetailed({ apiKey, timeoutMs }) : await vendor.listModels({ apiKey, timeoutMs });
  const out = [];
  const seen = new Set();
  for (const m of list) {
    const caps = capabilitiesOf(provider, m);
    if (!caps || seen.has(m.id.toLowerCase())) continue;
    seen.add(m.id.toLowerCase());
    out.push({ model: m.id, display_name: m.display_name || m.id, capabilities: caps });
  }
  return out;
}

module.exports = { fetch, capabilitiesOf, VENDORS };
