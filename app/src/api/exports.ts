import type { ExportFile, HomeReportRun } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "./client";
import { saveFile } from "./download";

/**
 * Exports: a file the server makes for the person who pressed Export or Download, saved on the
 * device they pressed it on (docs/guides/foundation.md §6.12). Nothing is emailed.
 *
 *   <ExportButton onExport={() => saveExport(api.call("POST /api/v1/audit/exports", { body: filters }))} />
 *   const { run, saved } = await saveRun(runNow.run({ ... }), (id) => api.call("GET /api/v1/home/report-runs/:id", { params: { id } }));
 *
 * The request answers at once with the file pending (202). The worker makes it, and this waits
 * for it, soon at first and every few seconds after, then saves it the moment it is done. The
 * wait is not the screen's: someone who moves to another screen still gets the file, and the
 * toast, wherever they are in the app. Someone who closes the app gets nothing, and presses again.
 *
 * Each resolves once the file is saved (saved false when it was not: the mock holds no bytes, or
 * the browser could not fetch it, which saveFile has already said), and throws an ApiError whose
 * message the button shows when the file could not be made.
 */

/** How long to wait before each look: soon at first, then every few seconds. */
const STEPS_MS = [500, 1000, 1500, 2000, 3000];
/** A file not made in this long is not coming; the person presses again. */
const GIVE_UP_MS = 5 * 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The failure a button shows, in the shape every API failure has. */
const failure = (message: string) => new ApiError(0, { error: { code: "EXPORT_FAILED", message } });

const NOT_MADE = "That file could not be made. Try again.";

/** Read `next` until `pending` says the work is over, or give up. */
async function settled<T>(first: T, next: () => Promise<T>, pending: (value: T) => boolean): Promise<T> {
  const until = Date.now() + GIVE_UP_MS;
  let now = first;
  for (let i = 0; pending(now); i += 1) {
    if (Date.now() > until) throw failure("That file is taking too long. Try again.");
    await sleep(STEPS_MS[Math.min(i, STEPS_MS.length - 1)]);
    now = await next();
  }
  return now;
}

/** An Export or Download button's file: asked for, waited on, and saved on this device. */
export async function saveExport(asked: Promise<ExportFile>): Promise<boolean> {
  const first = await asked;
  const file = await settled(
    first,
    () => api.call("GET /api/v1/exports/:id", { params: { id: first.document_id } }),
    (f) => f.status === "pending",
  );
  if (file.status === "failed") throw failure(NOT_MADE);
  return saveFile(`/api/v1/documents/${file.document_id}/content`, file.file_name);
}

/**
 * A report run somebody pressed for (Run Now, the Overview's Export): waited on through `read`,
 * and its file saved on this device, named by the run's number.
 */
export async function saveRun(
  asked: Promise<HomeReportRun>,
  read: (id: string) => Promise<HomeReportRun>,
): Promise<{ run: HomeReportRun; saved: boolean }> {
  const first = await asked;
  const run = await settled(
    first,
    () => read(first.home_report_run_id),
    (r) => r.status === "pending" || (r.status === "done" && !r.document_id),
  );
  if (run.status === "skipped") throw failure("You can no longer run this report.");
  if (run.status !== "done" || !run.document_id) throw failure(NOT_MADE);
  return { run, saved: await saveFile(`/api/v1/documents/${run.document_id}/content`, `${run.number}.${run.format}`) };
}
