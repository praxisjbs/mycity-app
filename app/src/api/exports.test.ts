// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportFile, HomeReportRun } from "@mycity/contract/contract.gen.ts";

vi.mock("./client", async () => ({ api: { call: vi.fn() }, ApiError: (await import("@mycity/ui")).ApiError }));
vi.mock("./download", () => ({ saveFile: vi.fn(async () => true) }));

const { api, ApiError } = await import("./client");
const { saveFile } = await import("./download");
const { saveExport, saveRun } = await import("./exports");

const asked: ExportFile = { document_id: "2c5b8b8e-6f1d-4f8e-9a51-6f3c1c2d9e01", file_name: "audit-log-2026-10-19.xlsx", status: "pending" };
const call = vi.mocked(api.call) as unknown as ReturnType<typeof vi.fn>;

/** Runs `work` with every wait it makes passed at once. */
async function settle<T>(work: Promise<T>): Promise<T> {
  const caught = work.catch((e: unknown) => e);
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  const out = await caught;
  if (out instanceof Error) throw out;
  return out as T;
}

beforeEach(() => {
  vi.useFakeTimers();
  call.mockReset();
  vi.mocked(saveFile).mockClear();
});

afterEach(() => vi.useRealTimers());

describe("saveExport", () => {
  it("waits while the worker makes the file, then saves it on this device under its name", async () => {
    call.mockResolvedValueOnce(asked).mockResolvedValueOnce({ ...asked, status: "done" });
    expect(await settle(saveExport(Promise.resolve(asked)))).toBe(true);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenCalledWith("GET /api/v1/exports/:id", { params: { id: asked.document_id } });
    expect(saveFile).toHaveBeenCalledWith(`/api/v1/documents/${asked.document_id}/content`, "audit-log-2026-10-19.xlsx");
  });

  it("says in one line when the file could not be made, and saves nothing", async () => {
    call.mockResolvedValueOnce({ ...asked, status: "failed" });
    const failed = settle(saveExport(Promise.resolve(asked)));
    await expect(failed).rejects.toBeInstanceOf(ApiError);
    await expect(failed).rejects.toThrow("That file could not be made. Try again.");
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("gives up on a file not made in five minutes", async () => {
    call.mockResolvedValue(asked);
    await expect(settle(saveExport(Promise.resolve(asked)))).rejects.toThrow("That file is taking too long. Try again.");
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("passes a refused request straight to the button", async () => {
    const refused = new ApiError(429, { error: { code: "DATA_EXPORT_LIMIT", message: "A copy of your data was made for People today. Ask again tomorrow." } });
    await expect(settle(saveExport(Promise.reject(refused)))).rejects.toBe(refused);
    expect(call).not.toHaveBeenCalled();
  });
});

describe("saveRun", () => {
  const run = { home_report_run_id: "8f0c3a43-31f5-4c7a-8d7b-2b3c4d5e6f70", number: "RPT-0215", format: "pdf", status: "pending", document_id: null } as unknown as HomeReportRun;

  it("waits on the run through its own read and saves its file under the run's number", async () => {
    const read = vi.fn().mockResolvedValueOnce(run).mockResolvedValueOnce({ ...run, status: "done", document_id: "doc-1" });
    const out = await settle(saveRun(Promise.resolve(run), read));
    expect(read).toHaveBeenCalledWith(run.home_report_run_id);
    expect(out).toMatchObject({ saved: true, run: { number: "RPT-0215", status: "done" } });
    expect(saveFile).toHaveBeenCalledWith("/api/v1/documents/doc-1/content", "RPT-0215.pdf");
  });

  it("says so when the reader may no longer have the report", async () => {
    const read = vi.fn().mockResolvedValue({ ...run, status: "skipped" });
    await expect(settle(saveRun(Promise.resolve(run), read))).rejects.toThrow("You can no longer run this report.");
    expect(saveFile).not.toHaveBeenCalled();
  });
});
