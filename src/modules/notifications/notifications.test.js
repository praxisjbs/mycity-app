"use strict";
/**
 * The parts of web push that need no database (docs/guides/notifications.md §6): the payload a
 * push carries, how a push service's answer is read, the topic, the key id, how an event's
 * notices group on a device, and the environment's defaults. The routes, the job and the
 * fan-out run against the real migrations in tests/integration/notifications-push.test.js.
 */
const payloads = require("../../services/push/payload");
const webPush = require("../../services/push/web-push");
const vapid = require("../../services/push/vapid");
const { parseEnv } = require("../../config/env");

describe("the push payload", () => {
  const row = { notification_id: "6f1c2a1e-0000-4000-8000-000000000001", entity_type: "mail_thread", entity_id: "t-1" };

  test("a notice groups by its record and alerts again, unless its event says otherwise", () => {
    expect(payloads.styleOf(row, null)).toEqual({ tag: "mail_thread:t-1", mode: "alert" });
    expect(payloads.styleOf(row, { tag: "community_channel:c-9", mode: "quiet" })).toEqual({ tag: "community_channel:c-9", mode: "quiet" });
    expect(payloads.styleOf({ notification_id: "n-1" }, null)).toEqual({ tag: "n:n-1", mode: "single" });
  });

  test("version 1, under 3 KB however long the text, the title and line cut first", () => {
    const p = payloads.build({ id: row.notification_id, title: "T".repeat(500), body: "B ".repeat(4000), path: "/mailbox?tab=inbox&id=t-1", tag: "mail_thread:t-1", mode: "alert", category: "comms", ts: "2026-10-19T05:33:00Z", unread: 3 });
    expect(p).toMatchObject({ v: 1, id: row.notification_id, priority: "normal", unread: 3, test: false, path: "/mailbox?tab=inbox&id=t-1" });
    expect(p.title.length).toBeLessThanOrEqual(120);
    expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThanOrEqual(payloads.MAX_BYTES);
    expect(p.ts).toBe("2026-10-19T05:33:00.000Z");
  });

  test("matches the contract the service worker reads", () => {
    const c = require("@mycity/contract");
    const p = payloads.build({ id: null, title: "Test notification", body: "Notifications reach you on this device.", tag: "test", mode: "single", category: "system", priority: "high", ts: new Date(), test: true });
    expect(c.notifications.PushPayload.safeParse(p).success).toBe(true);
  });
});

describe("a push service's answer", () => {
  const err = (statusCode, headers = {}) => Object.assign(new Error("refused"), { statusCode, headers, body: "" });

  test("404, 410, 401 and 403 mean the subscription is dead; 429, 5xx and no answer mean try again", () => {
    expect(webPush.classify(err(410))).toMatchObject({ gone: true });
    expect(webPush.classify(err(404))).toMatchObject({ gone: true });
    expect(webPush.classify(err(403))).toMatchObject({ gone: true });
    expect(webPush.classify(err(401))).toMatchObject({ gone: true });
    expect(webPush.classify(err(429, { "retry-after": "30" }))).toMatchObject({ retry: true, retryAfterMs: 30000 });
    expect(webPush.classify(err(503))).toMatchObject({ retry: true });
    expect(webPush.classify(new Error("socket hang up"))).toMatchObject({ retry: true, status: null });
    expect(webPush.classify(err(400))).toEqual(expect.not.objectContaining({ retry: true, gone: true }));
  });

  test("a topic is URL-safe and at most 32 characters, the same for the same tag", () => {
    const t = webPush.topicOf("mail_thread:6f1c2a1e-0000-4000-8000-000000000001");
    expect(t).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    expect(webPush.topicOf("mail_thread:6f1c2a1e-0000-4000-8000-000000000001")).toBe(t);
    expect(webPush.topicOf("test")).toBe("test");
    expect(webPush.topicOf(null)).toBeUndefined();
  });

  test("the key id is a short stable hash of the public key", () => {
    expect(vapid.keyIdOf("BKey")).toHaveLength(12);
    expect(vapid.keyIdOf("BKey")).toBe(vapid.keyIdOf("BKey"));
    expect(vapid.keyIdOf("BKey")).not.toBe(vapid.keyIdOf("BOther"));
  });
});

describe("how an event's notices group on a device", () => {
  test("a declaration's push style is read from the event, and a broken one is ignored", () => {
    const fanout = require("../../shared/notifications/fanout");
    require("../community/community.events");
    const style = fanout.pushStyleOf({ key: "channel_message.posted", payload: { community_channel_id: "c-1" } });
    // Every channel post alerts (TB, 19/10/2026).
    expect(style).toEqual({ tag: "community_channel:c-1", mode: "alert" });
    expect(fanout.pushStyleOf({ key: "direct_message.sent", payload: { community_channel_id: "c-2" } })).toEqual({ tag: "community_channel:c-2", mode: "alert" });
    expect(fanout.pushStyleOf({ key: "no.such_event" })).toBeNull();
  });
});

describe("the environment's push and mail defaults", () => {
  test("live mail by default on servers: 24 inboxes on production, 4 on staging, none on a laptop", () => {
    expect(parseEnv({ APP_ENV: "test" }).config.MAILBOX_IDLE_MAX).toBe(0);
    expect(parseEnv({ APP_ENV: "staging" }).config.MAILBOX_IDLE_MAX).toBe(4);
    expect(parseEnv({ APP_ENV: "production" }).config.MAILBOX_IDLE_MAX).toBe(24);
    expect(parseEnv({ APP_ENV: "production", MAILBOX_IDLE_MAX: "10" }).config.MAILBOX_IDLE_MAX).toBe(10);
  });

  test("the VAPID subject defaults to the team's address; a key pair is both halves or neither", () => {
    const local = parseEnv({ APP_ENV: "test" });
    expect(local.config.VAPID_SUBJECT).toBe("mailto:jbspraxisllc@gmail.com");
    expect(parseEnv({ APP_ENV: "test", VAPID_PUBLIC_KEY: "BPublic" }).problems).toContain("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set together, or neither");
    expect(parseEnv({ APP_ENV: "test", VAPID_SUBJECT: "someone" }).problems).toContain("VAPID_SUBJECT must be a mailto: or https: address");
  });
});

describe("Settings · Notifications, reminders and quiet hours (no database)", () => {
  const lagos = require("../../shared/time/lagos");
  const categories = require("../../shared/notifications/categories");
  const at = (day, time) => lagos.instant(day, time);

  test("a channel: the person's switch, else the company's default for the notice, else the category's", () => {
    expect(categories.isOn("people", "email", undefined, null)).toBe(false);
    expect(categories.isOn("people", "email", undefined, true)).toBe(true);
    expect(categories.isOn("people", "email", false, true)).toBe(false);
    expect(categories.isOn("people", "push", true, false)).toBe(true);
    // Security's channels that are on by default stay on, whoever says otherwise.
    expect(categories.isOn("security", "email", false, false)).toBe(true);
  });

  test("quiet hours: when they end, across midnight or not, Lagos time", () => {
    const { quietEnd } = require("./notifications.service");
    expect(quietEnd(at("2026-10-19", "23:00"), "21:00", "07:00").toISOString()).toBe(at("2026-10-20", "07:00").toISOString());
    expect(quietEnd(at("2026-10-20", "06:59"), "21:00", "07:00").toISOString()).toBe(at("2026-10-20", "07:00").toISOString());
    expect(quietEnd(at("2026-10-20", "07:00"), "21:00", "07:00")).toBeNull();
    expect(quietEnd(at("2026-10-20", "13:30"), "13:00", "14:00").toISOString()).toBe(at("2026-10-20", "14:00").toISOString());
    expect(quietEnd(at("2026-10-20", "12:59"), "13:00", "14:00")).toBeNull();
  });

  test("working hours: 08:00 to 18:00 Lagos, else the next 08:00", () => {
    const { inWorkHours } = require("./notifications.reminders");
    expect(inWorkHours(at("2026-10-19", "07:10")).toISOString()).toBe(at("2026-10-19", "08:00").toISOString());
    expect(inWorkHours(at("2026-10-19", "12:00")).toISOString()).toBe(at("2026-10-19", "12:00").toISOString());
    expect(inWorkHours(at("2026-10-19", "18:00")).toISOString()).toBe(at("2026-10-20", "08:00").toISOString());
  });

  test("a declaration names its audience and says whether it takes copies", () => {
    const fanout = require("../../shared/notifications/fanout");
    const { defineEvents } = require("../../shared/events/catalogue");
    defineEvents("settings", { "rules_test.copied": { summary: "A test notice about someone else" } });
    expect(() => fanout.defineNotification("rules_test.copied", { to: [{ users: () => [] }], title: "T", copy: { note: "x" } })).toThrow(/copy is true or/);
    expect(() => fanout.defineNotification("rules_test.copied", { to: [{ users: () => [] }], title: "T", who: "" })).toThrow(/who is/);
    fanout.defineNotification("rules_test.copied", {
      to: [{ users: () => [] }, { permission: ["people", "approve"] }, { ceo: true }],
      title: "T",
      who: "Its owners",
      copy: { body: "About someone else." },
    });
    const notice = fanout.notices().find((n) => n.event_key === "rules_test.copied");
    expect(notice).toMatchObject({ name: "A test notice about someone else", category: "system", copies: true, locked: false, urgency_default: "normal" });
    expect(notice.who).toEqual(["Its owners", "People · Approve", "CEO"]);
  });
});
