import type {
  AiJob,
  CheckStep,
  IntegrationCheck,
  IntegrationGroup,
  IntegrationPlan,
  IntegrationSource,
  IntegrationState,
  ModelCapability,
} from "@mycity/contract/contract.gen.ts";
import type { Tone } from "@/api/types/common";

/** The words Settings · Integrations shows for the contract's codes (docs/guides/integrations.md §10.1). */

export const STATE: Record<IntegrationState, { tone: Tone; text: string }> = {
  ok: { tone: "ok", text: "Working" },
  failing: { tone: "err", text: "Failing" },
  unchecked: { tone: "neutral", text: "Not Checked" },
  not_set: { tone: "warn", text: "Not Set Up" },
};

export const SOURCE: Record<IntegrationSource, string> = {
  saved: "Saved Here",
  file: "Server File",
  none: "Nothing Set",
};

export const GROUP: Record<IntegrationGroup, string> = {
  mail: "Mail",
  maps: "Maps",
  ai: "AI",
  finance: "Finance",
  notifications: "Notifications",
};

export const PLAN: Record<IntegrationPlan, string> = {
  free: "Free",
  paid: "Paid",
};

/** The AI jobs (docs/guides/ai-control.md §6.2). */
export const JOB: Record<AiJob, string> = {
  default: "Default",
  fast: "Fast",
  deep_reasoning: "Deep Reasoning",
  image_reading: "Image Reading",
  transcription: "Transcription",
  embeddings: "Embeddings",
  top_tier: "Top Tier",
};

/** What a model does, by its set of capabilities: the five Add Model offers, and how a list row reads. */
export const DOES: Array<{ value: string; label: string; capabilities: ModelCapability[] }> = [
  { value: "text", label: "Text Only", capabilities: ["text"] },
  { value: "text_image", label: "Text and Images", capabilities: ["text", "image"] },
  { value: "multimodal", label: "Text, Images, Audio", capabilities: ["text", "image", "audio"] },
  { value: "audio", label: "Speech to Text", capabilities: ["audio"] },
  { value: "embeddings", label: "Embeddings", capabilities: ["embeddings"] },
];

/** A row's capabilities in words: the matching set's label, else each one named. */
export function doesOf(caps: readonly ModelCapability[]): string {
  const key = [...caps].sort().join(",");
  const set = DOES.find((d) => [...d.capabilities].sort().join(",") === key);
  if (set) return set.label;
  const word: Record<ModelCapability, string> = { text: "Text", image: "Images", audio: "Audio", embeddings: "Embeddings" };
  return caps.map((c) => word[c]).join(", ");
}

export const KIND: Record<IntegrationCheck["kind"], string> = {
  save: "Save",
  test: "Test",
  test_email: "Test Email",
  watch: "Watch",
  sync: "Sync",
};

export const STEP: Record<CheckStep["key"], string> = {
  setup: "Set Up",
  connect: "Connect",
  sign_in: "Sign In",
  send: "Send Email",
  imap: "IMAP",
  smtp: "SMTP",
  search: "Address Search",
  reverse: "Address Lookup",
  tile: "Map Tile",
  key: "Key",
  models: "Models",
  answer: "Answer",
  rates: "Rates",
  keys: "Keys",
  push: "Test Push",
};

/** What went wrong, in a few words. */
export const PROBLEM: Record<NonNullable<CheckStep["code"]>, string> = {
  SERVER_NOT_FOUND: "Server not found",
  NO_ANSWER: "Not answering",
  TLS_FAILED: "Secure connection failed",
  CERTIFICATE_MISMATCH: "Certificate name differs",
  AUTH_FAILED: "Password refused",
  SENDER_REFUSED: "Sender refused",
  RECIPIENT_REFUSED: "Recipient refused",
  KEY_REFUSED: "Key refused",
  OVER_QUOTA: "Over today's quota",
  UNAVAILABLE: "Not answering",
  TIMEOUT: "Timed out",
  MODEL_NOT_FOUND: "Model not available",
  SECRET_UNREADABLE: "Saved key unreadable",
  NOT_SET_UP: "Not set up",
  NO_DEVICES: "No device to reach",
  SKIPPED: "Skipped",
};

/** The help terms (tier 2). */
export const HELP = {
  file: "Set in the server's environment file. Saving here takes over from it.",
  daily: "Your plan's allowance a day. IT is warned at 80%.",
  dailyAi: "Your plan's allowance a day.",
  dailyGroq: "Seconds of audio a day, each request counted as at least ten.",
  plan: "Free stops at the daily limit and the next provider answers. Paid only counts.",
  rateDay: "Fetched after midnight, Lagos, each day.",
  hourly: "Recipients the mail host accepts an hour. Production and staging share the plan's 50.",
  perPerson: "Messages each person may send from their mailbox in an hour.",
  live: "Mailboxes held open so new mail arrives at once. Production and staging share the host's 30.",
  units: "Geoapify counts credits: a search or lookup is one, four map tiles are one.",
  security: "TLS from the first byte on 465; STARTTLS on 587.",
  host: "Blank uses each address's own domain.",
  sync: "Minutes between syncs of every mailbox, behind live mail.",
  local: "Domains whose mailboxes are on this server, comma separated. Mail to them skips the route check.",
} as const;

/** The AI connections: they warn nobody at 80% (docs/guides/ai-control.md decision 26). */
const AI_CONNECTIONS: readonly string[] = ["gemini", "groq", "openai", "anthropic", "deepseek"];

/** The Daily Limit's help for a connection. */
export const dailyHelp = (code: string) => (code === "groq" ? HELP.dailyGroq : AI_CONNECTIONS.includes(code) ? HELP.dailyAi : HELP.daily);
