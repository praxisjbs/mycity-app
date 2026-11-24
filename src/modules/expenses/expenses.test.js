"use strict";
/**
 * Expense requests: the budget flag, the outcomes an approval copies, and the routes. Raising,
 * approving, sending back, cancelling and withdrawing run against Postgres in
 * tests/integration/expenses.test.js; the cards in tests/integration/ai-actions-expenses.test.js.
 */
const { routesOf } = require("../../http/route");
const budget = require("./expenses.budget-check");
const service = require("./expenses.service");

const db = (rows) => ({ query: jest.fn(async () => ({ rows })) });

describe("the budget line a request counts against", () => {
  const request = { department_id: "d", expense_category_id: "c", amount: "50000.00" };

  test("over budget when its amount is more than the line has left", async () => {
    expect(await budget.check(db([{ budget_line_id: "l", remaining: "49999.99" }]), request, "2026-11-05")).toEqual({ budget_line_id: "l", over_budget: true });
    expect(await budget.check(db([{ budget_line_id: "l", remaining: "50000.00" }]), request, "2026-11-05")).toEqual({ budget_line_id: "l", over_budget: false });
  });

  test("no line for its department, category and year, or no department, is flagged: nothing was set aside for it", async () => {
    expect(await budget.check(db([]), request, "2026-11-05")).toEqual({ budget_line_id: null, over_budget: true });
    const none = db([]);
    expect(await budget.check(none, { ...request, department_id: null }, "2026-11-05")).toEqual({ budget_line_id: null, over_budget: true });
    expect(none.query).not.toHaveBeenCalled();
  });
});

describe("who may change a request when", () => {
  test("the requester edits a draft or a sent-back one, cancels it until Operations & People approve; a holder of expenses.finance withdraws it until it is paid", () => {
    expect(service.EDITABLE).toEqual(["draft", "sent_back"]);
    expect(service.CANCELLABLE).toEqual(["draft", "sent_back", "submitted"]);
    expect(service.WITHDRAWABLE).toEqual(["approved", "in_requisition", "authorised"]);
  });
});

describe("what sending needs of the payee (fault #5, 23/11/2026)", () => {
  const { payeeProblems } = require("@mycity/contract").expenses;
  test("a vendor's bank is needed in full; a draft's blanks are listed field by field", () => {
    expect(payeeProblems({ payee_type: "vendor", payee_name: "Ikeja Prints", bank_name: " ", account_name: null })).toEqual({
      bank_name: ["Required"],
      account_name: ["Required"],
      account_number: ["Required"],
    });
    expect(payeeProblems({ payee_type: "vendor", payee_name: "Ikeja Prints", bank_name: "Zenith Bank", account_name: "Ikeja Prints Ltd", account_number: "0123456789" })).toEqual({});
  });
  test("a staff payee on their company account needs none: the profile's bank is used", () => {
    expect(payeeProblems({ payee_type: "staff", uses_profile_account: true })).toEqual({});
    expect(Object.keys(payeeProblems({ payee_type: "staff", uses_profile_account: false }))).toHaveLength(4);
  });
});

describe("the routes", () => {
  const routes = routesOf(require("./expenses.routes").router);

  test("My Requests is the caller's own; the lists within scope; Withdraw needs expenses.finance", () => {
    expect(require("./expenses.routes").basePath).toBe("/expenses");
    expect(routes.map((r) => [r.method, r.path, r.permission || "self", r.capability || null])).toEqual([
      ["GET", "/mine", "self", null],
      ["GET", "/mine/summary", "self", null],
      ["GET", "/banks", { key: "expenses", action: "create" }, null],
      ["GET", "/mine/budget-check", { key: "expenses", action: "create" }, null],
      ["POST", "/mine", { key: "expenses", action: "create" }, null],
      ["POST", "/mine/invoice-reading", { key: "expenses", action: "create" }, null],
      ["POST", "/mine/category-suggestion", { key: "expenses", action: "create" }, null],
      ["PATCH", "/mine/:id", { key: "expenses", action: "edit" }, null],
      ["POST", "/mine/:id/submit", { key: "expenses", action: "create" }, null],
      ["POST", "/mine/:id/cancel", { key: "expenses", action: "edit" }, null],
      ["GET", "/", { key: "expenses", action: "view" }, null],
      ["GET", "/approvals", { key: "expenses", action: "approve" }, null],
      ["GET", "/approvals/summary", { key: "expenses", action: "approve" }, null],
      ["GET", "/:id", { key: "expenses", action: "view" }, null],
      ["GET", "/:id/history", { key: "expenses", action: "view" }, null],
      ["POST", "/:id/duplicate-check", { key: "expenses", action: "view" }, null],
      ["POST", "/:id/withdraw", { key: "expenses", action: "edit" }, "expenses.finance"],
    ]);
  });
});
