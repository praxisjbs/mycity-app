import type { ExportFile } from "@mycity/contract/contract.gen.ts";

/**
 * INTERIM cross-module endpoints: an export of a module still to come, made in the worker and
 * downloaded on the device that asked (api/exports.ts), as every export is.
 */
declare module "@/api/endpoints" {
  interface Endpoints {
    "POST /api/v1/exports": { query: never; body: { source: string; filters: Record<string, unknown> }; params: never; response: ExportFile };
  }
}
