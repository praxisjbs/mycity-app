"use strict";
/** Announcements' shaping and routes (the API is covered in tests/integration/community.test.js). */
const service = require("./announcements.service");
const { routesOf } = require("../../http/route");
const { router } = require("./announcements.routes");

test("an announcement with no audience stored reads as all staff", () => {
  const v = service.view({
    announcement_id: "a1",
    title: "T",
    body: "B",
    audience: {},
    departments: null,
    status: "published",
    author: null,
    publish_at: null,
    published_at: "2026-10-17T08:00:00Z",
    reads: 2,
    audience_size: 3,
  });
  expect(v.audience).toEqual({ kind: "all", department_ids: [] });
  expect(v.departments).toEqual([]);
  expect(v.published_at).toBe("2026-10-17T08:00:00.000Z");
});

test("every announcements route carries the community grant", () => {
  for (const r of routesOf(router)) expect(r.permission && r.permission.key).toBe("community");
});
