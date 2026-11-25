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

describe("the payee's bank details (QA audit BG-018)", () => {
  const { ExpenseFields } = require("@mycity/contract").expenses;
  const fields = (accountNumber) => ExpenseFields.shape.account_number.safeParse(accountNumber);

  test("an account number is ten digits, never one digit repeated", () => {
    expect(fields("0123456789").success).toBe(true);
    expect(fields("1000000000").success).toBe(true);
    for (const fake of ["0000000000", "1111111111", "9999999999"]) expect(fields(fake).error.issues[0].message).toBe("Not a real number");
    expect(fields("012345678").error.issues[0].message).toBe("Ten digits");
  });

  test("Name Differs when the account name does not hold the payee's name, case, accents and punctuation set aside", () => {
    expect(service.nameDiffers("Chuks Stores", "Chuks Stores Ltd")).toBe(false);
    expect(service.nameDiffers("Café Adé", "CAFE ADE ENTERPRISES")).toBe(false);
    expect(service.nameDiffers("Ade O. Bello", "Ade O Bello")).toBe(false);
    expect(service.nameDiffers("Lekki Ushers", "Bayo Adeyemi")).toBe(true);
    // A word cut short is another name: "Ade" is not "Adeyemi".
    expect(service.nameDiffers("Ade", "Adeyemi Stores")).toBe(true);
    // Nothing to compare flags nothing.
    expect(service.nameDiffers(null, "Bayo Adeyemi")).toBe(false);
    expect(service.nameDiffers("Lekki Ushers", "")).toBe(false);
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
