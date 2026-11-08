"use strict";
/**
 * Where an agreement's notices wait on Contracts & MOUs (docs/guides/notifications.md §6;
 * partnerships.md §7): under the chip of its status. The lifecycle itself runs on the real database in
 * tests/integration/partnerships-agreements.test.js.
 */
const [view] = require("./agreements.views");

describe("agreements: where they wait", () => {
  test("each agreement under its status, as the list's filter reads it", async () => {
    const db = {
      query: async (_sql, [ids]) => ({ rows: ids.map((id, i) => ({ id, status: ["review", "signed"][i] })) }),
    };
    const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
    expect(view).toMatchObject({ module: "partnerships", tab: "contracts-and-mous", type: "agreement" });
    expect([...(await view.place(db, ids)).entries()]).toEqual([
      [ids[0], "review"],
      [ids[1], "signed"],
    ]);
  });
});
