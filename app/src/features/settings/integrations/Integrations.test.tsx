// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Integration, IntegrationRow } from "@mycity/contract/contract.gen.ts";
import { ApiError, ModalProvider } from "@mycity/ui";

const m = vi.hoisted(() => ({
  call: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({})),
  invalidate: vi.fn(),
  rows: [] as unknown[],
  detail: null as unknown,
  can: ((_module: string, _action?: string) => true) as (module: string, action?: string) => boolean,
}));
vi.mock("@/api/hooks", () => ({
  invalidate: m.invalidate,
  useApi: (key: string) => ({
    data: key.endsWith("/summary") ? { working: 3, failing: 1, unchecked: 1, not_set: 0 } : m.detail,
    error: null,
    loading: false,
    reload: () => undefined,
    set: () => undefined,
  }),
  usePaged: (key: string) => {
    const rows = key.endsWith("/checks") ? [] : m.rows;
    return { rows, page: { number: 1, size: 25, total: rows.length, pages: 1, has_next: false }, loading: false, error: null, q: "", setQ: () => undefined, setPage: () => undefined };
  },
}));
vi.mock("@/api/client", async () => ({ api: { call: m.call }, ApiError: (await import("@mycity/ui")).ApiError }));
vi.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ can: m.can }) }));
vi.mock("@/auth/FreshSignIn", () => ({ useFreshSignIn: () => ({ guard: <T,>(run: () => Promise<T>) => run(), ensure: async () => true }) }));

import { IntegrationsTab } from "./index";

const row = (over: Partial<IntegrationRow> = {}): IntegrationRow => ({
  integration_connection_id: "00000000-0000-4000-8000-000000000001",
  code: "geoapify",
  display_name: "Geoapify",
  group: "maps",
  state: "ok",
  source: "saved",
  last_checked_at: null,
  last_error_code: null,
  daily_limit: 3000,
  units_today: 120,
  watched: false,
  ...over,
});

const geoapify = (over: Partial<Integration> = {}): Integration => ({
  ...row(),
  saved_at: "2026-10-20T08:00:00.000Z",
  saved_by_name: "Godwin-Okoh Elisha",
  settings: { code: "geoapify" },
  secrets: [{ key: "api_key", set: true, hint: "1a2b", set_by_name: "Godwin-Okoh Elisha", set_at: "2026-10-20T08:00:00.000Z" }],
  last_check: null,
  usage: [{ day: "2026-10-20", calls: 90, failures: 0, units: 120 }],
  ...over,
});

const ROWS = [
  row({ code: "mail_sender", display_name: "System Sender", group: "mail", daily_limit: null, units_today: 14 }),
  row({ code: "gemini", display_name: "Gemini", group: "ai", state: "failing", source: "file", last_error_code: "KEY_REFUSED", daily_limit: null, units_today: 3 }),
  row(),
];

describe("Settings · Integrations", () => {
  beforeAll(() => {
    // jsdom has no matchMedia; the shells' pieces ask it whether this is a phone.
    window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    m.can = () => true;
  });

  it("lists each connection with its state, its source or its failure, and today's use", () => {
    m.rows = ROWS;
    render(<ModalProvider><IntegrationsTab /></ModalProvider>);
    expect(screen.getAllByText("Working").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Geoapify").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Key refused").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Saved Here").length).toBeGreaterThan(0);
    expect(screen.getAllByText("120 of 3,000").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Test" })).toHaveLength(3);
  });

  it("offers no Test to someone who may only look", () => {
    m.rows = ROWS;
    m.can = (_module, action = "view") => action === "view";
    render(<ModalProvider><IntegrationsTab /></ModalProvider>);
    expect(screen.queryByRole("button", { name: "Test" })).toBeNull();
  });

  it("opens a connection with its key as Saved and its last four, and tests it on the address typed", async () => {
    const user = userEvent.setup();
    m.rows = [row()];
    m.detail = geoapify();
    m.call.mockResolvedValueOnce({ ok: true, error_code: null });
    render(<ModalProvider><IntegrationsTab /></ModalProvider>);
    await user.click(screen.getAllByText("Geoapify")[0]);
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText(/Saved, ends 1a2b/)).toBeTruthy();
    const address = within(panel).getByLabelText("Address");
    await user.clear(address);
    await user.type(address, "7 Admiralty Way");
    await user.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(m.call).toHaveBeenCalledWith("POST /api/v1/integrations/:code/test", { params: { code: "geoapify" }, body: { address: "7 Admiralty Way" } }));
    expect(m.invalidate).toHaveBeenCalledWith("/api/v1/integrations");
  });

  it("saves a replaced key with the saved_at it opened with, and marks a refused key on its field", async () => {
    const user = userEvent.setup();
    m.rows = [row()];
    m.detail = geoapify();
    m.call.mockRejectedValueOnce(new ApiError(422, { error: { code: "TEST_FAILED", message: "The test failed. Check the marked field.", fields: { api_key: ["Key refused"] } } }));
    render(<ModalProvider><IntegrationsTab /></ModalProvider>);
    await user.click(screen.getAllByText("Geoapify")[0]);
    await user.click(await screen.findByRole("button", { name: "Edit Settings" }));
    await user.click(await screen.findByRole("button", { name: "Replace" }));
    await user.type(screen.getByLabelText("API Key"), "new-geo-key-9876");
    await user.click(screen.getByRole("button", { name: "Save Settings" }));
    await waitFor(() =>
      expect(m.call).toHaveBeenCalledWith("PUT /api/v1/integrations/:code", {
        params: { code: "geoapify" },
        body: { code: "geoapify", api_key: "new-geo-key-9876", daily_limit: 3000, saved_at: "2026-10-20T08:00:00.000Z" },
      }),
    );
    expect(await screen.findByText("Key refused", undefined, { timeout: 3000 })).toBeTruthy();
  });
});
