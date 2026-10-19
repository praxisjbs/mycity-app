import type { ExportFile } from "@mycity/contract/contract.gen.ts";
import { todayIso } from "@mycity/ui";
import type { RawResponse } from "../../client";
import { invalid, notFound, ok, route, uuid } from "../core";

/*
 * Exports, as the real API answers them (docs/guides/foundation.md §6.12): the request answers
 * 202 with its file pending, and GET /exports/:id answers it done at the next look, for the
 * person who asked alone. The mock holds no bytes, so the download then says so (api/download.ts).
 */
const EXPORTS = new Map<string, { file: ExportFile; owner: string }>();

/** A file asked for by `owner`, named as the server names one ("my-attendance-2026-10-19.xlsx"). */
export function exportFile(owner: string, base: string, extension: "xlsx" | "pdf" = "xlsx"): RawResponse {
  const file: ExportFile = { document_id: uuid(), file_name: `${base}-${todayIso()}.${extension}`, status: "pending" };
  EXPORTS.set(file.document_id, { file, owner });
  return { status: 202, body: file };
}

route("GET /api/v1/exports/:id", (req) => {
  const held = EXPORTS.get(req.params.id);
  return held && held.owner === req.user ? ok({ ...held.file, status: "done" }) : notFound();
});

route("POST /api/v1/exports", (req) => (req.body.source ? exportFile(req.user!, String(req.body.source)) : invalid({ source: ["Say what to export"] })));
