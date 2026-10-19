// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Notification } from "@mycity/contract/contract.gen.ts";

/** What the open app does when a notice arrives (docs/guides/notifications.md §6, §11). */
const m = vi.hoisted(() => ({
  handlers: new Map<string, (payload: unknown) => void>(),
  notify: vi.fn(),
  alertArrival: vi.fn(),
  invalidate: vi.fn(),
  navigate: vi.fn(),
  location: { path: "/home", module: "home", tab: null as string | null, id: null as string | null, params: new URLSearchParams() },
}));

vi.mock("@mycity/ui", () => ({ notify: m.notify }));
vi.mock("@/api/realtime", () => ({ useRealtime: (event: string, handler: (payload: unknown) => void) => m.handlers.set(event, handler) }));
vi.mock("@/api/hooks", () => ({ invalidate: m.invalidate }));
vi.mock("@/api/client", () => ({ api: { call: vi.fn(async () => ({ read: [] })) } }));
vi.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ status: "signed-in" }) }));
vi.mock("@/lib/router", () => ({ useRouter: () => ({ location: m.location, navigate: m.navigate }) }));
vi.mock("./sound", () => ({ alertArrival: m.alertArrival, unlockAudio: vi.fn() }));
vi.mock("./state", () => ({ setPaneOpen: vi.fn() }));

import { useArrivals } from "./arrivals";

const THREAD = "c0ffee00-0000-4000-8000-000000000001";
const notice = (id: string, over: Partial<Notification> = {}): Notification => ({
  notification_id: id,
  category: "comms",
  priority: "normal",
  urgency: "normal",
  acknowledge_required: false,
  acknowledged_at: null,
  repeat_count: 0,
  title: "Tom-Blake Asaah",
  body: "Re: Test mail\nThe signed copy is attached.",
  entity_type: "mail_thread",
  entity_id: THREAD,
  link: { module: "mailbox", tab: "inbox", path: `/mailbox?tab=inbox&id=${THREAD}` },
  read_at: null,
  created_at: "2026-10-19T07:00:00.000Z",
  ...over,
});

const onScreen = (state: DocumentVisibilityState) => vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
const arrives = (n: Notification) => m.handlers.get("notification")?.(n);

describe("a notice arriving while the app is open", () => {
  beforeEach(() => {
    m.handlers.clear();
    Object.assign(m.location, { path: "/home", module: "home", tab: null, id: null });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("on screen: the banner and the sound, once per notice whichever way it comes", () => {
    onScreen("visible");
    renderHook(() => useArrivals(0));
    arrives(notice("6f1d1f5e-8a4b-4d3c-9e2a-1b2c3d4e5f60"));
    arrives(notice("6f1d1f5e-8a4b-4d3c-9e2a-1b2c3d4e5f60"));
    expect(m.notify).toHaveBeenCalledOnce();
    expect(m.notify.mock.calls[0][0]).toMatchObject({ title: "Tom-Blake Asaah", avatar: "Tom-Blake Asaah" });
    expect(m.alertArrival).toHaveBeenCalledOnce();
    expect(m.alertArrival).toHaveBeenCalledWith("comms", "normal");
    expect(m.invalidate).toHaveBeenCalledWith("/api/v1/notifications");
  });

  it("an urgent notice is red, and each repeat shows the banner and sounds again", () => {
    onScreen("visible");
    renderHook(() => useArrivals(0));
    const id = "8b3f3a7f-0c6d-4f5e-9a4c-3d4e5f607182";
    const urgent = { urgency: "urgent" as const, acknowledge_required: true, title: "Fire drill at 11", entity_type: "announcement", link: null };
    arrives(notice(id, urgent));
    arrives(notice(id, urgent));
    arrives(notice(id, { ...urgent, repeat_count: 1 }));
    expect(m.notify).toHaveBeenCalledTimes(2);
    expect(m.notify.mock.calls[0][0]).toMatchObject({ title: "Fire drill at 11", tone: "err" });
    expect(m.alertArrival).toHaveBeenLastCalledWith("comms", "urgent");
  });

  it("behind other windows or tabs: only the bell reloads; the device's own notification sounds", () => {
    onScreen("hidden");
    renderHook(() => useArrivals(0));
    arrives(notice("7a2e2f6f-9b5c-4e4d-8f3b-2c3d4e5f6071"));
    expect(m.notify).not.toHaveBeenCalled();
    expect(m.alertArrival).not.toHaveBeenCalled();
    expect(m.invalidate).toHaveBeenCalledWith("/api/v1/notifications");
  });

  it("no banner for the record already on screen", () => {
    onScreen("visible");
    Object.assign(m.location, { path: "/mailbox", module: "mailbox", tab: "inbox", id: THREAD });
    renderHook(() => useArrivals(0));
    arrives(notice("8b3f3a70-ac6d-4f5e-9a4c-3d4e5f607182"));
    expect(m.notify).not.toHaveBeenCalled();
    expect(m.alertArrival).not.toHaveBeenCalled();
  });
});
