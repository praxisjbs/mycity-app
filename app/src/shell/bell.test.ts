// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { api } from "@/api/client";
import { mockSession } from "@/api/mock/core";

/** The bell's calls, against the in-browser mock: the same shapes the API answers with. */
describe("the bell", () => {
  beforeAll(() => mockSession.set("chidera"));

  it("lists newest first, counts the unread, and badges them per module", async () => {
    const page = await api.call("GET /api/v1/notifications");
    expect(page.page.size).toBe(25);
    expect(page.data[0]).toMatchObject({ category: "approvals", priority: "high", read_at: null });
    expect(page.data[0].link?.path).toMatch(/^\/expenses\?tab=approvals&id=/);
    const unread = await api.call("GET /api/v1/notifications", { query: { status: "unread" } });
    expect(unread.data.every((n) => n.read_at === null)).toBe(true);
    expect(await api.call("GET /api/v1/notifications/unread-count")).toEqual({ unread: unread.page.total });
    const badges = await api.call("GET /api/v1/notifications/badges");
    expect(Object.values(badges).reduce((a, b) => a + (b ?? 0), 0)).toBe(unread.page.total);
  });

  it("marks one read, then all", async () => {
    const [first] = (await api.call("GET /api/v1/notifications", { query: { status: "unread" } })).data;
    const before = (await api.call("GET /api/v1/notifications/unread-count")).unread;
    await api.call("POST /api/v1/notifications/:id/read", { params: { id: first.notification_id }, body: {} });
    expect((await api.call("GET /api/v1/notifications/unread-count")).unread).toBe(before - 1);
    await api.call("POST /api/v1/notifications/read-all", { body: {} });
    expect(await api.call("GET /api/v1/notifications/unread-count")).toEqual({ unread: 0 });
    expect(await api.call("GET /api/v1/notifications/badges")).toEqual({});
  });
});
