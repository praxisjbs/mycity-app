"use strict";
/**
 * The Audit Log's presentation, which needs no database: restricted values masked
 * for a reader whose roles mask them and named in `masked`, the reader's own record
 * left whole, and where an entry opens. The log itself runs against Postgres in
 * tests/integration/settings.test.js.
 */
require("./audit.events");
const { present } = require("./audit.service");
const { filtersText } = require("./audit.events");

const row = (over = {}) => ({
  audit_ledger_id: "00000000-0000-4000-8000-000000000001",
  occurred_at: new Date("2026-10-16T09:00:00Z"),
  actor_user_id: null,
  actor_name: "Ada Obi",
  actor_email: "ada@mycity.test",
  actor_ip: null,
  action: "role.created",
  module_key: "settings",
  entity_type: "employee",
  entity_id: "00000000-0000-4000-8000-0000000000aa",
  before: { gross_monthly: "450000.00", job_title: "Analyst", next_of_kin_name: null },
  after: { gross_monthly: "500000.00", job_title: "Analyst", bank: { account_number: "0123456789" } },
  changed_fields: ["gross_monthly"],
  is_sensitive: true,
  ...over,
});

describe("an entry as a reader sees it", () => {
  test("restricted values are masked and named for a reader whose roles mask them", () => {
    const [e] = present([row()], ["employee.salary", "employee.bank"], null);
    expect(e.before.gross_monthly).toBeNull();
    expect(e.after.gross_monthly).toBeNull();
    expect(e.after.bank.account_number).toBeNull();
    expect(e.after.job_title).toBe("Analyst");
    expect(e.masked).toEqual(["account_number", "gross_monthly"]);
  });

  test("a reader who may see them sees them, and nothing is named", () => {
    const [e] = present([row()], [], null);
    expect(e.after.gross_monthly).toBe("500000.00");
    expect(e.masked).toEqual([]);
  });

  test("an entry about the reader's own employee record is not masked from them", () => {
    const [e] = present([row()], ["employee.salary"], "00000000-0000-4000-8000-0000000000aa");
    expect(e.after.gross_monthly).toBe("500000.00");
    expect(e.masked).toEqual([]);
  });

  test("an empty restricted value is not called restricted", () => {
    const [e] = present([row()], ["employee.personal"], null);
    expect(e.masked).toEqual([]);
  });

  test("what it means comes from the event catalogue, and where it opens from the route map", () => {
    const [e] = present([row({ entity_type: "role" })], [], null);
    expect(e.summary).toBe("A role was created");
    expect(e.link).toBe(`/settings?tab=roles-and-permissions&id=${e.entity_id}`);
    const [acct] = present([row({ entity_type: "account", action: "auth.signed_in" })], [], null);
    expect(acct.link).toBe(`/settings?tab=users&id=${acct.entity_id}`);
    const [none] = present([row({ entity_type: "audit_export" })], [], null);
    expect(none.link).toBeNull();
  });
});

describe("the export's filters, as the email says them", () => {
  test("each filter set, or the whole log", () => {
    expect(filtersText({ module: "settings", from: "2026-10-01", q: "" })).toBe("module = settings, from = 2026-10-01");
    expect(filtersText({})).toBe("none, the whole log");
  });
});
