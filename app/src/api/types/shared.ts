import type { Accepted, IsoDateTime, Tone } from "./common";

/** A status as the INTERIM modules word it: a tone and the words. */
export type Status = { tone: Tone; text: string };
/** A step of an INTERIM approval chain. */
export type Step = { label: string; state: "done" | "now" | null };
/** A step on an INTERIM record's trail. */
export type Trail = { title: string; when: IsoDateTime; text: string | null; tone: "hi" | "ok" | null };

/** INTERIM cross-module endpoints: exports run in the worker and land in the Mailbox. */
declare module "@/api/endpoints" {
  interface Endpoints {
    "POST /api/v1/exports": { query: never; body: { source: string; filters: Record<string, unknown> }; params: never; response: Accepted };
  }
}
