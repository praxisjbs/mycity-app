"use strict";
/**
 * Where it waits, inside a tab (docs/guides/notifications.md §6): each module declares where its
 * records sit on the screen they open on (`<module>.views.js`), and the registry
 * (src/shared/notifications/views.js) places a screen's records by it. The endpoint, against
 * Postgres, is in tests/integration/notifications.test.js; each module's own placing, with its
 * records' states, in that module's integration suite.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const views = require("../../../src/shared/notifications/views");

const ID = "0b0a7a52-4a5e-4a39-9f61-6b2d43ad9c01";
const OTHER = "6f3c2b1a-1d2e-4f5a-8b7c-9d0e1f2a3b4c";

/** A throwaway modules folder with these files: { "<module>/<file>": source }. */
function modulesWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "views-"));
  for (const [rel, src] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), src);
  }
  return dir;
}

afterEach(() => views.reset());

describe("the declarations", () => {
  test("every module's views file is read, an empty one skipped", () => {
    const dir = modulesWith({
      "sites/sites.views.js": `module.exports = [{ module: "people", tab: "worksites", type: "site", view: "temporary" }];`,
      "other/other.views.js": "",
    });
    const found = views.load({ dir });
    expect([...found.keys()]).toEqual(["people/worksites/site"]);
    expect(found.get("people/worksites/site")).toMatchObject({ view: "temporary", file: path.join(path.basename(dir), "sites/sites.views.js") });
  });

  test("a record type placed twice on one screen, a path that is not one, or a view and a place both, stop the load", () => {
    const twice = modulesWith({
      "a/a.views.js": `module.exports = [{ module: "people", tab: "worksites", type: "site", view: "temporary" }];`,
      "b/b.views.js": `module.exports = [{ module: "people", tab: "worksites", type: "site", view: "permanent" }];`,
    });
    expect(() => views.load({ dir: twice })).toThrow(/placed by both/);
    const bad = modulesWith({ "a/a.views.js": `module.exports = [{ module: "people", tab: "worksites", type: "site", view: "Temporary Sites" }];` });
    expect(() => views.load({ dir: bad })).toThrow(/not a view path/);
    const both = modulesWith({ "a/a.views.js": `module.exports = [{ module: "people", tab: "worksites", type: "site", view: "temporary", place: async () => new Map() }];` });
    expect(() => views.load({ dir: both })).toThrow(/a view or a place, not both/);
  });

  test("the app's own declarations load", () => {
    expect(() => views.load()).not.toThrow();
  });
});

describe("placing a screen's records", () => {
  test("a fixed view takes every record; a place reads each, and only uuids reach it", async () => {
    const asked = [];
    const dir = modulesWith({
      "sites/sites.views.js": `
        module.exports = [
          { module: "people", tab: "worksites", type: "request", view: "temporary/requests" },
          { module: "people", tab: "worksites", type: "site", place: async (db, ids) => { global.__asked.push(...ids); return new Map(ids.map((id) => [id, id === "${ID}" ? "temporary/cancelled" : "Not A Path"])); } },
        ];`,
    });
    global.__asked = asked;
    views.load({ dir });
    const fixed = await views.placeAll(null, { module: "people", tab: "worksites", type: "request", ids: ["r-1", ID] });
    expect([...fixed]).toEqual([["r-1", "temporary/requests"], [ID, "temporary/requests"]]);
    const placed = await views.placeAll(null, { module: "people", tab: "worksites", type: "site", ids: [ID, OTHER, "not-a-uuid"] });
    expect(asked).toEqual([ID, OTHER]);
    // A path that is not one is dropped: that record counts on the tab alone.
    expect([...placed]).toEqual([[ID, "temporary/cancelled"]]);
    expect([...(await views.placeAll(null, { module: "ess", tab: "my-leave", type: "site", ids: [ID] }))]).toEqual([]);
    delete global.__asked;
  });

  test("a record counts in its view and in every view above it", () => {
    expect(views.pathsOf("temporary/cancelled")).toEqual(["temporary", "temporary/cancelled"]);
    expect(views.pathsOf("permanent")).toEqual(["permanent"]);
  });
});
