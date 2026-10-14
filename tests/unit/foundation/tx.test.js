"use strict";
const { atomically, inTransaction } = require("../../../src/shared/db/tx");

/** A pg client double that records statements; SAVEPOINT fails outside a transaction, like Postgres. */
function fakeClient({ foreign = false } = {}) {
  const log = [];
  let open = foreign;
  return {
    log,
    async query(sql) {
      log.push(sql);
      if (sql === "BEGIN") open = true;
      if (sql === "COMMIT" || sql === "ROLLBACK") open = false;
      if (sql.startsWith("SAVEPOINT") && !open) {
        const e = new Error("SAVEPOINT can only be used in transaction blocks");
        e.code = "25P01";
        throw e;
      }
      return { rows: [] };
    },
  };
}

describe("shared/db/tx atomically", () => {
  test("opens, runs and commits", async () => {
    const c = fakeClient();
    const out = await atomically(c, async () => {
      expect(inTransaction(c)).toBe(true);
      return 42;
    });
    expect(out).toBe(42);
    expect(c.log.filter((s) => !s.includes("SAVEPOINT"))).toEqual(["BEGIN", "COMMIT"]);
    expect(inTransaction(c)).toBe(false);
  });

  test("rolls back and rethrows the original error", async () => {
    const c = fakeClient();
    await expect(atomically(c, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(c.log).toContain("ROLLBACK");
    expect(inTransaction(c)).toBe(false);
  });

  test("a nested call joins the outer transaction: one BEGIN, one COMMIT", async () => {
    const c = fakeClient();
    await atomically(c, async () => {
      await atomically(c, async () => {
        await atomically(c, async () => undefined);
      });
    });
    expect(c.log.filter((s) => s === "BEGIN")).toHaveLength(1);
    expect(c.log.filter((s) => s === "COMMIT")).toHaveLength(1);
  });

  test("an inner throw rolls back everything", async () => {
    const c = fakeClient();
    await expect(
      atomically(c, async () => {
        await atomically(c, async () => { throw new Error("inner"); });
      }),
    ).rejects.toThrow("inner");
    expect(c.log).toContain("ROLLBACK");
    expect(c.log).not.toContain("COMMIT");
  });

  test("inside someone else's BEGIN it joins and never commits", async () => {
    const c = fakeClient({ foreign: true });
    await atomically(c, async () => undefined);
    expect(c.log).not.toContain("BEGIN");
    expect(c.log).not.toContain("COMMIT");
  });
});
