import type { CheckStep, IntegrationCheck, IntegrationGroup, IntegrationSource, IntegrationState } from "@mycity/contract/contract.gen.ts";
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
  notifications: "Notifications",
};

export const KIND: Record<IntegrationCheck["kind"], string> = {
  save: "Save",
  test: "Test",
  test_email: "Test Email",
  watch: "Watch",
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
  answer: "Answer",
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
  hourly: "Recipients the mail host accepts an hour. Production and staging share the plan's 50.",
  perPerson: "Messages each person may send from their mailbox in an hour.",
  live: "Mailboxes held open so new mail arrives at once. Production and staging share the host's 30.",
  units: "Geoapify counts credits: a search or lookup is one, four map tiles are one.",
  security: "TLS from the first byte on 465; STARTTLS on 587.",
  host: "Blank uses each address's own domain.",
  sync: "Minutes between syncs of every mailbox, behind live mail.",
  local: "Domains whose mailboxes are on this server, comma separated. Mail to them skips the route check.",
} as const;
