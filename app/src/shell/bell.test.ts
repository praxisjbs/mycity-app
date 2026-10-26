// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { api } from "@/api/client";
import { mockSession } from "@/api/mock/core";

/** The bell's calls, against the in-browser mock: the same shapes the API answers with. */
describe("the bell", () => {
  beforeAll(() => mockSession.set("chidera"));

  it("lists newest first, counts the unread, and badges them per module and tab", async () => {
    const page = await api.call("GET /api/v1/notifications");
    expect(page.page.size).toBe(25);
    expect(page.data[0]).toMatchObject({ category: "approvals", priority: "high", read_at: null });
    expect(page.data[0].link?.path).toMatch(/^\/expenses\?tab=approvals&id=/);
    const unread = await api.call("GET /api/v1/notifications", { query: { status: "unread" } });
    expect(unread.data.every((n) => n.read_at === null)).toBe(true);
    expect(await api.call("GET /api/v1/notifications/unread-count")).toEqual({ unread: unread.page.total });
    const badges = await api.call("GET /api/v1/notifications/badges");
    const sum = (counts: Record<string, number | undefined>) => Object.values(counts).reduce<number>((a, b) => a + (b ?? 0), 0);
    expect(sum(badges.modules)).toBe(unread.page.total);
    for (const [module, count] of Object.entries(badges.modules)) expect(sum(badges.tabs[module] ?? {})).toBe(count);
    expect(badges.tabs.people).toEqual({ leave: 1, employees: 1 });
  });

  it("marks the records a list shows that have something unread, and reads them when opened there", async () => {
    const page = await api.call("GET /api/v1/notifications", { query: { status: "unread" } });
    const leave = page.data.find((n) => n.entity_type === "leave_request")!;
    const elsewhere = "00000000-0000-4000-8000-000000000999";
    const ids = `${leave.entity_id},${elsewhere}`;
    expect(await api.call("GET /api/v1/notifications/unread-records", { query: { module: "people", tab: "leave", ids } })).toEqual({ ids: [leave.entity_id] });
    expect(await api.call("GET /api/v1/notifications/unread-records", { query: { module: "people", tab: "employees", ids } })).toEqual({ ids: [] });
    await api.call("POST /api/v1/notifications/read-record", { body: { module: "people", tab: "leave", entity_id: leave.entity_id! } });
    expect(await api.call("GET /api/v1/notifications/unread-records", { query: { module: "people", tab: "leave", ids } })).toEqual({ ids: [] });
    expect((await api.call("GET /api/v1/notifications/badges")).tabs.people).toEqual({ employees: 1 });
  });

  it("marks one read, then all", async () => {
    const [first] = (await api.call("GET /api/v1/notifications", { query: { status: "unread" } })).data;
    const before = (await api.call("GET /api/v1/notifications/unread-count")).unread;
    await api.call("POST /api/v1/notifications/:id/read", { params: { id: first.notification_id }, body: {} });
    expect((await api.call("GET /api/v1/notifications/unread-count")).unread).toBe(before - 1);
    await api.call("POST /api/v1/notifications/read-all", { body: {} });
    expect(await api.call("GET /api/v1/notifications/unread-count")).toEqual({ unread: 0 });
    expect(await api.call("GET /api/v1/notifications/badges")).toEqual({ modules: {}, tabs: {} });
  });
});
