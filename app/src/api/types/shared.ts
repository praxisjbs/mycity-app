import type { Accepted } from "./common";

/** INTERIM cross-module endpoints: exports run in the worker and land in the Mailbox. */
declare module "@/api/endpoints" {
  interface Endpoints {
    "POST /api/v1/exports": { query: never; body: { source: string; filters: Record<string, unknown> }; params: never; response: Accepted };
  }
}
