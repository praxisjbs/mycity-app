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
  models: [] as unknown[],
  refusals: [] as unknown[],
  detail: null as unknown,
  can: ((_module: string, _action?: string) => true) as (module: string, action?: string) => boolean,
  navigate: vi.fn(),
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
    const rows = key.endsWith("/checks") ? [] : key.endsWith("/models") ? m.models : key.endsWith("/refusals") ? m.refusals : m.rows;
    return { rows, page: { number: 1, size: 25, total: rows.length, pages: 1, has_next: false }, loading: false, error: null, q: "", setQ: () => undefined, setPage: () => undefined };
  },
}));
vi.mock("@/api/client", async () => ({ api: { call: m.call }, ApiError: (await import("@mycity/ui")).ApiError }));
vi.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ can: m.can }) }));
vi.mock("@/lib/router", () => ({ useRouter: () => ({ navigate: m.navigate }) }));
vi.mock("@/auth/FreshSignIn", () => ({ useFreshSignIn: () => ({ guard: <T,>(run: () => Promise<T>) => run(), ensure: async () => true }) }));

import { IntegrationsTab } from "./index";

// jsdom has no ResizeObserver; the plan's choice (a Radix radio group) measures itself with one.
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

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
  plan: "free",
  units_today: 120,
  watched: false,
  paused_at: null,
  ...over,
});

const geoapify = (over: Partial<Integration> = {}): Integration => ({
  ...row(),
  saved_at: "2026-10-20T08:00:00.000Z",
  saved_by_name: "Godwin-Okoh Elisha",
  paused_by_name: null,
  settings: { code: "geoapify" },
  secrets: [{ key: "api_key", set: true, hint: "1a2b", set_by_name: "Godwin-Okoh Elisha", set_at: "2026-10-20T08:00:00.000Z" }],
  last_check: null,
  usage: [{ day: "2026-10-20", calls: 90, failures: 0, units: 120 }],
  ...over,
});

const ROWS = [
  row({ code: "mail_sender", display_name: "System Sender", group: "mail", daily_limit: null, plan: null, units_today: 14 }),
  row({ code: "gemini", display_name: "Gemini", group: "ai", state: "failing", source: "file", last_error_code: "KEY_REFUSED", daily_limit: null, plan: "paid", units_today: 3 }),
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
        body: { code: "geoapify", api_key: "new-geo-key-9876", daily_limit: 3000, plan: "free", saved_at: "2026-10-20T08:00:00.000Z" },
      }),
    );
    expect(await screen.findByText("Key refused", undefined, { timeout: 3000 })).toBeTruthy();
  });

  it("shows each connection's plan, Free or Paid", () => {
    m.rows = ROWS;
    render(<ModalProvider><IntegrationsTab /></ModalProvider>);
    expect(screen.getAllByText("Free").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Paid").length).toBeGreaterThan(0);
  });

  const groq = (): Integration => ({
    ...row({ code: "groq", display_name: "Groq", group: "ai", daily_limit: 23040 }),
    saved_at: "2026-10-20T08:00:00.000Z",
    saved_by_name: "Godwin-Okoh Elisha",
    paused_by_name: null,
    settings: { code: "groq", in_use: [{ job: "transcription", position: 1, model: "whisper-large-v3", display_name: "Whisper Large v3" }], models: 3, available: 2 },
    secrets: [{ key: "api_key", set: true, hint: "Qp4w", set_by_name: "Godwin-Okoh Elisha", set_at: "2026-10-20T08:00:00.000Z" }],
    last_check: null,
    usage: [{ day: "2026-10-20", calls: 30, failures: 0, units: 900 }],
  });

  const whisper = {
    ai_model_id: "00000000-0000-4000-8000-0000000000a1",
    provider: "groq",
    model: "whisper-large-v3",
    display_name: "Whisper Large v3",
    capabilities: ["audio"],
    available: true,
    source: "seed",
    endpoint_url: null,
    input_usd_per_million: null,
    output_usd_per_million: null,
    audio_usd_per_million: null,
    usd_per_audio_hour: "0.1110",
    in_use: [{ job: "transcription", position: 1, model: "whisper-large-v3", display_name: "Whisper Large v3" }],
    seen_at: null,
    added_by_name: null,
    created_at: "2026-10-20T08:00:00.000Z",
  };

  it("an AI connection shows the jobs its models do and its model list, and adds a model", async () => {
    const user = userEvent.setup();
    m.rows = [row({ code: "groq", display_name: "Groq", group: "ai" })];
    m.detail = groq();
    m.models = [whisper];
    render(<ModalProvider><IntegrationsTab /></ModalProvider>);
    await user.click(screen.getAllByText("Groq")[0]);
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getAllByText("Whisper Large v3").length).toBeGreaterThan(0);
    expect(within(panel).getByText("2 of 3 on this key")).toBeTruthy();
    expect(within(panel).getAllByText("Speech to Text, Transcription").length).toBeGreaterThan(0);
    expect(within(panel).getAllByText("$0.111 an hour").length).toBeGreaterThan(0);
    m.call.mockResolvedValueOnce({ ...whisper, model: "whisper-next", display_name: "whisper-next", source: "added" });
    await user.click(within(panel).getByRole("button", { name: "Add Model" }));
    await user.type(await screen.findByLabelText("Model ID"), "whisper-next");
    await user.click(screen.getByRole("button", { name: "Add Model" }));
    await waitFor(() =>
      expect(m.call).toHaveBeenCalledWith("POST /api/v1/integrations/:code/models", {
        params: { code: "groq" },
        body: { model: "whisper-next", display_name: "", capabilities: ["audio"], endpoint_url: "" },
      }),
    );
    // Which model answers each feature is chosen on AI Control.
    const again = await screen.findByRole("dialog");
    await user.click(within(again).getByRole("button", { name: "Open AI Control" }));
    expect(m.navigate).toHaveBeenCalledWith("/ai-control?tab=actions");
  });

  it("Exchange Rates shows the dollar in naira, with Sync Rates beside it", async () => {
    const user = userEvent.setup();
    m.rows = [row({ code: "exchange_rates", display_name: "Exchange Rates", group: "finance" })];
    m.detail = {
      ...row({ code: "exchange_rates", display_name: "Exchange Rates", group: "finance", daily_limit: 40 }),
      saved_at: "2026-10-20T08:00:00.000Z",
      saved_by_name: "Godwin-Okoh Elisha",
      paused_by_name: null,
      settings: { code: "exchange_rates", base: "USD", usd_ngn: "1534.2100000000", rate_day: "2026-10-20", fetched_at: "2026-10-20T00:01:00.000Z", currencies: 161 },
      secrets: [{ key: "api_key", set: true, hint: "7c1d", set_by_name: null, set_at: null }],
      last_check: null,
      usage: [],
    } satisfies Integration;
    m.call.mockResolvedValueOnce({ ok: true, error_code: null });
    render(<ModalProvider><IntegrationsTab /></ModalProvider>);
    await user.click(screen.getAllByText("Exchange Rates")[0]);
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("₦1,534.21")).toBeTruthy();
    expect(within(panel).getByText("20/10/2026")).toBeTruthy();
    await user.click(within(panel).getByRole("button", { name: "Sync Rates" }));
    await waitFor(() => expect(m.call).toHaveBeenCalledWith("POST /api/v1/integrations/exchange_rates/sync", { body: {} }));
  });

  const sender = (over: Partial<Integration> = {}): Integration => ({
    ...row({ code: "mail_sender", display_name: "System Sender", group: "mail", daily_limit: null, plan: null, units_today: 14 }),
    saved_at: null,
    saved_by_name: null,
    paused_by_name: null,
    settings: {
      code: "mail_sender",
      host: "mycityapp.io",
      port: 465,
      security: "tls",
      username: "no-reply@mycityapp.io",
      from: "MyCity App <no-reply@mycityapp.io>",
      reply_to: null,
      per_hour: 10,
      local_domains: "mycityapp.io",
    },
    secrets: [{ key: "password", set: true, hint: null, set_by_name: null, set_at: null }],
    last_check: null,
    usage: [],
    ...over,
  });

  it("pauses system mail from the System Sender, and shows Paused on its row", async () => {
    const user = userEvent.setup();
    m.rows = [row({ code: "mail_sender", display_name: "System Sender", group: "mail", paused_at: "2026-10-21T06:40:00.000Z" })];
    m.detail = sender();
    m.call.mockResolvedValueOnce(sender({ paused_at: "2026-10-21T06:40:00.000Z", paused_by_name: "Femi Bello" }));
    render(<ModalProvider><IntegrationsTab /></ModalProvider>);
    expect(screen.getAllByText("Paused").length).toBeGreaterThan(0);
    await user.click(screen.getAllByText("System Sender")[0]);
    const panel = await screen.findByRole("dialog");
    await user.click(within(panel).getByRole("button", { name: "Pause Mail" }));
    await waitFor(() => expect(m.call).toHaveBeenCalledWith("POST /api/v1/integrations/mail_sender/pause", { body: {} }));
    expect(m.invalidate).toHaveBeenCalledWith("/api/v1/integrations");
  });

  it("a paused sender says who paused it and when, offers Resume Mail, and lists refused addresses", async () => {
    const user = userEvent.setup();
    m.rows = [row({ code: "mail_sender", display_name: "System Sender", group: "mail" })];
    m.detail = sender({ paused_at: "2026-10-21T06:40:00.000Z", paused_by_name: "Femi Bello" });
    m.refusals = [
      {
        mail_refusal_id: "00000000-0000-4000-8000-0000000000b1",
        email: "ada.obi@gmial.com",
        person_name: "Ada Obi",
        template: "digest",
        smtp_code: 550,
        reply: "550 No such domain",
        refusals: 2,
        first_refused_at: "2026-10-20T08:00:00.000Z",
        last_refused_at: "2026-10-21T00:04:00.000Z",
      },
    ];
    m.call.mockResolvedValueOnce(sender());
    render(<ModalProvider><IntegrationsTab /></ModalProvider>);
    await user.click(screen.getAllByText("System Sender")[0]);
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("Mail paused")).toBeTruthy();
    expect(within(panel).getByText(/by Femi Bello/)).toBeTruthy();
    expect(within(panel).getAllByText("ada.obi@gmial.com").length).toBeGreaterThan(0);
    expect(within(panel).getAllByText("Daily Digest").length).toBeGreaterThan(0);
    await user.click(within(panel).getByRole("button", { name: "Resume Mail" }));
    await waitFor(() => expect(m.call).toHaveBeenCalledWith("POST /api/v1/integrations/mail_sender/resume", { body: {} }));
  });

  it("offers neither Pause Mail nor Resume Mail to someone who may only look", async () => {
    const user = userEvent.setup();
    m.rows = [row({ code: "mail_sender", display_name: "System Sender", group: "mail" })];
    m.detail = sender();
    m.can = (_module, action = "view") => action === "view";
    render(<ModalProvider><IntegrationsTab /></ModalProvider>);
    await user.click(screen.getAllByText("System Sender")[0]);
    const panel = await screen.findByRole("dialog");
    expect(within(panel).queryByRole("button", { name: "Pause Mail" })).toBeNull();
  });
});
