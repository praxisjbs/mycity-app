import type { AiJob, AiProvider, LinkState, ModelCapability } from "@mycity/contract/contract.gen.ts";
import type { StatusTone } from "@mycity/ui";
import { JOB } from "@/features/settings/integrations/words";

/**
 * AI Control's words (docs/guides/ai-control.md §10). The job names are Settings · Integrations'
 * own, so a job reads the same on both screens.
 */
export { JOB };

/** What each job is for: the help term on its name (§6.2). */
export const JOB_HELP: Record<AiJob, string> = {
  default: "Everyday drafting and tidying, such as a record's summary or a tidied policy.",
  fast: "Short, cheap and frequent work, such as tags, titles and a classification.",
  deep_reasoning: "Judgement over several inputs, such as screening a CV against a job description.",
  image_reading: "Reading a picture or a scan, such as a receipt or a photographed form.",
  transcription: "Speech to text. When no model answers, the browser's own captions are kept as a draft.",
  embeddings: "Vectors for search in the Knowledge Hub. One model only, locked once anything is indexed.",
  top_tier: "Long, careful drafting from many sources, such as a proposal. Only for work Default and Deep Reasoning cannot do.",
};

/** What a job's models must do, so Edit Chain offers only those. */
export const NEEDS: Record<AiJob, ModelCapability> = {
  default: "text",
  fast: "text",
  deep_reasoning: "text",
  image_reading: "image",
  transcription: "audio",
  embeddings: "embeddings",
  top_tier: "text",
};

export const PROVIDER: Record<AiProvider, string> = {
  gemini: "Gemini",
  groq: "Groq",
  openai: "OpenAI",
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
};

/** A model's state in a chain, as its pill reads (§6.1). */
export const STATE: Record<LinkState, { text: string; tone: StatusTone }> = {
  ready: { text: "Ready", tone: "ok" },
  not_set_up: { text: "Not Set Up", tone: "neutral" },
  not_on_key: { text: "Not on Key", tone: "warn" },
  daily_limit: { text: "Daily Limit", tone: "warn" },
  skipped: { text: "Skipped", tone: "warn" },
  at_cap: { text: "At Cap", tone: "err" },
  personal_data: { text: "Personal Data", tone: "neutral" },
  cannot_search: { text: "Cannot Search", tone: "neutral" },
};

/** First, then each fallback in order. */
export const positionOf = (n: number) => (n === 1 ? "First" : `Fallback ${n - 1}`);

/** The Edit Chain fields, first to last. */
export const SLOTS = ["first", "fallback1", "fallback2", "fallback3"] as const;
export type Slot = (typeof SLOTS)[number];
export const SLOT_LABEL: Record<Slot, string> = { first: "First Choice", fallback1: "Fallback 1", fallback2: "Fallback 2", fallback3: "Fallback 3" };

export const HELP = {
  personalData: "What this sends can name or describe a person, so DeepSeek is never asked.",
  naira: "The dollar price at the day's rate from Exchange Rates.",
  cap: "Once reached, this provider is skipped for the rest of the month and the next model in each chain answers.",
  overall: "Once reached, no AI call is made until the month ends, whatever the chains say.",
  ownChain: "This action has a chain of its own; Use Job Chain puts it back on its job's.",
  notListed: "Models the provider's pricing page did not price. Find Prices asks about them again after 7 days.",
};

/** Why a Find Prices run stopped short, in a few words (§6.4). */
export const RUN_REASON: Record<string, string> = {
  NO_SEARCH_MODEL: "No search model ready",
  AI_DISABLED: "AI switched off",
  AI_MODULE_DISABLED: "AI off for AI Control",
  AI_CAP_REACHED: "Monthly cap reached",
  AI_UNAVAILABLE: "Search not answering",
  ANSWER_UNREADABLE: "Answer not readable",
  LOST: "Search stopped",
};

/** The Models tab's Show filter (decision 32). */
export const SHOW: Array<["usable" | "not_on_key" | "all", string]> = [
  ["usable", "On Key"],
  ["not_on_key", "Not on Key"],
  ["all", "Any"],
];

/** A dollar price as the provider writes it: "$0.30", "$0.075". */
export function usd(price: string | null): string | null {
  if (!price) return null;
  const [whole = "0", frac = ""] = price.split(".");
  const cut = frac.replace(/0+$/, "");
  return `$${whole}.${cut.length < 2 ? cut.padEnd(2, "0") : cut}`;
}
