// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AiActionRow, AiChain, AiControlModel, AiJobRow, AiPriceProposal, AiSpend } from "@mycity/contract/contract.gen.ts";
import { ModalProvider } from "@mycity/ui";

const m = vi.hoisted(() => ({
  call: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({})),
  invalidate: vi.fn(),
  data: {} as Record<string, unknown>,
  rows: {} as Record<string, unknown[]>,
  can: ((_module: string, _action?: string) => true) as (module: string, action?: string) => boolean,
  navigate: vi.fn(),
}));
vi.mock("@/api/hooks", () => ({
  invalidate: m.invalidate,
  useApi: (key: string) => ({ data: m.data[key] ?? null, error: null, loading: false, reload: () => undefined, set: () => undefined }),
  usePaged: (key: string) => {
    const rows = m.rows[key] ?? [];
    return { rows, page: { number: 1, size: 25, total: rows.length, pages: 1, has_next: false }, loading: false, error: null, q: "", setQ: () => undefined, setPage: () => undefined, reload: () => undefined };
  },
}));
vi.mock("@/api/client", async () => ({ api: { call: m.call }, ApiError: (await import("@mycity/ui")).ApiError }));
vi.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ can: m.can }) }));
vi.mock("@/lib/router", () => ({ useRouter: () => ({ navigate: m.navigate }) }));

import AiControl from "./index";

if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const link = (position: number, provider: "gemini" | "anthropic" | "groq", model: string, display_name: string, state: AiChain["links"][number]["state"] = "ready") => ({
  position,
  provider,
  model,
  display_name,
  state,
  until: null,
});

const chain = (key: string, links: AiChain["links"], over: Partial<AiChain> = {}): AiChain => ({ scope: "job", key, stored: false, links, updated_by_name: null, updated_at: null, ...over });

const JOBS: AiJobRow[] = [
  { job: "default", chain: chain("default", [link(1, "gemini", "gemini-3.8-flash", "Gemini 3.8 Flash")]), actions: 1, locked: false },
  {
    job: "top_tier",
    chain: chain("top_tier", [link(1, "gemini", "gemini-2.5-pro", "Gemini 2.5 Pro"), link(2, "anthropic", "claude-sonnet-5-5", "Claude Sonnet 5.5", "not_set_up")]),
    actions: 0,
    locked: false,
  },
];

const ACTIONS: AiActionRow[] = [
  {
    key: "policy-tidy",
    label: "Tidy Policy",
    module: "knowledge",
    job: "default",
    personal_data: true,
    reason: null,
    chosen_by: "TB",
    chosen_at: "2026-10-20",
    built: true,
    own_chain: false,
    chain: JOBS[0].chain,
    calls_today: 4,
  },
];

const MODEL: AiControlModel = {
  ai_model_id: "00000000-0000-4000-8000-000000000001",
  provider: "gemini",
  model: "gemini-2.5-flash",
  display_name: "Gemini 2.5 Flash",
  capabilities: ["text", "image", "audio"],
  available: true,
  plan: "paid",
  input_usd_per_million: "0.3000",
  output_usd_per_million: "2.5000",
  audio_usd_per_million: "1.0000",
  usd_per_audio_hour: null,
  usd_per_thousand_searches: null,
  input_ngn_per_million: "460.26",
  output_ngn_per_million: "3835.53",
  ngn_per_audio_hour: null,
  in_chains: [{ scope: "action", key: "data-answers", label: "Data Answers", position: 2 }],
  proposed: false,
};

const PROPOSAL: AiPriceProposal = {
  ai_price_proposal_id: "00000000-0000-4000-8000-0000000000aa",
  ai_model_id: "00000000-0000-4000-8000-000000000002",
  provider: "gemini",
  model: "gemini-3.8-flash",
  display_name: "Gemini 3.8 Flash",
  input_usd_per_million: "0.5000",
  output_usd_per_million: "3.0000",
  audio_usd_per_million: null,
  usd_per_audio_hour: null,
  usd_per_thousand_searches: "14.0000",
  source_url: "https://ai.google.dev/gemini-api/docs/pricing",
  created_at: "2026-10-20T08:00:00.000Z",
};

const SPEND: AiSpend = {
  month: "2026-10-01",
  rate: { usd_ngn: "1534.2100000000", day: "2026-10-20" },
  overall: { spent_ngn: "19937.05", cap_ngn: "100000.00", at_cap: false },
  providers: [
    { provider: "gemini", plan: "paid", set_up: true, spent_ngn: "18420.55", cap_ngn: "50000.00", at_cap: false, calls: 412 },
    { provider: "groq", plan: "free", set_up: true, spent_ngn: "0.00", cap_ngn: null, at_cap: false, calls: 214 },
  ],
  days: [
    { day: "2026-10-19", spent_ngn: "820.00" },
    { day: "2026-10-20", spent_ngn: "410.00" },
  ],
};

const page = (tab: string) =>
  render(
    <ModalProvider>
      <AiControl tab={tab} id={null} />
    </ModalProvider>,
  );

describe("AI Control", () => {
  beforeAll(() => {
    // jsdom has no matchMedia; the shells' pieces ask it whether this is a phone.
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    m.can = () => true;
    m.data = {};
    m.rows = {};
  });

  it("Actions: each job's chain with each model's state; Make First moves a fallback to the front", async () => {
    m.rows = { "GET /api/v1/ai-control/jobs": JOBS, "GET /api/v1/ai-control/actions": ACTIONS };
    m.call.mockResolvedValueOnce(chain("top_tier", [link(1, "anthropic", "claude-sonnet-5-5", "Claude Sonnet 5.5", "not_set_up"), link(2, "gemini", "gemini-2.5-pro", "Gemini 2.5 Pro")], { stored: true }));
    page("actions");
    expect(screen.getByRole("heading", { name: "AI Control" })).toBeTruthy();
    expect(screen.getAllByText("Claude Sonnet 5.5").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not Set Up").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tidy Policy").length).toBeGreaterThan(0);
    await userEvent.click(screen.getAllByRole("button", { name: "Make First" })[0]);
    await waitFor(() =>
      expect(m.call).toHaveBeenCalledWith("POST /api/v1/ai-control/chains/:scope/:key/first", { params: { scope: "job", key: "top_tier" }, body: { position: 2 } }),
    );
    expect(m.invalidate).toHaveBeenCalledWith("/api/v1/ai-control");
  });

  it("Edit Chain opens with the chain in use and saves it whole", async () => {
    m.rows = { "GET /api/v1/ai-control/jobs": JOBS, "GET /api/v1/ai-control/actions": [] };
    m.call.mockResolvedValueOnce(JOBS[1].chain);
    page("actions");
    await userEvent.click(screen.getAllByRole("button", { name: "Edit Chain" })[1]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("First Choice")).toBeTruthy();
    expect(within(dialog).getByText("Fallback 3")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save Chain" }));
    await waitFor(() =>
      expect(m.call).toHaveBeenCalledWith("PUT /api/v1/ai-control/chains/:scope/:key", {
        params: { scope: "job", key: "top_tier" },
        body: {
          links: [
            { provider: "gemini", model: "gemini-2.5-pro" },
            { provider: "anthropic", model: "claude-sonnet-5-5" },
          ],
        },
      }),
    );
  });

  it("Operations & People see the chains and change nothing", () => {
    m.can = (_mod, action) => action === "view";
    m.rows = { "GET /api/v1/ai-control/jobs": JOBS, "GET /api/v1/ai-control/actions": ACTIONS };
    page("actions");
    expect(screen.queryByRole("button", { name: "Edit Chain" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Make First" })).toBeNull();
  });

  it("Models: a proposed price is accepted as found; Find Prices asks the worker", async () => {
    m.data = { "GET /api/v1/ai-control/models/summary": { finding: false, last_found_at: null, proposals: 1, rate: { usd_ngn: "1534.2100000000", day: "2026-10-20" } } };
    m.rows = { "GET /api/v1/ai-control/models": [MODEL], "GET /api/v1/ai-control/prices": [PROPOSAL] };
    page("models");
    expect(screen.getByText("$0.30 / $2.50 per M")).toBeTruthy();
    expect(screen.getByText("Data Answers (Fallback 1)")).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: "Accept" })[0]);
    await waitFor(() =>
      expect(m.call).toHaveBeenCalledWith("POST /api/v1/ai-control/prices/:id/accept", {
        params: { id: PROPOSAL.ai_price_proposal_id },
        body: { input_usd_per_million: "0.5000", output_usd_per_million: "3.0000", audio_usd_per_million: "", usd_per_audio_hour: "", usd_per_thousand_searches: "14.0000" },
      }),
    );
    await userEvent.click(screen.getAllByRole("button", { name: "Find Prices" })[0]);
    await waitFor(() => expect(m.call).toHaveBeenCalledWith("POST /api/v1/ai-control/prices/find", { body: {} }));
  });

  it("Models: while Find Prices runs, it says so instead of offering the button", () => {
    m.data = { "GET /api/v1/ai-control/models/summary": { finding: true, last_found_at: null, proposals: 0, rate: null } };
    m.rows = { "GET /api/v1/ai-control/models": [MODEL] };
    page("models");
    expect(screen.queryByRole("button", { name: "Find Prices" })).toBeNull();
    expect(screen.getAllByText("Finding Prices").length).toBeGreaterThan(0);
  });

  it("Spend: each provider against its cap; Set Cap on a paid one only, sent as an amount", async () => {
    m.data = { "GET /api/v1/ai-control/spend": SPEND };
    m.rows = { "GET /api/v1/ai-control/spend/actions": [{ key: "policy-tidy", label: "Tidy Policy", job: "default", calls: 71, spent_ngn: "6620.35" }] };
    m.call.mockResolvedValueOnce(SPEND);
    page("spend");
    expect(screen.getByText("Gemini")).toBeTruthy();
    expect(screen.getByText("Groq")).toBeTruthy();
    // All AI and Gemini have a cap; Groq is Free and has none.
    expect(screen.getAllByRole("button", { name: "Set Cap" })).toHaveLength(2);
    await userEvent.click(screen.getAllByRole("button", { name: "Set Cap" })[1]);
    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByRole("textbox");
    await userEvent.clear(field);
    await userEvent.type(field, "60,000");
    await userEvent.click(within(dialog).getByRole("button", { name: "Set Cap" }));
    await waitFor(() =>
      expect(m.call).toHaveBeenCalledWith("PUT /api/v1/ai-control/caps/:provider", { params: { provider: "gemini" }, body: { monthly_cap_ngn: "60000.00" } }),
    );
  });
});
