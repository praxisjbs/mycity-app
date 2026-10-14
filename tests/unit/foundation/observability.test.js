"use strict";
const { scrub, scrubObject } = require("../../../src/shared/observability/scrub");
const reporter = require("../../../src/shared/observability/error-reporter");
const metrics = require("../../../src/shared/observability/metrics");

describe("scrub", () => {
  test.each([
    ["connect ECONNREFUSED postgres://mycity:hunter2@db:5432/x", "postgres://<credentials>@db:5432/x"],
    ["token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U", "<jwt>"],
    ["password=hunter22 and more", "password=<redacted>"],
    ["mail ada@mycity.io failed", "<email>"],
    ["call +234 803 123 4567", "<phone>"],
    ["call 0803 123 4567 now", "<phone>"],
    ["card 4111 1111 1111 1111", "<card>"],
  ])("%s", (input, expected) => {
    expect(scrub(input)).toContain(expected);
  });

  test("a number that is not a card (fails Luhn) is kept", () => {
    expect(scrub("ref 1234 5678 9012 3456")).toContain("1234 5678 9012 3456");
  });

  test("scrubObject drops sensitive keys outright and scrubs strings", () => {
    expect(scrubObject({ bvn: "12345678901", note: "ada@mycity.io", n: 3 })).toEqual({ bvn: "<redacted>", note: "<email>", n: 3 });
  });
});

describe("error reporter", () => {
  let inserts;
  beforeEach(() => {
    inserts = [];
    reporter.__reset({ query: async (sql, params) => { inserts.push({ sql, params }); return { rows: [] }; } });
    metrics.__reset();
  });

  test("stores scrubbed reports in one batched insert", async () => {
    await reporter.report(new Error("could not reach postgres://u:secret@db/x"), { origin: "server", severity: "notice" });
    await reporter.report(new Error("second"), { origin: "worker", severity: "notice" });
    expect(await reporter.flush()).toBe(2);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toMatch(/^INSERT INTO error_event/);
    expect(inserts[0].params.join(" ")).not.toContain("secret");
  });

  test("notice and warning never alert; error does, once per five minutes per fingerprint", async () => {
    expect((await reporter.report(new Error("x"), { severity: "notice" })).reason).toBe("not_alerting");
    const first = await reporter.report(new Error("Order 123 failed"), { severity: "error" });
    const second = await reporter.report(new Error("Order 456 failed"), { severity: "error" });
    expect(first.alerted).toBe(false); // no webhook configured, but it tried
    expect(first.reason).toBeUndefined();
    expect(second.reason).toBe("deduped");
  });

  test("a missing error_event table is reported once and then left alone", async () => {
    reporter.__reset({ query: async () => { const e = new Error("relation does not exist"); e.code = "42P01"; throw e; } });
    reporter.report(new Error("a"), { severity: "notice" });
    expect(await reporter.flush()).toBe(0);
    reporter.report(new Error("b"), { severity: "notice" });
    expect(await reporter.flush()).toBe(0);
  });

  test("fingerprints ignore ids and numbers", () => {
    const a = reporter.fingerprint({ name: "Error", message: "Employee 3f2a1c4e-0000-4000-8000-000000000001 has 3 items", stack: "" });
    const b = reporter.fingerprint({ name: "Error", message: "Employee 9e9e9e9e-0000-4000-8000-000000000002 has 7 items", stack: "" });
    expect(a).toBe(b);
  });
});

describe("metrics", () => {
  beforeEach(() => metrics.__reset());
  test("renders counters and histograms in the Prometheus format", () => {
    metrics.inc("mycity_test_total", { reason: "x" }, 2, "Test counter.");
    metrics.observe("mycity_test_seconds", 0.2, { route: "/a" });
    const out = metrics.render();
    expect(out).toContain('mycity_test_total{reason="x"} 2');
    expect(out).toContain('mycity_test_seconds_bucket{route="/a",le="0.25"} 1');
  });
  test("templatePath folds ids", () => {
    expect(metrics.templatePath("/api/v1/employees/3f2a1c4e-0000-4000-8000-000000000001/documents?x=1"))
      .toBe("/api/v1/employees/:id/documents");
  });
});
