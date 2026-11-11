"use strict";
/**
 * Deductions without a database (docs/guides/payroll.md §6.6): what a fine or an advance spread over months
 * comes to, to the kobo, which month it may start in, what a row offers the reader, and what each route needs.
 * The tab, the writes and the two runs an advance is carried through are tests/integration/deductions.test.js.
 */
const c = require("@mycity/contract");
const m = require("../../shared/money/money");
const { routesOf } = require("../../http/route");
const lock = require("../payroll/payroll.lock");
const repo = require("./deductions.repo");
const acceptance = require("./deductions.acceptance");
const service = require("./deductions.service");

describe("a deduction spread over months (§6.6 rule 3)", () => {
  test("₦10,000.00 over three months is 3,333.34, 3,333.33, 3,333.33, the kobo that do not divide going to the first", () => {
    expect(acceptance.plan("10000.00", 3, "2026-10-01").amounts).toEqual(["3333.34", "3333.33", "3333.33"]);
  });

  test("one month is the whole amount: Accept This Month", () => {
    expect(acceptance.plan("45000.00", 1, "2026-10-01")).toEqual({ periods: ["2026-10-01"], amounts: ["45000.00"] });
  });

  test("the shares always sum to the total, for any total of up to twelve months, and the first is never smaller than the last", () => {
    for (let months = 1; months <= 12; months += 1)
      for (const total of ["0.12", "0.13", "99.99", "1000.00", "45000.01", "75000.00", "123456.78", "999999999.99"]) {
        const { amounts } = acceptance.plan(total, months, "2026-01-01");
        expect(amounts).toHaveLength(months);
        expect(m.sum(amounts).toFixed(2)).toBe(total);
        expect(m.money(amounts[0]).gte(m.money(amounts[amounts.length - 1]))).toBe(true);
        // Equal to within one kobo.
        expect(m.money(amounts[0]).minus(m.money(amounts[amounts.length - 1])).lte(m.money("0.01"))).toBe(true);
        expect(amounts.every((a) => m.money(a).gt(0))).toBe(true);
      }
  });

  test("a total too small to give every month a kobo is refused on the months field", () => {
    expect(() => acceptance.plan("0.05", 12, "2026-01-01")).toThrow(expect.objectContaining({ code: "TOO_MANY_MONTHS", status: 422, fields: { months: ["Fewer months"] } }));
    expect(acceptance.plan("0.05", 5, "2026-01-01").amounts).toEqual(["0.01", "0.01", "0.01", "0.01", "0.01"]);
  });

  test("the months are consecutive calendar months, across a year end", () => {
    expect(acceptance.periodsFrom("2026-11-01", 4)).toEqual(["2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01"]);
    expect(acceptance.plan("90.00", 3, "2026-12-01").periods).toEqual(["2026-12-01", "2027-01-01", "2027-02-01"]);
  });
});

describe("what a row offers the reader", () => {
  const reader = { employee_id: "reader" };
  const edit = { grants: { edit: true }, reader };
  const row = (over) => ({
    source: "fine",
    source_id: "00000000-0000-4000-8000-000000000002",
    sanction_fine_id: "00000000-0000-4000-8000-000000000002",
    payroll_deduction_id: null,
    employee_id: "other",
    employee: { employee_id: "00000000-0000-4000-8000-000000000001", display_name: "Ada Tester", job_title: "Officer", department: "Programmes", photo_url: null },
    kind: null,
    work_date: null,
    reason_text: "Damaged the monitor",
    amount: "45000.00",
    salary_set: true,
    period: "2026-09-01",
    instalments: null,
    instalments_applied: null,
    status: "pending",
    query_number: "QRY-0001",
    created_at: new Date("2026-09-10T08:00:00Z"),
    started: false,
    ...over,
  });
  const can = (r, ctx = edit) => {
    const p = service.present(r, ctx);
    return [p.can_accept, p.can_waive, p.can_release, p.can_cancel];
  };

  test("a waiting fine is accepted or waived, by someone with payroll edit, and not by the person it is about", () => {
    expect(can(row({}))).toEqual([true, true, false, false]);
    expect(can(row({}), { grants: { edit: false }, reader })).toEqual([false, false, false, false]);
    expect(can(row({ employee_id: "reader" }))).toEqual([false, false, false, false]);
  });

  test("an accepted fine is released and an advance cancelled only while no month of it is started", () => {
    const accepted = { status: "active", payroll_deduction_id: "00000000-0000-4000-8000-000000000003", instalments: 3, instalments_applied: 0 };
    expect(can(row(accepted))).toEqual([false, false, true, false]);
    expect(can(row({ ...accepted, started: true }))).toEqual([false, false, false, false]);
    expect(can(row({ ...accepted, source: "advance", sanction_fine_id: null }))).toEqual([false, false, false, true]);
    expect(can(row({ ...accepted, source: "advance", sanction_fine_id: null, started: true }))).toEqual([false, false, false, false]);
    expect(can(row({ ...accepted, status: "settled", started: true }))).toEqual([false, false, false, false]);
    expect(can(row({ status: "waived" }))).toEqual([false, false, false, false]);
  });

  test("an attendance deduction is listed and offers nothing: People waive it on People · Attendance", () => {
    const attendance = row({ source: "attendance", kind: "late", work_date: "2026-09-02", reason_text: null, sanction_fine_id: null, query_number: null });
    expect(can(attendance)).toEqual([false, false, false, false]);
    expect(service.present(attendance, edit).reason).toBe("Late arrival, 02/09/2026");
    expect(service.present({ ...attendance, kind: "early_departure" }, edit).reason).toBe("Early departure, 02/09/2026");
    expect(service.present({ ...attendance, kind: "absence" }, edit).reason).toBe("Absence, 02/09/2026");
  });

  test("a row is the contract's DeductionRow", () => {
    expect(() => c.deductions.DeductionRow.parse(service.present(row({}), edit))).not.toThrow();
    expect(() => c.deductions.DeductionRow.parse(service.present(row({ amount: null, salary_set: false, source: "attendance", kind: "late", work_date: "2026-09-02" }), edit))).not.toThrow();
  });
});

describe("the list and its routes", () => {
  test("every sort the contract allows has its SQL, and the list opens on what is waiting, a default the contract does not name", () => {
    const allowed = ["created", "employee", "amount"];
    for (const key of allowed) {
      expect(c.deductions.DeductionListQuery.safeParse({ sort: key }).success).toBe(true);
      expect(c.deductions.DeductionListQuery.safeParse({ sort: `-${key}` }).success).toBe(true);
      expect(Object.keys(repo.SORTS)).toContain(key);
    }
    expect(c.deductions.DeductionListQuery.safeParse({ sort: "queue" }).success).toBe(false);
    expect(Object.keys(repo.SORTS)[0]).toBe("queue");
  });

  test("a month that already has a run with the approver or locked takes no instalment", () => {
    expect(lock.CLOSED).toEqual(["submitted", "approved", "paid"]);
  });

  test("the routes: reads need payroll view, a fine's moves payroll edit, Record Advance payroll create", () => {
    const routes = routesOf(require("./deductions.routes").router);
    expect(require("./deductions.routes").basePath).toBe("/deductions");
    expect(routes.map((r) => [r.method, r.path, r.permission])).toEqual([
      ["GET", "/", { key: "payroll", action: "view" }],
      ["GET", "/summary", { key: "payroll", action: "view" }],
      ["POST", "/fines/:sanction_fine_id/accept", { key: "payroll", action: "edit" }],
      ["POST", "/fines/:sanction_fine_id/waive", { key: "payroll", action: "edit" }],
      ["POST", "/advances", { key: "payroll", action: "create" }],
      ["POST", "/:id/release", { key: "payroll", action: "edit" }],
      ["POST", "/:id/cancel", { key: "payroll", action: "edit" }],
    ]);
  });
});
