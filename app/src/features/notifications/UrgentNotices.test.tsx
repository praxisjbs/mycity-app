// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Notification } from "@mycity/contract/contract.gen.ts";

const m = vi.hoisted(() => ({
  call: vi.fn(async () => ({})),
  invalidate: vi.fn(),
  navigate: vi.fn(),
  markRead: vi.fn(async () => undefined),
  setPaneOpen: vi.fn(),
}));
vi.mock("@/api/client", () => ({ api: { call: m.call } }));
vi.mock("@/api/hooks", () => ({ invalidate: m.invalidate, useApi: () => ({ data: undefined }) }));
vi.mock("@/lib/router", () => ({ useRouter: () => ({ navigate: m.navigate }) }));
vi.mock("./arrivals", () => ({ markRead: m.markRead }));
vi.mock("./state", () => ({ setPaneOpen: m.setPaneOpen }));

import { UrgentNotices, urgentModules } from "./UrgentNotices";

const row = (id: string, over: Partial<Notification> = {}): Notification => ({
  notification_id: id,
  category: "comms",
  priority: "high",
  urgency: "urgent",
  acknowledge_required: true,
  acknowledged_at: null,
  repeat_count: 0,
  title: "Fire drill at 11",
  body: "Urgent. Acknowledge it in #announcements.",
  entity_type: "announcement",
  entity_id: "a1",
  link: { module: "community", tab: "channels", path: "/community?tab=channels&id=a1" },
  read_at: null,
  created_at: "2026-10-19T09:30:00.000Z",
  ...over,
});

const ANN = "11111111-1111-4111-8111-111111111111";
const SEC = "22222222-2222-4222-8222-222222222222";

describe("the urgent bar", () => {
  beforeAll(() => {
    // jsdom has no matchMedia; the bar's arrows ask it whether this is a phone.
    window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows nothing while nothing urgent is open", () => {
    const { container } = render(<UrgentNotices rows={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("Acknowledge closes an urgent announcement, and the bell and Community reload", async () => {
    render(<UrgentNotices rows={[row(ANN)]} />);
    await userEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(m.call).toHaveBeenCalledWith("POST /api/v1/notifications/:id/acknowledge", { params: { id: ANN }, body: {} });
    expect(m.invalidate).toHaveBeenCalledWith("/api/v1/notifications", "/api/v1/community");
  });

  it("anything else urgent is opened: read, then its screen", async () => {
    const security = row(SEC, { title: "Access change: A role was created", acknowledge_required: false, category: "security", link: { module: "settings", tab: "roles", path: "/settings?tab=roles&id=r1" } });
    render(<UrgentNotices rows={[security, row(ANN)]} />);
    expect(screen.getByText("1 of 2")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(m.markRead).toHaveBeenCalledWith([SEC]);
    expect(m.navigate).toHaveBeenCalledWith("/settings?tab=roles&id=r1");
    await userEvent.click(screen.getByRole("button", { name: "Next Notice" }));
    expect(screen.getByRole("button", { name: "Acknowledge" })).toBeTruthy();
  });

  it("names the modules whose badges turn red", () => {
    expect([...urgentModules([row(ANN), row(SEC, { link: null })])]).toEqual(["community"]);
  });
});
