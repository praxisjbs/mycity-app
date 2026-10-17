"use strict";
/** Staff Community's rules that need no database (the API is covered in tests/integration/community.test.js). */
const service = require("./community.service");
const { noteFor, pick, NOTES } = require("./community.recognition");
const { wishFor, BIRTHDAY, ANNIVERSARY } = require("./community.celebrations");
const { routesOf } = require("../../http/route");
const { router } = require("./community.routes");

describe("who may post", () => {
  test("everyone, admins only, or announcement posters", () => {
    expect(service.mayPost({ post_policy: "everyone", member_role: "member" }, false)).toBe(true);
    expect(service.mayPost({ post_policy: "admins", member_role: "member" }, true)).toBe(false);
    expect(service.mayPost({ post_policy: "admins", member_role: "admin" }, false)).toBe(true);
    expect(service.mayPost({ post_policy: "people_ceo", member_role: "admin" }, false)).toBe(false);
    // Nothing is posted straight into #announcements, People and the CEO included: they publish from the tab.
    expect(service.mayPost({ post_policy: "people_ceo", member_role: "member" }, true)).toBe(false);
  });
});

describe("a list row's last line", () => {
  test("names what a file was, and shortens text to one line", () => {
    expect(service.lineOf("audio", null)).toBe("Voice note");
    expect(service.lineOf("image", null)).toBe("Photo");
    expect(service.lineOf("poll", "Lunch?")).toBe("Poll: Lunch?");
    expect(service.lineOf("text", "two\n\nlines")).toBe("two lines");
    expect(service.lineOf("text", "x".repeat(300))).toHaveLength(140);
  });
});

describe("ticks on a direct message", () => {
  const at = "2026-10-17T09:00:00.000Z";
  test("sent, delivered, read from the other person's pointers", () => {
    expect(service.statusOf({ sent_at: at }, null)).toBe("sent");
    expect(service.statusOf({ sent_at: at }, { last_delivered_at: "2026-10-17T08:59:00Z", last_read_at: null })).toBe("sent");
    expect(service.statusOf({ sent_at: at }, { last_delivered_at: "2026-10-17T09:00:01Z", last_read_at: null })).toBe("delivered");
    expect(service.statusOf({ sent_at: at }, { last_delivered_at: null, last_read_at: "2026-10-17T09:05:00Z" })).toBe("read");
  });
});

test("a stored file's type decides the kind of message", () => {
  expect(service.kindOfFile("image/png")).toBe("image");
  expect(service.kindOfFile("audio/webm")).toBe("audio");
  expect(service.kindOfFile("video/mp4")).toBe("video");
  expect(service.kindOfFile("application/pdf")).toBe("file");
});

describe("written lines", () => {
  test("a pick is stable for a key and always from its list", () => {
    expect(pick("a", NOTES)).toBe(pick("a", NOTES));
    expect(NOTES).toContain(noteFor("e1"));
    expect(BIRTHDAY).toContain(wishFor("e1", "birthday", 2026));
    expect(ANNIVERSARY).toContain(wishFor("e1", "anniversary", 2026));
  });
  test("no em dash in anything a person reads", () => {
    for (const line of [...NOTES, ...BIRTHDAY, ...ANNIVERSARY]) expect(line).not.toMatch(/—|--/);
  });
});

test("every community route carries the community grant", () => {
  const routes = routesOf(router);
  expect(routes.length).toBeGreaterThanOrEqual(19);
  for (const r of routes) expect(r.permission && r.permission.key).toBe("community");
});
