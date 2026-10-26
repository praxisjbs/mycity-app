// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PerformanceCapacity, PerformanceSeries, PerformanceTargets } from "@mycity/contract/contract.gen.ts";
import { ModalProvider } from "@mycity/ui";

const TARGETS: PerformanceTargets = {
  availability_pct: "99.90",
  response_p95_ms: 800,
  error_pct: "1.00",
  disk_warn_free_pct: 10,
  disk_down_free_pct: 5,
  memory_warn_pct: 90,
  memory_down_pct: 95,
  cpu_warn_pct: 85,
  cpu_down_pct: 95,
  connections_warn_pct: 80,
  connections_down_pct: 90,
  updated_at: null,
  updated_by_name: null,
};

const SERIES: PerformanceSeries = {
  range: "day",
  bucket_minutes: 15,
  from: "2026-10-19T12:00:00.000Z",
  to: "2026-10-20T12:00:00.000Z",
  points: [],
  availability: { value: "99.93", target: "99.90", state: "met" },
  down_minutes: 1,
  response_p95: { value: "912", target: "800", state: "missed" },
  response_mean_ms: 96,
  failed: { value: "0.31", target: "1.00", state: "met" },
  requests: 33_000,
  per_minute: "23.4",
  peak_per_minute: 118,
  gap_minutes: 0,
  recording: true,
  last_sample_at: "2026-10-20T11:59:20.000Z",
};

const GB = 1024;
const CAPACITY: PerformanceCapacity = {
  supported: true,
  sampled_at: "2026-10-20T11:59:20.000Z",
  cpu: { cores: 8, model: "AMD EPYC", busy_pct: "23.4", steal_pct: "1.2", iowait_pct: "0.8", load_1m: "1.86", peak_pct: "71.2", peak_at: "2026-10-20T09:05:00.000Z", state: "up", parts: [{ key: "production", pct: "12.1" }, { key: "other", pct: "11.3" }] },
  memory: { total_mb: 18 * GB, in_use_mb: 5222, cache_mb: 9626, free_mb: 3584, swap_total_mb: 0, swap_used_mb: 0, state: "up", parts: [{ key: "production", mb: 1946 }, { key: "database", mb: 1638 }, { key: "other", mb: 1638 }] },
  disk: { total_mb: 236 * GB, used_mb: 24 * GB, free_mb: 200 * GB, reserved_mb: 12 * GB, state: "up", parts: [], parts_at: null, growth_mb_per_day: 512, days_to_full: 400, read_kbs: 310, write_kbs: 1240, busy_pct: "3.2" },
  network: { in_kbs: 220, out_kbs: 960, month_in_mb: 14 * GB, month_out_mb: 41 * GB, connections: 46 },
  server: { os: "Ubuntu 24.04.1 LTS", kernel: "6.8.0", node: "v20.19.0", postgres: "16.4", redis: "7.0.15", up_since: "2026-10-08T12:00:00.000Z", release: "b7c2f91a4e08d3", deployed_at: "2026-10-20T06:00:00.000Z", restart_needed: true, updates_waiting: 12, security_updates: 3 },
};

const m = vi.hoisted(() => ({ run: vi.fn(async () => ({})), call: vi.fn() }));
vi.mock("@/api/hooks", () => ({
  invalidate: vi.fn(),
  useApi: (key: string) => ({
    data: key.endsWith("/performance") ? SERIES : key.endsWith("/capacity") ? CAPACITY : undefined,
    error: null,
    reload: () => undefined,
    set: () => undefined,
  }),
  useMutation: () => ({ run: m.run, pending: false }),
  usePaged: () => ({ rows: [], page: { number: 1, size: 25, total: 0, pages: 0, has_next: false }, loading: false, error: null, q: "", setQ: () => undefined, setPage: () => undefined, sort: undefined, setSort: () => undefined }),
}));
vi.mock("@/api/client", () => ({ api: { call: m.call }, ApiError: class ApiError extends Error {} }));
vi.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ can: () => true }) }));

import { PerformanceTab } from "./Performance";
import { RouterProvider } from "@/lib/router";

describe("Settings · Performance", () => {
  beforeAll(() => {
    window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("judges each figure against its target", () => {
    render(<RouterProvider><ModalProvider><PerformanceTab /></ModalProvider></RouterProvider>);
    expect(screen.getByText("99.93%")).toBeTruthy();
    expect(screen.getByText("Target 99.90%, 1 min down")).toBeTruthy();
    expect(screen.getByText("912 ms")).toBeTruthy();
    expect(screen.getAllByText("Target 800 ms").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Target 1%").length).toBeGreaterThan(0);
    expect(screen.getByText("23.4 / min")).toBeTruthy();
  });

  it("reads the server in real units, with what is used, what is left and what uses it", () => {
    render(<RouterProvider><ModalProvider><PerformanceTab /></ModalProvider></RouterProvider>);
    expect(screen.getByText("of 18.0 GB, 12.9 GB left (72%)")).toBeTruthy();
    expect(screen.getByText("of 236.0 GB, 200.0 GB left (85%)")).toBeTruthy();
    const memory = screen.getByRole("list", { name: "Memory by service" });
    expect(within(memory).getByText("Production")).toBeTruthy();
    expect(within(memory).getByText("Cache")).toBeTruthy();
    // The root timer has not measured the disk's parts yet, and the card says so.
    expect(screen.getByText("Parts Not Measured")).toBeTruthy();
    expect(screen.getByText("About 400 days")).toBeTruthy();
    expect(screen.getByText("Restart Needed")).toBeTruthy();
  });

  it("Edit Targets refuses a red level that is not beyond its amber one", async () => {
    m.call.mockResolvedValue(TARGETS);
    const user = userEvent.setup();
    render(<RouterProvider><ModalProvider><PerformanceTab /></ModalProvider></RouterProvider>);
    await user.click(screen.getAllByRole("button", { name: "Edit Targets" })[0]);
    await screen.findByText("Availability %");
    await user.click(screen.getByRole("button", { name: "Next" }));
    const red = await screen.findByLabelText("Memory, Red %");
    await user.clear(red);
    await user.type(red, "80");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Above the warning")).toBeTruthy());
    expect(m.run).not.toHaveBeenCalled();
  });
});
