// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CheckDetail, HealthCheck, SchedulerRow, SystemHealthStatus } from "@mycity/contract/contract.gen.ts";
import { ModalProvider } from "@mycity/ui";

const m = vi.hoisted(() => ({
  reload: vi.fn(),
  call: vi.fn(async () => ({ document_id: "d1", file_name: "mycity-status.md", status: "done" })),
  saveExport: vi.fn(async () => true),
  can: vi.fn(() => true),
  reads: {} as Record<string, unknown>,
}));
vi.mock("@/api/hooks", () => ({
  invalidate: vi.fn(),
  useApi: (key: string) => ({ data: m.reads[key], error: null, loading: false, reload: m.reload }),
  useMutation: () => ({ run: vi.fn(), pending: false }),
  usePaged: () => ({ rows: [], page: { number: 1, size: 25, total: 0, pages: 0, has_next: false }, loading: false, error: null, q: "", setQ: () => undefined, setPage: () => undefined }),
}));
vi.mock("@/api/client", () => ({ api: { call: m.call }, ApiError: class ApiError extends Error {} }));
vi.mock("@/api/exports", () => ({ saveExport: m.saveExport }));
vi.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ can: m.can }) }));

import { StatusTab } from "./SystemHealth";

const check = (over: Partial<HealthCheck> = {}): HealthCheck => ({
  key: "postgres",
  label: "Database",
  state: "up",
  detail: "answered in 2 ms",
  look_at: null,
  latency_ms: 2,
  since: null,
  ...over,
});

const jobs = (over: Partial<SchedulerRow> = {}): SchedulerRow => ({
  name: "media-reconcile",
  summary: "Finds files without a record",
  runs_in: "queue",
  cadence: "Daily at 02:30 (Lagos)",
  set_as: "cron 30 2 * * * Africa/Lagos",
  late_after: "26 hours",
  state: "late",
  reason: "Has not run for 2 days",
  started_at: "2026-10-17T00:00:00.000Z",
  last_run_at: null,
  duration_ms: null,
  last_ok: null,
  last_error: "ENOENT: no such file or directory",
  runs: 0,
  failures: 3,
  last_failure_at: "2026-10-18T00:00:00.000Z",
  next_run_at: null,
  ...over,
});

const late = check({
  key: "schedulers",
  label: "Background Jobs",
  state: "degraded",
  detail: "1 of 19 have not run: media-reconcile",
  look_at: "A job has not run when it should have.",
  since: "2026-10-19T10:05:00.000Z",
});

const status = (checks: HealthCheck[]): SystemHealthStatus => ({
  state: checks.some((c) => c.state !== "up") ? "degraded" : "ready",
  checked_at: "2026-10-20T12:00:00.000Z",
  release: "b7c2f91abcdef",
  deployed_at: null,
  checks,
  faults_open: 0,
  faults_new_24h: 0,
  faults_returned_24h: 0,
});

const detail = (over: Partial<CheckDetail> = {}): CheckDetail => ({
  ...late,
  facts: [{ label: "Jobs", value: "19" }],
  jobs: [jobs(), jobs({ name: "system-health", state: "on_time", reason: null, last_error: null, cadence: "Every 5 minutes", set_as: "every 300000 ms" })],
  queues: null,
  unread: [],
  ...over,
});

describe("Settings · Status", () => {
  beforeAll(() => {
    // jsdom has no matchMedia; the shells' pieces ask it whether this is a phone.
    window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
    m.reads = {};
  });

  it("with every check up, Show All lists them and Show Fewer goes back to the quiet line", async () => {
    const user = userEvent.setup();
    m.reads["GET /api/v1/system-health/status"] = status([check()]);
    render(<ModalProvider><StatusTab /></ModalProvider>);
    expect(screen.getByText("Every one of the 1 checks is up.")).toBeTruthy();
    // It showed "Show Fewer" here, though pressing it showed more.
    await user.click(screen.getByRole("button", { name: "Show All" }));
    expect(screen.getByText("Database")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Show Fewer" }));
    expect(screen.getByText("Every one of the 1 checks is up.")).toBeTruthy();
  });

  it("says since when a check that is not up has been so", () => {
    m.reads["GET /api/v1/system-health/status"] = status([check(), late]);
    render(<ModalProvider><StatusTab /></ModalProvider>);
    expect(screen.getByText("1 of 19 have not run: media-reconcile")).toBeTruthy();
    expect(screen.getByText(/^Since 19\/10\/2026/)).toBeTruthy();
  });

  it("refreshes itself every 30 seconds while it is on screen", () => {
    vi.useFakeTimers();
    m.reads["GET /api/v1/system-health/status"] = status([check()]);
    render(<ModalProvider><StatusTab /></ModalProvider>);
    expect(m.reload).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(m.reload).toHaveBeenCalledTimes(1);
  });

  it("opens a check: every job with what it was set to, its last error and why it is late", async () => {
    m.reads["GET /api/v1/system-health/status"] = status([late]);
    m.reads["GET /api/v1/system-health/checks/:key"] = detail();
    render(<ModalProvider><StatusTab /></ModalProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect((await screen.findAllByText("media-reconcile")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("cron 30 2 * * * Africa/Lagos").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Daily at 02:30 (Lagos)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ENOENT: no such file or directory").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Has not run for 2 days").length).toBeGreaterThan(0);
    expect(screen.getAllByText("system-health").length).toBeGreaterThan(0);
  });

  it("Download Brief asks for the status brief and saves it on this device", async () => {
    m.reads["GET /api/v1/system-health/status"] = status([check()]);
    render(<ModalProvider><StatusTab /></ModalProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Download Brief" }));
    expect(m.call).toHaveBeenCalledWith("POST /api/v1/system-health/status-briefs", { body: {} });
    expect(m.saveExport).toHaveBeenCalledTimes(1);
  });

  it("Download Brief is only for those who may export", () => {
    m.can.mockReturnValue(false);
    m.reads["GET /api/v1/system-health/status"] = status([check()]);
    render(<ModalProvider><StatusTab /></ModalProvider>);
    expect(screen.queryByRole("button", { name: "Download Brief" })).toBeNull();
    m.can.mockReturnValue(true);
  });
});
