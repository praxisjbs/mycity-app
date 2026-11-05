"use strict";
/**
 * Disbursements: the reference asked for, and the routes. Recording, Reference Missing and Add
 * Reference run against Postgres in tests/integration/expenses.test.js.
 */
const { routesOf } = require("../../http/route");
const service = require("./disbursements.service");

describe("Record Disbursement", () => {
  test("without a reference or a receipt it is refused unless Save Without Reference was chosen, before anything is read", async () => {
    await expect(service.create({ user_id: "u" }, { expense_request_id: "e", paid_on: "2026-11-02" })).rejects.toMatchObject({
      code: "REFERENCE_REQUIRED",
      status: 422,
      fields: { payment_reference: ["Add the reference"] },
    });
  });

  test("a day ahead is refused", async () => {
    await expect(service.create({ user_id: "u" }, { expense_request_id: "e", paid_on: "2999-01-01", payment_reference: "GT1" })).rejects.toMatchObject({ code: "PAID_IN_FUTURE" });
  });
});

describe("the routes", () => {
  const routes = routesOf(require("./disbursements.routes").router);

  test("every one held to expenses.finance", () => {
    expect(require("./disbursements.routes").basePath).toBe("/disbursements");
    expect(routes.map((r) => [r.method, r.path, r.permission, r.capability || null])).toEqual([
      ["GET", "/", { key: "expenses", action: "view" }, "expenses.finance"],
      ["POST", "/", { key: "expenses", action: "create" }, "expenses.finance"],
      ["PATCH", "/:id", { key: "expenses", action: "edit" }, "expenses.finance"],
    ]);
  });
});
